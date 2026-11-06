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
import "@presign/core/node"; // loads the repo-root .env
import { descriptorHash, gzip, resolveDescriptor } from "@presign/core";
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
  // TODO(Phase 2, step 7): executeBatch creates in chunks under the 2^24 gas cap,
  // skip (chainId,address) already on Arkiv with the same hash, read back each entity.
  throw new Error("--write not implemented yet (needs Arkiv setup from Phase 1)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
