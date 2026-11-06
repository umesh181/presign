/**
 * Phase 2 gate: prove our ERC-8176 fingerprint matches the auditor attestations
 * BEFORE importing anything to Arkiv.
 *
 * Run: npm run verify:registry   (uses REGISTRY_COMMIT from .env, or the latest master commit)
 */
import "@presign/core/node"; // loads the repo-root .env
import { descriptorHash, resolveDescriptor } from "@presign/core";
import { readAttestation } from "./attestations.ts";
import { fetchRegistry, latestCommit } from "./registry.ts";

const REPO = process.env.REGISTRY_REPO || "ethereum/clear-signing-erc7730-registry";

async function main() {
  const commit = process.env.REGISTRY_COMMIT || (await latestCommit(REPO));
  console.log(`Registry ${REPO}@${commit}`);
  const { files } = await fetchRegistry(REPO, commit);
  console.log(`Files in snapshot: ${files.size}`);

  // Coverage overview from the registry's own index.
  const index: Record<string, string> = JSON.parse(files.get("index.calldata.json") ?? "{}");
  const chains = new Set(Object.keys(index).map((k) => k.split(":")[1]));
  console.log(`Calldata deployments: ${Object.keys(index).length} across ${chains.size} chains, ${new Set(Object.values(index)).size} descriptor files`);

  const load = (p: string) => files.get(p);
  const sigPaths = [...files.keys()].filter((p) => /^registry\/[^/]+\/sigs\/.+\.json$/.test(p));
  let matched = 0;
  let untrustedSigner = 0;
  const mismatches: string[] = [];
  const missing: string[] = [];

  for (const sigPath of sigPaths) {
    const att = await readAttestation(sigPath, files.get(sigPath)!);
    if (!att) continue;
    if (!att.auditor) {
      untrustedSigner++;
      continue;
    }
    if (!files.has(att.descriptorPath)) {
      missing.push(att.descriptorPath);
      continue;
    }
    const raw = JSON.parse(files.get(att.descriptorPath)!);
    const ours = descriptorHash(resolveDescriptor(att.descriptorPath, load));
    if (ours === att.descriptorHash) matched++;
    else mismatches.push(`${att.descriptorPath}${raw.includes ? " (has includes)" : ""}`);
  }

  console.log(`\nAttestations: ${sigPaths.length} sig files`);
  console.log(`  ✅ hash matches (signer verified): ${matched}`);
  console.log(`  ❌ hash mismatch: ${mismatches.length}`);
  console.log(`  ⚠️  descriptor file not found: ${missing.length}`);
  console.log(`  ⚠️  signer not a trusted auditor: ${untrustedSigner}`);
  for (const m of mismatches.slice(0, 15)) console.log(`     mismatch: ${m}`);
  for (const m of missing.slice(0, 5)) console.log(`     missing: ${m}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
