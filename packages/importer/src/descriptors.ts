/**
 * Importer: ERC-7730 clear-signing registry -> Arkiv `Descriptor` entities.
 * Source: https://github.com/ethereum/clear-signing-erc7730-registry (CC0-1.0).
 * Never fetch anything from Sourcify (track rule).
 *
 * Steps:
 * 1. Pin REGISTRY_COMMIT (or take latest master) and fetch the tarball in memory.
 * 2. index.calldata.json -> one entity per (chainId, address).
 * 3. Resolve `includes`, compute the ERC-8176 descriptorHash.
 * 4. attested = a sig file signed by a trusted auditor carries exactly this hash.
 * 5. Validate Arkiv limits (str <= 128 bytes, bytes <= 128 KiB per create).
 * 6. (--write) batch-write to Arkiv. TODO once the publisher wallet is set up.
 *
 * Run: npm run import:descriptors            (dry run: build + validate, no writes)
 *      npm run import:descriptors -- --write (writes to Arkiv; needs .env)
 */
import { pathToFileURL } from "node:url";
import { createPublisher, env } from "@presign/core/node"; // also loads the repo-root .env
import { Descriptor, createReader, descriptorHash, gzip, resolveDescriptor } from "@presign/core";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { getAddress, type Hex } from "viem";
import { readAttestation } from "./attestations.ts";
import { fetchRegistry, latestCommit } from "./registry.ts";

const REPO = process.env.REGISTRY_REPO || "ethereum/clear-signing-erc7730-registry";
const MAX_STR = 128; // Arkiv str limit in BYTES
const MAX_BYTES = 128 * 1024; // Arkiv bytes budget per create

