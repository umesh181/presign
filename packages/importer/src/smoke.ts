/**
 * Smoke test: read a descriptor back from Arkiv exactly like the web app does
 * (query createdBy publisher -> gunzip -> recompute fingerprint -> check()).
 * Run: npm run smoke -w @presign/importer [-- 0xADDRESS [chainId]]
 */
import { env } from "@presign/core/node";
import { checkTransaction, createReader, descriptorHash, descriptorLookup } from "@presign/core";
import type { Hex } from "viem";

const address = (process.argv[2] ?? "0xE592427A0AEce92De3Edee1F18E0157C05861564") as Hex;
const chainId = Number(process.argv[3] ?? 1);

const lookup = descriptorLookup(createReader(env("ARKIV_ACCESS_KEY")), env("PUBLISHER_ADDRESS") as Hex);
const rec = await lookup(chainId, address);
if (!rec) {
  console.log(`Not found on Arkiv: ${chainId}:${address}`);
  process.exit(1);
}
console.log(`Found on Arkiv: ${rec.entityKey}`);
console.log(`  owner: ${rec.protocolOwner}, attested: ${rec.attested}`);
console.log(`  stored hash:     ${rec.descriptorHash}`);
console.log(`  recomputed hash: ${descriptorHash(rec.descriptor)}`);

const result = await checkTransaction(
  { chainId, to: address, data: "0x414bf389" },
  { isContract: async () => true, lookupDescriptor: lookup, format: () => null },
);
console.log(`check(): ${result.status} - ${result.reason}`);
