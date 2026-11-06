/**
 * Keeper: keeps PreSign's trust fresh on Arkiv. Run it on a schedule (cron / CI), or by hand.
 *
 * For each dataset it re-reads the SOURCES (latest EF registry commit; each vendor's file + on-chain
 * code), compares with the ACTIVE entities our publisher has on Arkiv, then (plan.ts):
 *  - unchanged -> extend expiry 7 days
 *  - added / modified / removed -> create / supersede / mark removed, plus a readonly Change record,
 *    all in ONE transaction per item
 *
 * Safety: if a source can't be read (GitHub / RPC error) the run throws and changes nothing, so
 * an outage can never make us "remove" trusted entries.
 *
 * Run: npm run keeper                      (dry run: print the plan)
 *      npm run keeper -- --write           (apply)
 *      options: --only descriptors|delegates, --commit <registry sha>
 */
import { createPublisher, env } from "@presign/core/node";
import { Change, Delegate, Descriptor, createReader } from "@presign/core";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { buildDescriptorRows, descriptorCreate, type DescriptorRow } from "@presign/importer/descriptors";
import { buildDelegateRows, delegateCreate, type DelegateRow } from "@presign/importer/delegates";
import { latestCommit } from "@presign/importer/registry";
import type { Hex } from "viem";
import { planSync, type ExistingEntity, type FreshRow, type PlanItem, type SyncPlan } from "./plan.ts";

const REPO = process.env.REGISTRY_REPO || "ethereum/clear-signing-erc7730-registry";
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const write = process.argv.includes("--write");
const only = arg("--only");

const reader = createReader(env("ARKIV_ACCESS_KEY"));
const publisher = env("PUBLISHER_ADDRESS") as Hex;
const idOf = (chainId: number | bigint | string, address: string) => `${Number(chainId)}:${address.toLowerCase()}`;

// ---------- read what is on Arkiv ----------

async function activeDescriptors(): Promise<(ExistingEntity & { expiresAt: number })[]> {
  const out: (ExistingEntity & { expiresAt: number })[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await reader
      .select({ $key: true, $expiresAt: true, chainId: true, address: true, descriptorHash: true, status: true })
      .from(Descriptor)
      .createdBy(publisher)
      .limit(100)
      .offset(offset)
      .fetch();
    for (const e of page.entities)
      if (e.status.value === "active")
        out.push({ key: e.$key, id: idOf(e.chainId.value, e.address.value), hash: e.descriptorHash.value, expiresAt: Number(e.$expiresAt) });
    if (page.entities.length < 100) return out;
  }
}

async function activeDelegates(): Promise<(ExistingEntity & { expiresAt: number })[]> {
  const out: (ExistingEntity & { expiresAt: number })[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await reader
      .select({ $key: true, $expiresAt: true, chainId: true, address: true, codeHash: true, status: true })
      .from(Delegate)
      .createdBy(publisher)
      .limit(100)
      .offset(offset)
      .fetch();
    for (const e of page.entities)
      if (e.status.value === "active")
        out.push({ key: e.$key, id: idOf(e.chainId.value, e.address.value), hash: e.codeHash.value, expiresAt: Number(e.$expiresAt) });
    if (page.entities.length < 100) return out;
  }
}

// ---------- apply a plan ----------

type Kind = "descriptor" | "delegate";
type Wallet = ReturnType<typeof createPublisher>;

function changeCreate(kind: Kind, item: PlanItem<unknown>, sourceCommit?: string) {
  const [chainId, address] = item.id.split(":") as [string, string];
  const c = item.change!;
  return {
    schema: Change,
    values: {
      kind,
      changeType: c.changeType,
      chainId: u64(Number(chainId)),
      address: addr(address),
      detectedAt: u64(Math.floor(Date.now() / 1000)),
      ...(c.oldHash ? { oldHash: c.oldHash } : {}),
      ...(c.newHash ? { newHash: c.newHash } : {}),
      ...(sourceCommit ? { sourceCommit } : {}),
    },
    // History is append-only (readonly) and anyone may keep it alive.
    expiration: ExpirationTime.fromDays(90),
    flags: { readonly: true, permissionlessExtension: true },
  };
}

/** Send ops; if a batch is rejected (e.g. gas), split it in half and retry. Items are never split. */
async function sendBatches<T>(wallet: Wallet, units: T[], toBatch: (units: T[]) => Parameters<Wallet["executeBatch"]>[0], label: string) {
  if (!units.length) return;
  try {
    const r = await wallet.executeBatch(toBatch(units));
    console.log(`  ${label}: ${units.length} ok, tx ${r.txHash}`);
  } catch (e) {
    if (units.length === 1) throw e;
    const mid = Math.ceil(units.length / 2);
    await sendBatches(wallet, units.slice(0, mid), toBatch, label);
    await sendBatches(wallet, units.slice(mid), toBatch, label);
  }
}

