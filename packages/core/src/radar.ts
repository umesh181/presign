/**
 * Delegation Radar: evidence about an EIP-7702 delegate contract, read live from the chain.
 * Used by the Watchtower (which publishes it to Arkiv) AND by check() right before signing.
 *
 * "Upgradeable" here means: the delegate runs DELEGATECALL and depends on an external contract whose
 * logic someone else can swap (an EIP-1967 proxy, or a beacon exposing implementation() + upgradeTo()).
 * DELEGATECALL alone is NOT a red flag: vendor contracts use it with logic chosen by the account itself.
 */
import { concat, keccak256, type Hex, type PublicClient } from "viem";
import { codeFacts, type CodeFacts } from "./bytecode.ts";

/** EIP-1967 storage slots. */
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const IMPLEMENTATION = "0x5c60da1b"; // implementation()
const UPGRADE_TO = "633659cfe6"; // PUSH4 (0x63) 0x3659cfe6 = upgradeTo(address)
const MAX_DEPS = 12;

export interface LogicDep {
  address: Hex;
  codeHash: Hex;
  /** Current logic behind it, if it's a proxy or beacon. */
  implementation?: Hex;
  implCodeHash?: Hex;
}

export interface DelegateFacts extends CodeFacts {
  address: Hex;
  codeHash: Hex;
  deps: LogicDep[];
  /** Logic can be swapped by whoever controls `upgradeableVia`. */
  upgradeable: boolean;
  upgradeableVia?: Hex;
  /** keccak of the code AND every dependency's current logic: changes when any of it changes. */
  logicHash: Hex;
}

const asAddress = (word: Hex | undefined): Hex | undefined => {
  if (!word || word.length < 42) return undefined;
  const a = `0x${word.slice(-40)}` as Hex;
  return /^0x0{40}$/.test(a) ? undefined : a;
};

const isPrecompile = (a: Hex) => /^0x0{36}[0-9a-f]{4}$/i.test(a) && parseInt(a.slice(-4), 16) <= 0x100;

async function inspectDep(client: PublicClient, address: Hex): Promise<LogicDep | null> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return null;
  const [implWord, beaconWord] = await Promise.all([
    client.getStorageAt({ address, slot: IMPL_SLOT }),
    client.getStorageAt({ address, slot: BEACON_SLOT }),
  ]);
  let implementation = asAddress(implWord);
  const beacon = asAddress(beaconWord);
  const callImpl = async (target: Hex) =>
    asAddress((await client.call({ to: target, data: IMPLEMENTATION }).catch(() => ({ data: undefined }))).data);
  if (!implementation && beacon) implementation = await callImpl(beacon);
  // A beacon: exposes implementation() and upgradeTo(address).
  if (!implementation && code.includes(UPGRADE_TO)) implementation = await callImpl(address);
  const implCode = implementation ? await client.getCode({ address: implementation }) : undefined;
  return {
    address,
    codeHash: keccak256(code),
    ...(implementation ? { implementation, implCodeHash: implCode && implCode !== "0x" ? keccak256(implCode) : ("0x" as Hex) } : {}),
  };
}

/** Everything the Radar can say about a delegate from the chain alone. null = no contract there. */
export async function inspectDelegate(client: PublicClient, address: Hex): Promise<DelegateFacts | null> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return null;
  const facts = codeFacts(code);
  const refs = facts.addressRefs.filter((a) => a.toLowerCase() !== address.toLowerCase() && !isPrecompile(a)).slice(0, MAX_DEPS);
  const deps = (await Promise.all(refs.map((a) => inspectDep(client, a).catch(() => null)))).filter((d): d is LogicDep => !!d);
  deps.sort((a, b) => a.address.localeCompare(b.address));
  const via = facts.delegatecall ? deps.find((d) => d.implementation) : undefined;
  const codeHash = keccak256(code);
  const logicHash = keccak256(
    concat([codeHash, ...deps.flatMap((d) => [d.address, d.codeHash, d.implementation ?? "0x", d.implCodeHash ?? "0x"])]),
  );
  return { ...facts, address, codeHash, deps, upgradeable: !!via, ...(via ? { upgradeableVia: via.address } : {}), logicHash };
}
