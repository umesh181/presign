/**
 * Importer: vendor-published EIP-7702 delegates -> Arkiv `Delegate` entities.
 * Config: sources/delegates.json (one entry per vendor, each with an OFFICIAL source file).
 *
 * Inclusion rule for one (chainId, address):
 *  1. the vendor's source file, at its latest commit, still contains the address (proven, not assumed)
 *  2. the address has code on that chain
 *  3. that code is the SAME CONTRACT as on Ethereum mainnet: identical, or identical except for
 *     chain-specific immutables (same length, <= 64 differing bytes). E.g. MetaMask's and ZeroDev's
 *     delegators differ per chain only in the chain id and the cached EIP-712 domain separator.
 *  Each chain still stores its OWN exact codeHash; check() compares live code against it.
 *
 * Run: npm run import:delegates            (dry run: verify + print)
 *      npm run import:delegates -- --write (write to Arkiv; re-running writes nothing new)
 */
import { readFile } from "node:fs/promises";
import { createPublisher, env } from "@presign/core/node";
import { Delegate, PUBLIC_RPC, codeHash, createReader } from "@presign/core";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { createPublicClient, getAddress, http, type Hex } from "viem";

interface VendorSource {
  vendor: string;
  contract: string;
  version?: string;
  address: string;
  source: { type: "github"; repo: string; ref: string; path: string };
}

export interface DelegateRow {
  chainId: number;
  address: Hex;
  codeHash: Hex;
  vendor: string;
  status: "active";
  importedAt: number;
  contractName: string;
  version?: string;
  sourceType: string;
  sourceRepo: string;
  sourcePath: string;
  sourceCommit: string;
}