async function apply<R>(wallet: Wallet, kind: Kind, plan: SyncPlan<R>, toCreate: (r: R) => any, commitOf: (r: R | undefined) => string | undefined) {
  // Atomic items: entity create + retire patches + change record in one transaction.
  const schema = kind === "descriptor" ? Descriptor : Delegate;
  const groups: PlanItem<R>[][] = [];
  for (let i = 0; i < plan.items.length; i += 10) groups.push(plan.items.slice(i, i + 10));
  for (const group of groups) {
    await sendBatches(
      wallet,
      group,
      (items) => ({
        creates: items.flatMap((it) => [
          ...(it.create ? [toCreate(it.create)] : []),
          ...(it.change ? [changeCreate(kind, it as PlanItem<unknown>, commitOf(it.create))] : []),
        ]),
        patches: items.flatMap((it) => it.retire.map((r) => ({ schema, entityKey: r.key, set: { status: r.status } }))),
      }),
      `${kind} changes`,
    );
  }
  // Re-confirm unchanged entities: extend 7 days from now.
  for (let i = 0; i < plan.extend.length; i += 200) {
    await sendBatches(
      wallet,
      plan.extend.slice(i, i + 200),
      (keys) => ({ extensions: keys.map((entityKey) => ({ entityKey, expiration: ExpirationTime.fromDays(7) })) }),
      `${kind} extensions`,
    );
  }
}

// ---------- report / verify ----------

function summarize<R>(kind: Kind, plan: SyncPlan<R>) {
  const count = (t: string) => plan.items.filter((i) => i.change?.changeType === t).length;
  const dups = plan.items.filter((i) => !i.change).length;
  console.log(`  ${kind}: extend ${plan.extend.length}, added ${count("added")}, modified ${count("modified")}, removed ${count("removed")}${dups ? `, duplicates retired ${dups}` : ""}`);
  for (const i of plan.items.filter((i) => i.change).slice(0, 10)) console.log(`    ${i.change!.changeType.padEnd(8)} ${i.id}`);
}

async function verify(kind: Kind, fresh: FreshRow<unknown>[], load: () => Promise<(ExistingEntity & { expiresAt: number })[]>) {
  const active = await load();
  const block = Number(await reader.getBlockNumber());
  const byId = new Map<string, string[]>();
  for (const e of active) byId.set(e.id, [...(byId.get(e.id) ?? []), e.hash]);
  const problems = [
    ...fresh.filter((f) => byId.get(f.id)?.length !== 1 || byId.get(f.id)![0] !== f.hash).map((f) => `not exactly one active+matching: ${f.id}`),
    ...[...byId.keys()].filter((id) => !fresh.some((f) => f.id === id)).map((id) => `active but not in source: ${id}`),
  ];
  const days = (b: number) => (((b - block) * 2) / 86400).toFixed(2);
  const exp = active.map((e) => e.expiresAt);
  console.log(
    `  ${kind}: ${active.length} active; expiry in ${days(Math.min(...exp))}–${days(Math.max(...exp))} days; ${problems.length ? `❌ ${problems.length} problems: ${problems.slice(0, 5).join("; ")}` : "✅ matches sources exactly"}`,
  );
  return problems.length === 0;
}

// ---------- main ----------

async function main() {
  console.log(`Keeper ${write ? "(WRITE)" : "(dry run)"} for publisher ${publisher}`);
  const wallet = write ? createPublisher() : undefined;
  let ok = true;

  if (!only || only === "descriptors") {
    const commit = arg("--commit") ?? (await latestCommit(REPO));
    console.log(`\nDescriptors: registry ${REPO}@${commit}`);
    const { rows } = await buildDescriptorRows(commit);
    const fresh: FreshRow<DescriptorRow>[] = rows.map((r) => ({ id: idOf(r.chainId, r.address), hash: r.descriptorHash, row: r }));
    const plan = planSync(await activeDescriptors(), fresh);
    summarize("descriptor", plan);
    if (wallet) {
      await apply(wallet, "descriptor", plan, descriptorCreate, () => commit);
      ok = (await verify("descriptor", fresh, activeDescriptors)) && ok;
    }
  }

  if (!only || only === "delegates") {
    console.log("\nDelegates: vendor sources + on-chain code");
    const { rows, log } = await buildDelegateRows();
    for (const line of log) if (!line.startsWith("✅")) console.log(`  ${line}`);
    const fresh: FreshRow<DelegateRow>[] = rows.map((r) => ({ id: idOf(r.chainId, r.address), hash: r.codeHash, row: r }));
    const plan = planSync(await activeDelegates(), fresh);
    summarize("delegate", plan);
    if (wallet) {
      await apply(wallet, "delegate", plan, delegateCreate, (r) => r?.sourceCommit);
      ok = (await verify("delegate", fresh, activeDelegates)) && ok;
    }
  }

  if (!write) console.log("\nDry run only. Re-run with --write to apply.");
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
