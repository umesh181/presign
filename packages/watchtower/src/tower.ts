/**
 * Watchtower core: observe EIP-7702 delegations on-chain, inspect each delegate contract, and publish
 * the evidence to Arkiv (presign.radar.v1 profiles + readonly presign.alert.v1 alerts).
 *
 * - New delegate              -> create profile (+ alert if its code matches a known drainer family)
 * - Logic changed since last  -> readonly Alert + patch profile        <- "code change detected"
 * - Seen again                -> patch counters; re-checked profiles are kept alive (7 days)
 * Only real chain data. "Unknown" is not "malicious": the verdict is made by check(), not here.
 */
import { Alert, BadFamily, Delegate, PUBLIC_RPC, RadarProfile, createReader, inspectDelegate, retry, type DelegateFacts, type LogicDep } from "@presign/core";
import { createPublisher, env } from "@presign/core/node";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { and, eq } from "@arkiv-network/sdk/query";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";

export const publisher = env("PUBLISHER_ADDRESS") as Hex;
export const reader = createReader(env("ARKIV_ACCESS_KEY"));
export type Wallet = ReturnType<typeof createPublisher>;

const clients = new Map<number, PublicClient>();
export function client(chainId: number): PublicClient {
  if (!clients.has(chainId)) {
    const url = PUBLIC_RPC[chainId];
    if (!url) throw new Error(`No RPC for chain ${chainId}`);
    clients.set(chainId, createPublicClient({ transport: http(url, { timeout: 30_000, retryCount: 2 }) }) as PublicClient);
  }
  return clients.get(chainId)!;
}

/** Extra public RPCs to spread full-block reads over (each full mainnet block is ~0.4 MB). */
const SCAN_RPCS: Record<number, string[]> = { 1: ["https://eth.drpc.org", "https://rpc.mevblocker.io"] };
const scanPool = new Map<number, PublicClient[]>();
function scanClients(chainId: number): PublicClient[] {
  if (!scanPool.has(chainId))
    scanPool.set(chainId, [
      client(chainId),
      ...(SCAN_RPCS[chainId] ?? []).map((u) => createPublicClient({ transport: http(u, { timeout: 30_000, retryCount: 1 }) }) as PublicClient),
    ]);
  return scanPool.get(chainId)!;
}

const lc = (a: string) => a.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const now = () => Math.floor(Date.now() / 1000);

// ---------- read what is on Arkiv ----------

export interface ExistingProfile {
  key: Hex;
  logicHash: string;
  deps: LogicDep[];
  authorizations: number;
  accounts: number;
  lastSeenBlock: number;
  vendor: string;
  expiresAt: number;
}

async function pages<T>(fetchPage: (offset: number) => Promise<readonly T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await retry(() => fetchPage(offset), "arkiv query");
    out.push(...page);
    if (page.length < 100) return out;
  }
}

export async function loadProfiles(chainId: number): Promise<Map<string, ExistingProfile>> {
  const rows = await pages(async (offset) =>
    (
      await reader
        .select({ $key: true, $expiresAt: true, address: true, logicHash: true, deps: true, authorizations: true, accounts: true, lastSeenBlock: true, vendor: true })
        .from(RadarProfile)
        .where(and(eq("chainId", u64(chainId)), eq("status", "active")))
        .createdBy(publisher)
        .limit(100)
        .offset(offset)
        .fetch()
    ).entities,
  );
  const decode = (raw?: string) => (raw ? (JSON.parse(Buffer.from(raw.slice(2), "hex").toString("utf8")) as LogicDep[]) : []);
  return new Map(
    rows.map((e) => [
      lc(e.address.value),
      {
        key: e.$key,
        logicHash: e.logicHash.value,
        deps: decode(e.deps?.value as string | undefined),
        authorizations: Number(e.authorizations.value),
        accounts: Number(e.accounts.value),
        lastSeenBlock: Number(e.lastSeenBlock.value),
        vendor: e.vendor.value,
        expiresAt: Number(e.$expiresAt),
      },
    ]),
  );
}

/** Vendor-listed delegates on a chain (our own Delegate entities): address -> vendor. */
export async function loadVendors(chainId: number): Promise<Map<string, string>> {
  const rows = await pages(async (offset) =>
    (
      await reader
        .select({ address: true, vendor: true })
        .from(Delegate)
        .where(and(eq("chainId", u64(chainId)), eq("status", "active")))
        .createdBy(publisher)
        .limit(100)
        .offset(offset)
        .fetch()
    ).entities,
  );
  return new Map(rows.map((e) => [lc(e.address.value), e.vendor.value]));
}

/** Known drainer families on Arkiv: family -> label. */
export async function loadBadFamilies(): Promise<Map<string, string>> {
  const rows = await pages(async (offset) =>
    (await reader.select({ family: true, label: true }).from(BadFamily).where(eq("status", "active")).createdBy(publisher).limit(100).offset(offset).fetch()).entities,
  );
  return new Map(rows.map((e) => [e.family.value, e.label.value]));
}

// ---------- observe the chain ----------

