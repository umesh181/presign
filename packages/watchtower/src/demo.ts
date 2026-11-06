/**
 * Live Delegation Radar demo on Sepolia: real transactions, real Arkiv writes.
 *
 *   npm run radar:demo                        # full run, ends by revoking
 *   npm run radar:demo -- --keep-delegation   # leave the demo account exposed (to show it in the web app)
 *   npm run radar:demo -- --revoke            # revoke the demo account's delegation
 *
 * 1. Deploy a beacon-backed EIP-7702 delegate whose logic is a harmless smart account (contracts/radar-demo).
 * 2. Watchtower profiles it -> PreSign: CAUTION (not vendor-listed, upgradeable by the beacon owner).
 * 3. A fresh demo account delegates anyway (sponsored by our test wallet, so it needs no ETH).
 * 4. The beacon owner swaps the logic to a drainer. The delegate ADDRESS and its code are unchanged.
 * 5. Watchtower notices the logic fingerprint changed -> readonly Alert on Arkiv.
 * 6. PreSign: BLOCKED for anyone about to sign; the delegated account sees the alert.
 * 7. The demo account revokes its delegation.
 *
 * Testnet only. The "attacker" is our own test wallet; the demo account is derived from it.
 */
import { checkDelegation, createReader, delegateDepsFor, type Result } from "@presign/core";
import { env } from "@presign/core/node";
import { createWalletClient, http, keccak256, concat, toHex, zeroAddress, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { client } from "./tower.ts";
import { runChain } from "./scan.ts";

const artifacts = JSON.parse(readFileSync(new URL("../../../contracts/radar-demo/artifacts.json", import.meta.url), "utf8")) as Record<
  string,
  { abi: any[]; bytecode: Hex }
>;

const pk = env("PUBLISHER_PRIVATE_KEY") as Hex;
const owner = privateKeyToAccount(pk); // beacon owner = "attacker" + gas sponsor
// Deterministic demo account: same every run, never holds funds.
const demoAccount = privateKeyToAccount(keccak256(concat([pk, toHex("presign-radar-demo")])));
const rpc = http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 60_000 });
const wallet = createWalletClient({ account: owner, chain: sepolia, transport: rpc });
const demoWallet = createWalletClient({ account: demoAccount, chain: sepolia, transport: rpc });
const sepoliaClient = client(sepolia.id);
const deps = delegateDepsFor(createReader(env("ARKIV_ACCESS_KEY")), env("PUBLISHER_ADDRESS") as Hex, { [sepolia.id]: sepoliaClient as PublicClient });

const tx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
const ICON = { trusted: "✅ VERIFIED", unknown: "⚠️  CAUTION", blocked: "🛑 BLOCKED" } as const;

function show(r: Result) {
  console.log(`   PreSign: ${ICON[r.status]} · ${r.reason}`);
  for (const e of r.evidence ?? []) console.log(`     ${e.state === "ok" ? "✓" : e.state === "warn" ? "!" : "✗"} ${e.text}`);
}

async function deploy(name: string, args: unknown[] = []): Promise<Hex> {
  const a = artifacts[name]!;
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  const r = await sepoliaClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log(`   ${name}: ${r.contractAddress}`);
  return r.contractAddress!;
}

async function send(hash: Hex, label: string) {
  const r = await sepoliaClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${tx(hash)}`);
  console.log(`   ${label}: ${tx(hash)}`);
}

/** Load-balanced RPCs and Arkiv can lag a few seconds behind: poll until `ok`. */
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
  for (let i = 0; i < 20; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const check = (delegate: Hex) => checkDelegation([{ chainId: sepolia.id, address: delegate, nonce: 0 }], deps);

async function main() {
  if (process.argv.includes("--revoke")) {
    const revoke = await demoWallet.signAuthorization({ contractAddress: zeroAddress });
    await send(await wallet.sendTransaction({ authorizationList: [revoke], to: demoAccount.address, data: "0x" }), "revoke tx");
    return;
  }
  console.log(`Demo account ${demoAccount.address} · beacon owner ("attacker") ${owner.address}\n`);

  console.log("1. Deploy: harmless logic, drainer logic, beacon (-> harmless), delegate (-> beacon)");
  const v1 = await deploy("DemoSmartAccount");
  const v2 = await deploy("DemoDrainer", [owner.address]);
  const beacon = await deploy("DemoBeacon", [v1]);
  const delegate = await deploy("DemoBeaconDelegate", [beacon]);
  await until(() => sepoliaClient.getCode({ address: delegate }), (c) => !!c && c !== "0x", "delegate code");

  console.log("\n2. Watchtower profiles the new delegate (published to Arkiv)");
  await runChain(sepolia.id, { scan: false, recheckAll: false, extra: [delegate] }, true, (m) => console.log(`   ${m.trim()}`));
  show(await until(() => check(delegate), (r) => !r.warnings.includes("Never seen by the PreSign Watchtower"), "profile on Arkiv"));

  console.log("\n3. The demo account delegates anyway (\"Sign anyway\")");
  const auth = await demoWallet.signAuthorization({ contractAddress: delegate });
  await send(await wallet.sendTransaction({ authorizationList: [auth], to: demoAccount.address, data: "0x" }), "delegation tx");

  console.log("\n4. The beacon owner swaps the logic to the drainer (delegate address + code unchanged)");
  const beaconAbi = artifacts.DemoBeacon!.abi;
  await send(await wallet.writeContract({ address: beacon, abi: beaconAbi, functionName: "upgradeTo", args: [v2] }), "upgradeTo(drainer) tx");
  await until(() => sepoliaClient.readContract({ address: beacon, abi: beaconAbi, functionName: "implementation" }), (i) => String(i).toLowerCase() === v2.toLowerCase(), "upgrade visible");

  console.log("\n5. Watchtower re-checks: logic fingerprint changed -> Alert on Arkiv");
  await runChain(sepolia.id, { scan: false, recheckAll: false, extra: [delegate] }, true, (m) => console.log(`   ${m.trim()}`));

  console.log("\n6. PreSign for anyone about to delegate to it now:");
  show(await until(() => check(delegate), (r) => r.status === "blocked", "alert on Arkiv"));
  const code = await sepoliaClient.getCode({ address: demoAccount.address });
  console.log(`   The demo account ${demoAccount.address} still delegates to it (code ${code?.slice(0, 8)}…): its wallet should show the alert and offer to revoke.`);

  if (process.argv.includes("--keep-delegation")) {
    console.log(`\n7. Skipped revoke (--keep-delegation): check ${demoAccount.address} on Sepolia in the web app (Radar -> "Is my account exposed?").`);
    console.log("   Revoke later with: npm run radar:demo -- --revoke");
    return;
  }
  console.log("\n7. The demo account revokes (delegates to the zero address)");
  const revoke = await demoWallet.signAuthorization({ contractAddress: zeroAddress });
  await send(await wallet.sendTransaction({ authorizationList: [revoke], to: demoAccount.address, data: "0x" }), "revoke tx");

  console.log(`\nDone. Delegate ${delegate} · see the alert in the web app (Radar) or query presign.alert.v1 on Arkiv.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