/** The values we will write for one Descriptor entity (see core/src/schemas.ts). */
export interface DescriptorRow {
  chainId: number;
  address: Hex;
  descriptorHash: Hex;
  attested: boolean;
  status: "active";
  importedAt: number;
  protocolOwner: string;
  sourceRepo: string;
  sourceCommit: string;
  sourcePath: string;
  /** gzip-compressed resolved descriptor JSON (UTF-8). */
  descriptor: Uint8Array;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Truncate to a max number of UTF-8 bytes (Arkiv str limit). */
function fitStr(s: string, max = MAX_STR): string {
  let out = s;
  while (utf8(out).length > max) out = out.slice(0, -1);
  return out;
}

export async function buildDescriptorRows(commit: string) {
  const { files } = await fetchRegistry(REPO, commit);
  const load = (p: string) => files.get(p);
  const index: Record<string, string> = JSON.parse(files.get("index.calldata.json") ?? "{}");

  // Attested hashes per descriptor file, only from signatures we verified ourselves.
  const attested = new Map<string, Set<string>>();
  for (const sigPath of [...files.keys()].filter((p) => /^registry\/[^/]+\/sigs\/.+\.json$/.test(p))) {
    const att = await readAttestation(sigPath, files.get(sigPath)!);
    if (!att?.auditor) continue;
    if (!attested.has(att.descriptorPath)) attested.set(att.descriptorPath, new Set());
    attested.get(att.descriptorPath)!.add(att.descriptorHash);
  }

  // Resolve + hash each descriptor FILE once (614 files serve 1,917 deployments).
  const resolved = new Map<string, { gz: Uint8Array; rawSize: number; hash: Hex; owner: string }>();
  const errors: string[] = [];
  for (const path of new Set(Object.values(index))) {
    try {
      const doc = resolveDescriptor(path, load);
      const raw = utf8(JSON.stringify(doc));
      resolved.set(path, { gz: await gzip(raw), rawSize: raw.length, hash: descriptorHash(doc), owner: doc.metadata?.owner ?? "" });
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`);
    }
  }

  const importedAt = Math.floor(Date.now() / 1000);
  const rows: DescriptorRow[] = [];
  const problems: string[] = [...errors];
  for (const [key, path] of Object.entries(index)) {
    const [, chain, address] = key.split(":");
    const r = resolved.get(path);
    if (!r || !chain || !address) continue;
    const row: DescriptorRow = {
      chainId: Number(chain),
      address: getAddress(address),
      descriptorHash: r.hash,
      attested: attested.get(path)?.has(r.hash) ?? false,
      status: "active",
      importedAt,
      protocolOwner: fitStr(r.owner),
      sourceRepo: REPO,
      sourceCommit: commit,
      sourcePath: path,
      descriptor: r.gz,
    };
    if (utf8(row.sourcePath).length > MAX_STR) problems.push(`sourcePath > ${MAX_STR}B: ${path}`);
    if (row.descriptor.length > MAX_BYTES) problems.push(`descriptor > 128KiB (${row.descriptor.length}B): ${path}`);
    rows.push(row);
  }
  const rawTotal = Object.values(index).reduce((sum, p) => sum + (resolved.get(p)?.rawSize ?? 0), 0);
  return { rows, problems: [...new Set(problems)], uniqueFiles: resolved.size, rawTotal };
}

async function main() {
  const write = process.argv.includes("--write");
  const commit = process.env.REGISTRY_COMMIT || (await latestCommit(REPO));
  console.log(`Registry ${REPO}@${commit}`);

  const { rows, problems, uniqueFiles, rawTotal } = await buildDescriptorRows(commit);
  const sizes = rows.map((r) => r.descriptor.length).sort((a, b) => a - b);
  const total = sizes.reduce((a, b) => a + b, 0);
  console.log(`Entities to write: ${rows.length} (from ${uniqueFiles} descriptor files)`);
  console.log(`Chains: ${new Set(rows.map((r) => r.chainId)).size}, attested: ${rows.filter((r) => r.attested).length}`);
  console.log(
    `Descriptor gzip size: median ${sizes[Math.floor(sizes.length / 2)]}B, max ${sizes.at(-1)}B, total ${(total / 1024 / 1024).toFixed(1)} MiB (raw ${(rawTotal / 1024 / 1024).toFixed(1)} MiB)`,
  );
  console.log(problems.length ? `Problems (${problems.length}):\n  ${problems.slice(0, 20).join("\n  ")}` : "No limit problems.");

  if (!write) {
    console.log("\nDry run only. Re-run with --write once ARKIV_ACCESS_KEY + PUBLISHER_PRIVATE_KEY are set.");
    return;
  }

  // Optional filters for the first end-to-end test: --limit N, --only 0xADDRESS
  const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
  let todo = rows;
  if (process.argv.includes("--only")) todo = todo.filter((r) => r.address.toLowerCase() === arg("--only")?.toLowerCase());
  if (process.argv.includes("--limit")) todo = todo.slice(0, Number(arg("--limit")));
  await writeRows(todo);
}

/** The Arkiv create for one descriptor row (shared with the keeper so both write the same format). */
export function descriptorCreate(r: DescriptorRow) {
  return {
    schema: Descriptor,
    values: {
      chainId: u64(r.chainId),
      address: addr(r.address),
      descriptorHash: r.descriptorHash,
      attested: r.attested,
      status: r.status,
      importedAt: u64(r.importedAt),
      protocolOwner: r.protocolOwner,
      sourceRepo: r.sourceRepo,
      sourceCommit: r.sourceCommit,
      sourcePath: r.sourcePath,
      descriptor: r.descriptor,
    },
    // Trust expires unless the keeper re-confirms it. Anyone may extend (keep alive),
    // nobody but us can change the content.
    expiration: ExpirationTime.fromDays(7),
    flags: { permissionlessExtension: true },
  };
}

const keyOf = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

/** All active descriptors our publisher already wrote, keyed by chainId:address. */
async function loadExisting(publisher: Hex) {
  const reader = createReader(env("ARKIV_ACCESS_KEY"));
  const existing = new Map<string, { key: Hex; hash: string }>();
  for (let offset = 0; ; offset += 100) {
    const page = await reader
      .select({ $key: true, chainId: true, address: true, descriptorHash: true, status: true })
      .from(Descriptor)
      .createdBy(publisher)
      .limit(100)
      .offset(offset)
      .fetch();
    for (const e of page.entities) {
      if (e.status.value !== "active") continue;
      existing.set(keyOf(Number(e.chainId.value), e.address.value), { key: e.$key, hash: e.descriptorHash.value });
    }
    if (page.entities.length < 100) break;
  }
  return existing;
}

/**
 * Write rows to Arkiv. Safe to re-run (that is how it resumes):
 * - same (chainId, address) with the same hash  -> skip
 * - same (chainId, address) with a new hash     -> create new, patch old status to "superseded"
 * Batches stay well under the 2^24 gas cap per transaction.
 */
/**
 * Resume-safe writes: on an error (e.g. RPC timeout), wait, then run again. Each attempt first
 * re-reads what is already on Arkiv, so batches that did land are skipped, never written twice.
 */
async function writeRows(rows: DescriptorRow[]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await writeRowsOnce(rows);
    } catch (e) {
      if (attempt >= 3) throw e;
      console.warn(`\nWrite attempt ${attempt} failed (${(e as Error).message.split("\n")[0]}); re-reading Arkiv and resuming in ${5 * attempt}s…`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

async function writeRowsOnce(rows: DescriptorRow[]) {
  const wallet = createPublisher();
  const publisher = wallet.account.address;
  console.log(`\nPublisher: ${publisher}`);
  const existing = await loadExisting(publisher);
  console.log(`Already on Arkiv: ${existing.size}`);

  const creates = rows.filter((r) => existing.get(keyOf(r.chainId, r.address))?.hash !== r.descriptorHash);
  const supersede = creates.map((r) => existing.get(keyOf(r.chainId, r.address))?.key).filter((k): k is Hex => !!k);
  console.log(`To create: ${creates.length}, to supersede: ${supersede.length}, unchanged: ${rows.length - creates.length}`);

  const MAX_OPS = 20;
  const MAX_PAYLOAD = 64 * 1024;
  let written = 0;
  let i = 0;
  while (i < creates.length) {
    // Fill one batch by op count and payload size.
    const batch: DescriptorRow[] = [];
    let payload = 0;
    while (i < creates.length && batch.length < MAX_OPS && payload + creates[i]!.descriptor.length <= MAX_PAYLOAD) {
      payload += creates[i]!.descriptor.length;
      batch.push(creates[i++]!);
    }
    if (batch.length === 0) batch.push(creates[i++]!); // a single large row still goes alone

    const result = await wallet.executeBatch({
      creates: batch.map(descriptorCreate),
    });
    written += result.createdEntities.length;
    console.log(`  batch ok: +${result.createdEntities.length} (total ${written}/${creates.length}) tx ${result.txHash}`);
  }

  for (let j = 0; j < supersede.length; j += MAX_OPS) {
    await wallet.executeBatch({
      patches: supersede.slice(j, j + MAX_OPS).map((entityKey) => ({ schema: Descriptor, entityKey, set: { status: "superseded" } })),
    });
  }

  // Read back: everything we intended must now be on Arkiv with the right hash.
  const after = await loadExisting(publisher);
  const missing = rows.filter((r) => after.get(keyOf(r.chainId, r.address))?.hash !== r.descriptorHash);
  console.log(missing.length ? `❌ ${missing.length} rows not confirmed on Arkiv` : `✅ All ${rows.length} rows confirmed on Arkiv`);
  if (rows[0]) {
    const sample = after.get(keyOf(rows[0].chainId, rows[0].address));
    if (sample) console.log(`Example entity: https://rabdi.explorer.arkiv.network/entity/${sample.key}`);
  }
}

// Run only when executed directly (the keeper imports this module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