export interface Seen {
  authorizations: number;
  accounts: Set<string>;
  firstBlock: number;
  lastBlock: number;
  firstTimestamp: number;
}

/** Every EIP-7702 authorization in blocks [from, to]: delegate -> who delegated, when. */
export async function scanBlocks(chainId: number, from: number, to: number, log = console.log): Promise<Map<string, Seen>> {
  const seen = new Map<string, Seen>();
  const pool = scanClients(chainId);
  for (let start = from; start <= to; start += 12) {
    const nums = Array.from({ length: Math.min(12, to - start + 1) }, (_, i) => BigInt(start + i));
    // Round-robin over RPCs; a retry moves to the next one.
    const blocks = await Promise.all(
      nums.map((n, i) => {
        let k = i;
        return retry(() => pool[k++ % pool.length]!.getBlock({ blockNumber: n, includeTransactions: true }), `block ${n}`);
      }),
    );
    for (const b of blocks)
      for (const tx of b.transactions) {
        const list = (tx as { authorizationList?: Parameters<typeof recoverAuthorizationAddress>[0]["authorization"][] }).authorizationList;
        if (!list?.length) continue;
        for (const auth of list) {
          const delegate = lc((auth as { address: string }).address);
          if (/^0x0{40}$/.test(delegate)) continue; // revocation
          const s = seen.get(delegate) ?? { authorizations: 0, accounts: new Set<string>(), firstBlock: Number(b.number), lastBlock: 0, firstTimestamp: Number(b.timestamp) };
          s.authorizations++;
          const authority = await recoverAuthorizationAddress({ authorization: auth }).catch(() => null);
          if (authority) s.accounts.add(lc(authority));
          s.firstBlock = Math.min(s.firstBlock, Number(b.number));
          s.firstTimestamp = Math.min(s.firstTimestamp, Number(b.timestamp));
          s.lastBlock = Math.max(s.lastBlock, Number(b.number));
          seen.set(delegate, s);
        }
      }
    if ((start - from) % 60 === 0 && to - from > 50) log(`  chain ${chainId}: scanned to block ${Math.min(start + 11, to)} of ${to}`);
  }
  return seen;
}

// ---------- decide what to write ----------

export interface ProfileWrite {
  address: Hex;
  facts: DelegateFacts;
  knownBad: string; // label or "none"
  vendor: string; // or "none"
  existing?: ExistingProfile;
  seen?: Seen;
  /** Set when the logic changed since the stored profile. */
  change?: string;
}

/** What changed between two logic snapshots, in one short sentence (Arkiv str is max 128 bytes). */
export function describeChange(oldDeps: LogicDep[], facts: DelegateFacts): string {
  for (const d of facts.deps) {
    const before = oldDeps.find((o) => lc(o.address) === lc(d.address));
    if (before && lc(before.implementation ?? "") !== lc(d.implementation ?? ""))
      return `Logic swapped via ${short(d.address)}: ${short(before.implementation ?? "none")} -> ${short(d.implementation ?? "none")}`;
    if (before && before.implCodeHash !== d.implCodeHash) return `Implementation code behind ${short(d.address)} changed`;
  }
  return "Its code or a contract it depends on changed";
}

/** Inspect each target delegate and work out the profile write (if any). */
export async function plan(
  chainId: number,
  targets: Hex[],
  ctx: { existing: Map<string, ExistingProfile>; vendors: Map<string, string>; bad: Map<string, string>; seen: Map<string, Seen> },
  log = console.log,
): Promise<ProfileWrite[]> {
  const out: ProfileWrite[] = [];
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const facts = await retry(() => inspectDelegate(client(chainId), a), `inspect ${a}`).catch((e) => {
          log(`  ! skip ${a}: ${String(e).slice(0, 80)}`);
          return null;
        });
        if (!facts) continue;
        const existing = ctx.existing.get(lc(a));
        const w: ProfileWrite = {
          address: a,
          facts,
          knownBad: ctx.bad.get(facts.family) ?? "none",
          vendor: ctx.vendors.get(lc(a)) ?? "none",
          ...(existing ? { existing } : {}),
          ...(ctx.seen.get(lc(a)) ? { seen: ctx.seen.get(lc(a))! } : {}),
        };
        if (existing && existing.logicHash !== facts.logicHash) w.change = describeChange(existing.deps, facts);
        out.push(w);
      }
    }),
  );
  return out;
}

// ---------- write to Arkiv ----------

// A bare string is taken as `str` (max 128 bytes) by the SDK: pass bytes as Uint8Array.
const enc = (deps: LogicDep[]) => new TextEncoder().encode(JSON.stringify(deps));

