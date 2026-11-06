/**
 * Signer Guard demo on Sepolia, with the test (publisher) wallet. Real transactions, testnet only.
 *
 *  1. Delegate to MetaMask's official delegator  -> PreSign trusted -> REAL EIP-7702 tx on Sepolia
 *  2. Delegate to a contract deployed seconds ago -> PreSign blocked -> refused, nothing signed
 *     (the contract is harmless: its only code returns the number 42)
 *  3. The REAL Binance delegation, read from Ethereum mainnet (read-only) -> refused
 *  4. Revoke the delegation (zero address) -> PreSign trusted -> REAL tx, wallet restored
 *
 * Run: npm run demo -w @presign/guard        (add -- --keep to skip step 4)
 */
import { env } from "@presign/core/node";
import { PUBLIC_RPC, checkDelegation, codeHash, createReader, delegateDepsFor, type DelegateDeps } from "@presign/core";
import { createPublicClient, createWalletClient, http, zeroAddress, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { RefusedToSign, guardedDelegate } from "./index.ts";

const METAMASK_DELEGATOR = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B";
const BINANCE_TX = "0xad99264d5532ae0dd04b2004eebda05f25657e70dacb764f7ac8d4ccd051298b";
const HARMLESS_INITCODE = "0x600a600c600039600a6000f3602a60005260206000f3"; // deploys code that returns 42

const account = privateKeyToAccount(env("PUBLISHER_PRIVATE_KEY") as Hex);
const wallet = createWalletClient({ account, chain: sepolia, transport: http(PUBLIC_RPC[sepolia.id]) });
const clients: Record<number, PublicClient> = {
  [sepolia.id]: createPublicClient({ chain: sepolia, transport: http(PUBLIC_RPC[sepolia.id]) }) as PublicClient,
  [mainnet.id]: createPublicClient({ chain: mainnet, transport: http(PUBLIC_RPC[mainnet.id]) }) as PublicClient,
};
const deps: DelegateDeps = delegateDepsFor(createReader(env("ARKIV_ACCESS_KEY")), env("PUBLISHER_ADDRESS") as Hex, clients);
const sepoliaTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
const sepoliaReader = clients[sepolia.id]!;

/**
 * Wallet code once the node we hit has caught up. Public RPCs are load-balanced, so a node may
 * lag the receipt by a few seconds: poll until the code shows the expected delegation state.
 */
async function codeAfter(contract: Hex): Promise<Hex> {
  const expected = /^0x0{40}$/i.test(contract) ? "0x" : `0xef0100${contract.slice(2).toLowerCase()}`;
  let code: Hex = "0x";
  for (let i = 0; i < 15; i++) {
    code = (await sepoliaReader.getCode({ address: account.address })) ?? "0x";
    if (code.toLowerCase() === expected) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return code;
}

async function attempt(title: string, contract: Hex) {
  console.log(`\n${title}\n  delegate: ${contract}`);
  try {
    const { result, txHash } = await guardedDelegate(wallet, contract, deps);
    console.log(`  PreSign: ✅ ${result.status.toUpperCase()}: ${result.reason}`);
    const receipt = await sepoliaReader.waitForTransactionReceipt({ hash: txHash });
    const code = await codeAfter(contract);
    console.log(`  → signed & sent (${receipt.status}): ${sepoliaTx(txHash)}`);
    console.log(`  → wallet code now: ${code}${code.startsWith("0xef0100") ? "  (EIP-7702 delegation designator)" : "  (plain wallet)"}`);
  } catch (e) {
    if (!(e instanceof RefusedToSign)) throw e;
    console.log(`  PreSign: 🛑 ${e.result.status.toUpperCase()}: ${e.result.reason}`);
    for (const w of e.result.warnings) console.log(`  ⚠️  ${w}`);
    console.log("  → REFUSED. Nothing signed, nothing sent.");
  }
}

console.log(`Signer Guard demo: wallet ${account.address} on Sepolia`);

// 1. Trusted vendor contract
await attempt("1) Delegate to MetaMask's official EIP-7702 delegator", METAMASK_DELEGATOR);

// 2. Brand-new unknown contract, deployed right now (like the Binance sweeper, but harmless)
const deployHash = await wallet.sendTransaction({ data: HARMLESS_INITCODE, to: null });
const fresh = (await sepoliaReader.waitForTransactionReceipt({ hash: deployHash })).contractAddress!;
console.log(`\n(deployed a fresh harmless contract ${fresh}: ${sepoliaTx(deployHash)})`);
await attempt("2) Delegate to a contract deployed seconds ago", fresh);

// 3. The real Binance delegation, read-only from Ethereum mainnet
const binance = await clients[mainnet.id]!.getTransaction({ hash: BINANCE_TX });
const auths = (binance.authorizationList ?? []).map((a) => ({ chainId: a.chainId, address: a.address, nonce: a.nonce }));
console.log(`\n3) Replay: the real Binance delegation (mainnet tx ${BINANCE_TX.slice(0, 12)}…, read-only)`);
console.log(`  ${auths.length} authorizations, delegate ${auths[0]?.address}, nonces ${auths[0]?.nonce}…${auths.at(-1)?.nonce}`);
const verdict = await checkDelegation(auths, deps);
console.log(`  PreSign: 🛑 ${verdict.status.toUpperCase()}: ${verdict.reason}`);
for (const w of verdict.warnings) console.log(`  ⚠️  ${w}`);
console.log("  → a guarded signer would have REFUSED to sign this.");

// 4. Clean up: revoke the delegation so the test wallet is a plain wallet again
if (!process.argv.includes("--keep")) await attempt("4) Revoke the delegation (restore a plain wallet)", zeroAddress);
