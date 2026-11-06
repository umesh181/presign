/**
 * Delegation Radar reads for the UI: Watchtower profiles, alerts and known drainer families,
 * straight from Arkiv (pinned to our publisher), plus "does this account delegate, and to what?".
 */
import { and, eq } from "@arkiv-network/sdk/query";
import { u64 } from "@arkiv-network/sdk/schema";
import { Alert, BadFamily, RadarProfile, checkDelegation } from "@presign/core";
import { getAddress, type Hex } from "viem";
import { PUBLISHER, reader } from "./arkiv.ts";
import { clients, delegateDeps, type ScenarioRun } from "./scenarios.ts";

export const RADAR_CHAINS: Record<number, { name: string; explorer: string }> = {
  1: { name: "Ethereum", explorer: "https://etherscan.io" },
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
};

export interface RadarStats {
  profiles: number;
  families: number;
  alerts: number;
  upgradeable: number;
}

export async function radarStats(): Promise<RadarStats> {
  const [profiles, families, alerts, upgradeable] = await Promise.all([
    reader.count().from(RadarProfile).where(eq("status", "active")).createdBy(PUBLISHER).fetch(),
    reader.count().from(BadFamily).where(eq("status", "active")).createdBy(PUBLISHER).fetch(),
    reader.count().from(Alert).createdBy(PUBLISHER).fetch(),
    reader.count().from(RadarProfile).where(and(eq("status", "active"), eq("upgradeable", true))).createdBy(PUBLISHER).fetch(),
  ]);
  return { profiles: Number(profiles), families: Number(families), alerts: Number(alerts), upgradeable: Number(upgradeable) };
}

export interface AlertRow {
  key: Hex;
  alertType: string;
  chainId: number;
  delegate: Hex;
  detectedAt: number;
  message: string;
  blockNumber?: number;
}

/** Latest alerts first. */
export async function listAlerts(): Promise<AlertRow[]> {
  const r = await reader
    .select({ $key: true, alertType: true, chainId: true, delegate: true, detectedAt: true, message: true, blockNumber: true })
    .from(Alert)
    .createdBy(PUBLISHER)
    .limit(100)
    .fetch();
  return r.entities
    .map((e) => ({
      key: e.$key,
      alertType: e.alertType.value,
      chainId: Number(e.chainId.value),
      delegate: getAddress(e.delegate.value),
      detectedAt: Number(e.detectedAt.value),
      message: e.message.value,
      ...(e.blockNumber ? { blockNumber: Number(e.blockNumber.value) } : {}),
    }))
    .sort((a, b) => b.detectedAt - a.detectedAt);
}

export interface ProfileRow {
  key: Hex;
  address: Hex;
  vendor: string;
  knownBad: string;
  upgradeable: boolean;
  accounts: number;
  authorizations: number;
  firstSeenAt: number;
  codeSize: number;
}

/** All active profiles on a chain, most-used first. */
export async function listProfiles(chainId: number): Promise<ProfileRow[]> {
  const out: ProfileRow[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await reader
      .select({ $key: true, address: true, vendor: true, knownBad: true, upgradeable: true, accounts: true, authorizations: true, firstSeenAt: true, codeSize: true })
      .from(RadarProfile)
      .where(and(eq("chainId", u64(chainId)), eq("status", "active")))
      .createdBy(PUBLISHER)
      .limit(100)
      .offset(offset)
      .fetch();
    for (const e of r.entities)
      out.push({
        key: e.$key,
        address: getAddress(e.address.value),
        vendor: e.vendor.value,
        knownBad: e.knownBad.value,
        upgradeable: e.upgradeable.value,
        accounts: Number(e.accounts.value),
        authorizations: Number(e.authorizations.value),
        firstSeenAt: Number(e.firstSeenAt.value),
        codeSize: Number(e.codeSize.value),
      });
    if (r.entities.length < 100) break;
  }
  return out.sort((a, b) => b.accounts - a.accounts || b.firstSeenAt - a.firstSeenAt);
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** PreSign's verdict on delegating to `delegate` (what a wallet would show before signing). */
export async function checkDelegate(chainId: number, delegate: Hex): Promise<ScenarioRun> {
  return {
    kind: "delegation",
    chainId,
    result: await checkDelegation([{ chainId, address: delegate, nonce: 0 }], delegateDeps),
    request: [
      { label: "Delegate to", value: delegate },
      { label: "Network", value: RADAR_CHAINS[chainId]?.name ?? String(chainId) },
    ],
  };
}

/**
 * Does this account delegate (EIP-7702)? Its code is then 0xef0100 ‖ delegate.
 * Returns the verdict on its CURRENT delegate, or null if it is a plain wallet.
 */
export async function checkAccount(chainId: number, account: Hex): Promise<ScenarioRun | null> {
  const code = await clients[chainId]!.getCode({ address: account });
  if (!code || !code.toLowerCase().startsWith("0xef0100")) return null;
  const delegate = getAddress(`0x${code.slice(8, 48)}`);
  const run = await checkDelegate(chainId, delegate);
  return {
    ...run,
    when: "already delegated",
    request: [
      { label: "Account", value: short(account) },
      { label: "Delegates to", value: delegate },
      { label: "Network", value: RADAR_CHAINS[chainId]?.name ?? String(chainId) },
    ],
    note:
      run.result.status === "blocked"
        ? "This account is exposed right now. Revoke the delegation (delegate to the zero address) from the wallet that controls it."
        : "Live check of the account's current delegation.",
    proof: [{ label: "Account on explorer", href: `${RADAR_CHAINS[chainId]?.explorer}/address/${account}` }],
  };
}