function profileValues(chainId: number, w: ProfileWrite, chainBlock: number) {
  const s = w.seen;
  const newSince = s && (!w.existing || s.lastBlock > w.existing.lastSeenBlock);
  return {
    chainId: u64(chainId),
    address: addr(w.address),
    status: "active",
    family: w.facts.family,
    knownBad: w.knownBad,
    upgradeable: w.facts.upgradeable,
    codeHash: w.facts.codeHash,
    logicHash: w.facts.logicHash,
    codeSize: u64(w.facts.size),
    delegatecall: w.facts.delegatecall,
    ...(w.facts.upgradeableVia ? { upgradeableVia: w.facts.upgradeableVia } : {}),
    vendor: w.vendor,
    firstSeenAt: u64(s?.firstTimestamp ?? now()),
    firstSeenBlock: u64(s?.firstBlock ?? chainBlock),
    lastSeenBlock: u64(Math.max(s?.lastBlock ?? 0, w.existing?.lastSeenBlock ?? 0)),
    authorizations: u64((w.existing?.authorizations ?? 0) + (newSince ? s!.authorizations : 0)),
    accounts: u64((w.existing?.accounts ?? 0) + (newSince ? s!.accounts.size : 0)),
    checkedAt: u64(now()),
    deps: enc(w.facts.deps),
  };
}

function alertCreate(chainId: number, delegate: Hex, alertType: string, message: string, extra: { blockNumber?: number; oldHash?: string; newHash?: string }) {
  return {
    schema: Alert,
    values: {
      alertType,
      chainId: u64(chainId),
      delegate: addr(delegate),
      detectedAt: u64(now()),
      message: message.slice(0, 120),
      ...(extra.blockNumber ? { blockNumber: u64(extra.blockNumber) } : {}),
      ...(extra.oldHash ? { oldHash: extra.oldHash } : {}),
      ...(extra.newHash ? { newHash: extra.newHash } : {}),
    },
    // Evidence can't be edited or deleted; anyone may keep it alive.
    expiration: ExpirationTime.fromDays(30),
    flags: { readonly: true, permissionlessExtension: true },
  };
}

export interface ApplyResult {
  created: number;
  patched: number;
  extended: number;
  alerts: { delegate: Hex; message: string }[];
  txs: string[];
}

/** One atomic batch per unit; units are batched 20 at a time, halved on failure. */
export async function apply(
  wallet: Wallet,
  chainId: number,
  writes: ProfileWrite[],
  at: { chainBlock: number; arkivBlock: number },
  log = console.log,
): Promise<ApplyResult> {
  const res: ApplyResult = { created: 0, patched: 0, extended: 0, alerts: [], txs: [] };
  type Unit = { creates: any[]; patches: any[]; extensions: any[] };
  const units: Unit[] = [];
  for (const w of writes) {
    const u: Unit = { creates: [], patches: [], extensions: [] };
    const values = profileValues(chainId, w, at.chainBlock);
    if (!w.existing) {
      u.creates.push({ schema: RadarProfile, values, expiration: ExpirationTime.fromDays(7), flags: { permissionlessExtension: true } });
      res.created++;
      if (w.knownBad !== "none") {
        const msg = `Matches known drainer code: ${w.knownBad}`;
        u.creates.push(alertCreate(chainId, w.address, "knownBadFamily", msg, { newHash: w.facts.family }));
        res.alerts.push({ delegate: w.address, message: msg });
      }
    } else {
      const counters = w.seen && w.seen.lastBlock > w.existing.lastSeenBlock;
      if (w.change || counters || w.existing.vendor !== w.vendor) {
        // Keep firstSeen as stored: a patch only sets the columns we pass.
        const { firstSeenAt: _f, firstSeenBlock: _b, chainId: _c, address: _a, status: _s, ...set } = values;
        u.patches.push({ schema: RadarProfile, entityKey: w.existing.key, set });
        res.patched++;
      }
      if (w.change) {
        u.creates.push(alertCreate(chainId, w.address, "logicChanged", w.change, { blockNumber: at.chainBlock, oldHash: w.existing.logicHash, newHash: w.facts.logicHash }));
        res.alerts.push({ delegate: w.address, message: w.change });
      }
      // Re-checked and still watched: keep alive for 7 more days once under 3 days left (2 s Arkiv blocks).
      if (w.existing.expiresAt - at.arkivBlock < (3 * 86400) / 2) {
        u.extensions.push({ entityKey: w.existing.key, expiration: ExpirationTime.fromDays(7) });
        res.extended++;
      }
    }
    if (u.creates.length || u.patches.length || u.extensions.length) units.push(u);
  }

  const send = async (batch: Unit[]): Promise<void> => {
    if (!batch.length) return;
    try {
      const r = await wallet.executeBatch({
        creates: batch.flatMap((u) => u.creates),
        patches: batch.flatMap((u) => u.patches),
        extensions: batch.flatMap((u) => u.extensions),
      });
      res.txs.push(r.txHash);
      log(`  wrote ${batch.length} profile update(s), tx ${r.txHash}`);
    } catch (e) {
      if (batch.length === 1) throw e;
      const mid = Math.ceil(batch.length / 2);
      await send(batch.slice(0, mid));
      await send(batch.slice(mid));
    }
  };
  for (let i = 0; i < units.length; i += 20) await send(units.slice(i, i + 20));
  return res;
}

/** The Arkiv block number "now" (expiry is counted in Arkiv blocks). */
export async function arkivBlock(): Promise<number> {
  const r = await reader.select({ $key: true }).from(RadarProfile).limit(1).fetch();
  return Number(r.blockNumber);
}
