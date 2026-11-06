/**
 * End-to-end smoke test, same path as the web app:
 * real mainnet Uniswap tx -> descriptor from Arkiv (createdBy publisher) -> gunzip ->
 * fingerprint re-check -> ERC-7730 formatter -> token symbols read live from Ethereum mainnet.
 * Run: npm run smoke -w @presign/importer
 */
import { env } from "@presign/core/node";
import { checkTransaction, createReader, descriptorLookup, erc20Lookup, formatCalldata, type FormattedField } from "@presign/core";
import { createPublicClient, http, parseTransaction, type Hex, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import registryTests from "../../../fixtures/registry/calldata-UniswapV3SwapRouter.tests.json" with { type: "json" };

const vector = registryTests.tests[0]!;
const tx = parseTransaction(vector.rawTx as Hex);
console.log(`Mainnet tx ${vector.txHash} (${vector.description})`);

const lookup = descriptorLookup(createReader(env("ARKIV_ACCESS_KEY")), env("PUBLISHER_ADDRESS") as Hex);
const mainnetClient = createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC_URL || undefined) });
const tokens = erc20Lookup({ 1: mainnetClient as PublicClient });

const result = await checkTransaction(
  { chainId: tx.chainId!, to: tx.to!, value: tx.value ?? 0n, data: tx.data! },
  {
    isContract: async () => true,
    lookupDescriptor: lookup,
    format: (descriptor, t) => formatCalldata(descriptor, { ...t, data: t.data! }, tokens),
  },
);
console.log(`\ncheck(): ${result.status.toUpperCase()} - ${result.reason}`);
for (const f of (result.details?.fields as FormattedField[] | undefined) ?? []) console.log(`  ${f.label}: ${f.value}`);
console.log(`  protocol: ${result.details?.protocol}, attested: ${result.details?.attested}, entity: ${result.details?.entityKey}`);
console.log(`\nRegistry expects: ${vector.expected.interpolatedIntent}`);
