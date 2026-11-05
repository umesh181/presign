/**
 * Importer: ERC-7730 clear-signing registry -> Arkiv `Descriptor` entities.
 * Source: https://github.com/ethereum/clear-signing-erc7730-registry (CC0-1.0).
 * Never fetch anything from Sourcify (track rule).
 *
 * Plan (owner: Person A):
 * 1. Download the registry at REGISTRY_COMMIT (tarball/API; avoid macOS case-collision on clone).
 * 2. Read index.calldata.json -> eip155:<chainId>:<address> => descriptor path.
 * 3. Resolve `includes`, compute descriptorHash (core/fingerprint.ts).
 * 4. Match against registry/<entity>/sigs/*.json (Cyfrin EAS attestations) -> attested.
 * 5. Skip entries that already exist with the same hash (query by chainId+address, createdBy publisher).
 * 6. executeBatch creates (gas cap 2^24 per tx) — resumable; log progress.
 * 7. Read back every created entity and verify before moving on.
 */
import { env } from "@presign/core/node";

async function main() {
  const repo = env("REGISTRY_REPO");
  const commit = env("REGISTRY_COMMIT");
  console.log(`TODO: import descriptors from ${repo}@${commit}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
