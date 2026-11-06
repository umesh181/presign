/**
 * Watchtower CLI.
 *
 *   npm run watchtower                       # dry run: scan + inspect, print what it would write
 *   npm run watchtower -- --write            # publish profiles / alerts to Arkiv
 *   npm run watchtower -- --seed --write     # publish known drainer families (sources/known-bad.json)
 *   npm run watchtower -- --watch --write    # keep watching new blocks; alert on logic changes
 *
 * Options: --blocks N (look-back, default 300), --scan 1,11155111 (chains to scan for delegations),
 *          --chains 1,8453,... (chains whose vendor delegates are profiled, default: all), --address 0x..@chainId
 */
import { BadFamily, PUBLIC_RPC, codeFamily, retry } from "@presign/core";
import { createPublisher } from "@presign/core/node";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Hex } from "viem";
import { apply, arkivBlock, client, loadBadFamilies, loadProfiles, loadVendors, plan, scanBlocks, type Seen } from "./tower.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const write = flag("write");
const ids = (s: string | undefined, d: number[]) => (s ? s.split(",").map(Number) : d);

/** Publish each known drainer's code family once (dedupe by family). */
export async function seedBadFamilies(doWrite: boolean) {
  const file = JSON.parse(readFileSync(new URL("../../../sources/known-bad.json", import.meta.url), "utf8")) as {
    entries: { chainId: number; address: Hex; label: string; source: string }[];
  };
  const have = await loadBadFamilies();
  const fresh = new Map<string, (typeof file.entries)[number]>();
  for (const e of file.entries) {
    const code = await retry(() => client(e.chainId).getCode({ address: e.address }), `code ${e.address}`);
    if (!code || code === "0x") {
      console.log(`  ! no code at ${e.address} (${e.label}), skipped`);
      continue;
    }
    const family = codeFamily(code);
    if (!have.has(family) && !fresh.has(family)) fresh.set(family, e);
  }
  console.log(`Known drainers: ${file.entries.length} contracts -> ${have.size + fresh.size} code families (${fresh.size} new)`);
  if (!doWrite || !fresh.size) return;
  const wallet = createPublisher();
  const r = await wallet.executeBatch({
    creates: [...fresh].map(([family, e]) => ({
      schema: BadFamily,
      values: { family, label: e.label, exampleChainId: u64(e.chainId), exampleAddress: addr(e.address), source: e.source, status: "active" },
      expiration: ExpirationTime.fromDays(30),
      flags: { permissionlessExtension: true },
    })),
  });
  console.log(`  published ${fresh.size} families, tx ${r.txHash}`);
}

interface ChainState {
  lastBlock: number;
}

/** One pass for one chain: scan [from, head], inspect seen + known delegates, publish. */
export async function runChain(chainId: number, opts: { from?: number; scan: boolean; recheckAll: boolean; extra: Hex[] }, doWrite: boolean, log = console.log) {
  const head = Number(await retry(() => client(chainId).getBlockNumber(), "head"));
  const from = opts.from ?? head - Number(opt("blocks") ?? 300) + 1;
  const [existing, vendors, bad] = await Promise.all([loadProfiles(chainId), loadVendors(chainId), loadBadFamilies()]);
  const seen: Map<string, Seen> = opts.scan && from <= head ? await scanBlocks(chainId, from, head, log) : new Map();
  const auths = [...seen.values()].reduce((s, x) => s + x.authorizations, 0);
  if (opts.scan) log(`chain ${chainId}: blocks ${from}-${head}: ${auths} authorizations to ${seen.size} delegates`);

  // Targets: newly seen delegates, every vendor delegate, the extra addresses, and stored profiles.
  // Non-upgradeable code can't change after deployment, so a quick re-check only covers profiles
  // whose logic depends on a proxy or beacon; a full pass re-checks everything.
  const targets = new Set<string>([...seen.keys(), ...opts.extra.map((a) => a.toLowerCase())]);
  if (opts.recheckAll) for (const a of [...vendors.keys(), ...existing.keys()]) targets.add(a);
  else for (const [a, p] of existing) if (p.deps.some((d) => d.implementation)) targets.add(a);

  const writes = await plan(chainId, [...targets] as Hex[], { existing, vendors, bad, seen }, log);
  const created = writes.filter((w) => !w.existing);
  const changed = writes.filter((w) => w.change);
  for (const w of created)
    log(`  + ${w.address} ${w.vendor !== "none" ? `[${w.vendor}] ` : ""}${w.facts.upgradeable ? "UPGRADEABLE " : ""}${w.knownBad !== "none" ? `KNOWN DRAINER (${w.knownBad}) ` : ""}${w.seen ? `${w.seen.accounts.size} accounts` : ""}`);
  for (const w of changed) log(`  🚨 ${w.address}: ${w.change}`);
  log(`chain ${chainId}: ${writes.length} inspected, ${created.length} new, ${changed.length} logic changes`);

  if (doWrite && writes.length) {
    const r = await apply(createPublisher(), chainId, writes, { chainBlock: head, arkivBlock: await arkivBlock() }, log);
    log(`chain ${chainId}: created ${r.created}, updated ${r.patched}, kept alive ${r.extended}, alerts ${r.alerts.length}`);
    return { head, result: r };
  }
  return { head };
}

async function main() {
  const scanChains = ids(opt("scan"), [1, 11155111]);
  const profileChains = ids(opt("chains"), Object.keys(PUBLIC_RPC).map(Number));
  const extra = new Map<number, Hex[]>();
  for (let i = 0; i < args.length; i++)
    if (args[i] === "--address") {
      const [a, c] = args[i + 1]!.split("@");
      extra.set(Number(c ?? 1), [...(extra.get(Number(c ?? 1)) ?? []), a as Hex]);
    }
  if (!write) console.log("DRY RUN (add --write to publish to Arkiv)");
  if (flag("seed")) await seedBadFamilies(write);

  const state = new Map<number, ChainState>();
  for (const chainId of new Set([...profileChains, ...scanChains, ...extra.keys()])) {
    const r = await runChain(chainId, { scan: scanChains.includes(chainId), recheckAll: true, extra: extra.get(chainId) ?? [] }, write);
    state.set(chainId, { lastBlock: r.head });
  }

  if (!flag("watch")) return;
  console.log(`\nWatching chains ${scanChains.join(", ")} for new delegations and logic changes (Ctrl+C to stop)…`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 12_000));
    for (const chainId of new Set([...scanChains, ...extra.keys()])) {
      const s = state.get(chainId)!;
      try {
        const r = await runChain(chainId, { from: s.lastBlock + 1, scan: scanChains.includes(chainId), recheckAll: false, extra: extra.get(chainId) ?? [] }, write, (m) => {
          if (/🚨|\+ 0x|alerts [1-9]|created [1-9]/.test(m)) console.log(m);
        });
        s.lastBlock = r.head;
      } catch (e) {
        console.log(`  ! chain ${chainId}: ${String(e).split("\n")[0]}`);
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href)
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