const ghHeaders = (): Record<string, string> => ({
  "User-Agent": "presign-importer",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

/** Latest commit that touched the vendor's file, and the file content at exactly that commit. */
async function fetchSource(src: VendorSource["source"]) {
  const q = `https://api.github.com/repos/${src.repo}/commits?path=${encodeURIComponent(src.path)}&sha=${src.ref}&per_page=1`;
  const res = await fetch(q, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${src.repo}/${src.path}`);
  const [latest] = (await res.json()) as { sha: string }[];
  if (!latest) throw new Error(`No commits for ${src.repo}/${src.path}`);
  const file = await fetch(`https://raw.githubusercontent.com/${src.repo}/${latest.sha}/${src.path}`, { headers: ghHeaders() });
  if (!file.ok) throw new Error(`raw ${file.status} for ${src.repo}/${src.path}`);
  return { commit: latest.sha, content: await file.text() };
}

const clients = Object.fromEntries(
  Object.entries(PUBLIC_RPC).map(([id, url]) => [Number(id), createPublicClient({ transport: http(url) })]),
);

async function getCode(chainId: number, address: Hex): Promise<Hex | null> {
  const code = await clients[chainId]!.getCode({ address });
  return code && code !== "0x" ? code : null;
}

/** Same length and at most `max` differing bytes (chain-specific immutables). */
function sameContract(a: Hex, b: Hex, max = 64): { same: boolean; diffBytes: number } {
  if (a.length !== b.length) return { same: false, diffBytes: Infinity };
  let diffBytes = 0;
  for (let i = 2; i < a.length; i += 2) if (a.slice(i, i + 2) !== b.slice(i, i + 2)) diffBytes++;
  return { same: diffBytes <= max, diffBytes };
}

export async function buildDelegateRows() {
  const config = JSON.parse(await readFile(new URL("../../../sources/delegates.json", import.meta.url), "utf8"));
  const rows: DelegateRow[] = [];
  const log: string[] = [];
  const importedAt = Math.floor(Date.now() / 1000);

  for (const v of config.vendors as VendorSource[]) {
    const address = getAddress(v.address);
    const { commit, content } = await fetchSource(v.source);
    if (!content.toLowerCase().includes(address.toLowerCase())) {
      log.push(`❌ ${v.vendor}: address ${address} NOT found in ${v.source.repo}/${v.source.path}@${commit.slice(0, 7)}, skipped`);
      continue;
    }
    const reference = await getCode(1, address);
    if (!reference) {
      log.push(`❌ ${v.vendor}: no code on Ethereum mainnet, skipped`);
      continue;
    }
    const chains: string[] = [];
    for (const chainId of Object.keys(PUBLIC_RPC).map(Number)) {
      const code = chainId === 1 ? reference : await getCode(chainId, address);
      if (!code) continue;
      const { same, diffBytes } = sameContract(reference, code);
      if (!same) {
        log.push(`⚠️  ${v.vendor} on chain ${chainId}: different contract than mainnet (${diffBytes} bytes differ), skipped`);
        continue;
      }
      chains.push(diffBytes ? `${chainId}*` : `${chainId}`);
      rows.push({
        chainId,
        address,
        codeHash: codeHash(code),
        vendor: v.vendor,
        status: "active",
        importedAt,
        contractName: v.contract,
        version: v.version,
        sourceType: v.source.type,
        sourceRepo: v.source.repo,
        sourcePath: v.source.path,
        sourceCommit: commit,
      });
    }
    log.push(`✅ ${v.vendor} ${v.contract} ${address}: listed in ${v.source.repo}@${commit.slice(0, 7)}, same contract on chains ${chains.join(", ")}`);
  }
  return { rows, log };
}

const keyOf = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

async function loadExisting(publisher: Hex) {
  const reader = createReader(env("ARKIV_ACCESS_KEY"));
  const existing = new Map<string, { key: Hex; codeHash: string }>();
  for (let offset = 0; ; offset += 100) {
    const page = await reader
      .select({ $key: true, chainId: true, address: true, codeHash: true, status: true })
      .from(Delegate)
      .createdBy(publisher)
      .limit(100)
      .offset(offset)
      .fetch();
    for (const e of page.entities) {
      if (e.status.value === "active") existing.set(keyOf(Number(e.chainId.value), e.address.value), { key: e.$key, codeHash: e.codeHash.value });
    }
    if (page.entities.length < 100) break;
  }
  return existing;
}

/** Same rules as the descriptor importer: skip unchanged, create changed, supersede old. */
async function writeRows(rows: DelegateRow[]) {
  const wallet = createPublisher();
  const publisher = wallet.account.address;
  const existing = await loadExisting(publisher);
  const creates = rows.filter((r) => existing.get(keyOf(r.chainId, r.address))?.codeHash !== r.codeHash);
  const supersede = creates.map((r) => existing.get(keyOf(r.chainId, r.address))?.key).filter((k): k is Hex => !!k);
  console.log(`\nPublisher ${publisher}: already on Arkiv ${existing.size}, to create ${creates.length}, to supersede ${supersede.length}`);

  for (let i = 0; i < creates.length; i += 20) {
    const result = await wallet.executeBatch({
      creates: creates.slice(i, i + 20).map((r) => ({
        schema: Delegate,
        values: {
          chainId: u64(r.chainId),
          address: addr(r.address),
          codeHash: r.codeHash,
          vendor: r.vendor,
          status: r.status,
          importedAt: u64(r.importedAt),
          contractName: r.contractName,
          ...(r.version ? { version: r.version } : {}),
          sourceType: r.sourceType,
          sourceRepo: r.sourceRepo,
          sourcePath: r.sourcePath,
          sourceCommit: r.sourceCommit,
        },
        expiration: ExpirationTime.fromDays(7),
        flags: { permissionlessExtension: true },
      })),
    });
    console.log(`  batch ok: +${result.createdEntities.length} tx ${result.txHash}`);
  }
  for (let i = 0; i < supersede.length; i += 20) {
    await wallet.executeBatch({
      patches: supersede.slice(i, i + 20).map((entityKey) => ({ schema: Delegate, entityKey, set: { status: "superseded" } })),
    });
  }

  const after = await loadExisting(publisher);
  const missing = rows.filter((r) => after.get(keyOf(r.chainId, r.address))?.codeHash !== r.codeHash);
  console.log(missing.length ? `❌ ${missing.length} rows not confirmed on Arkiv` : `✅ All ${rows.length} delegate rows confirmed on Arkiv`);
}

async function main() {
  const { rows, log } = await buildDelegateRows();
  console.log(log.join("\n"));
  console.log("(* = identical to mainnet except chain-specific immutables)");
  console.log(`\nDelegate entities: ${rows.length} (${new Set(rows.map((r) => r.vendor)).size} vendors, ${new Set(rows.map((r) => r.chainId)).size} chains)`);
  if (!process.argv.includes("--write")) {
    console.log("Dry run only. Re-run with --write to write to Arkiv.");
    return;
  }
  await writeRows(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
