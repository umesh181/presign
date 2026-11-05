/**
 * Importer: vendor-published EIP-7702 delegates -> Arkiv `Delegate` entities.
 * Config: sources/delegates.json (one entry per vendor, each with an official source).
 *
 * Plan:
 * 1. For each vendor: get the latest commit touching source.path (GitHub API, GITHUB_TOKEN).
 * 2. Download the file at that commit; prove the address appears in it (else skip + log).
 * 3. For each chain we have an RPC for: eth_getCode -> skip if empty, else codeHash.
 * 4. Create/refresh the Delegate entity with provenance (repo, path, commit).
 */
import { readFile } from "node:fs/promises";
import { env } from "@presign/core/node";

async function main() {
  env("ETH_RPC_URL");
  const config = JSON.parse(await readFile(new URL("../../../sources/delegates.json", import.meta.url), "utf8"));
  for (const v of config.vendors) console.log(`TODO: import ${v.vendor} ${v.contract} ${v.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
