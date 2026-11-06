/**
 * presign.check(): the decision made right before signing.
 * Deterministic on purpose: no LLM, no guessing. Unknown data => "unknown"/"blocked".
 */
import { formatEther, type Hex } from "viem";
import { codeFamily } from "./bytecode.ts";
import { codeHash, descriptorHash } from "./fingerprint.ts";
import type { Formatted } from "./formatter.ts";

export type Status = "trusted" | "blocked" | "unknown";

export interface Result {
  status: Status;
  reason: string;
  warnings: string[];
  /** Delegation Radar evidence lines (delegations only). */
  evidence?: Evidence[];
  details?: Record<string, unknown>;
}

export interface Authorization {
  chainId: number; // 0 = valid on every chain
  address: Hex; // the delegate contract
  nonce: number;
}

export interface DelegateRecord {
  vendor: string;
  contractName: string;
  codeHash: Hex;
  entityKey?: Hex;
}

/** What the Watchtower published about a delegate (presign.radar.v1). */
export interface RadarRecord {
  upgradeable: boolean;
  upgradeableVia?: string;
  firstSeenAt: number; // unix seconds
  accounts: number;
  authorizations: number;
  entityKey?: Hex;
}

export interface AlertRecord {
  alertType: string;
  message: string;
  detectedAt: number;
  entityKey?: Hex;
}

export interface BadFamilyRecord {
  label: string;
  source: string;
  entityKey?: Hex;
}

/** One line of evidence shown to the user. */
export interface Evidence {
  state: "ok" | "warn" | "fail";
  text: string;
}

/** Injected so check() is testable without network access. Radar lookups are optional. */
export interface DelegateDeps {
  lookupDelegate(chainId: number, address: Hex): Promise<DelegateRecord | null>;
  /** Live runtime code at the address (null if none). */
  currentCode(chainId: number, address: Hex): Promise<Hex | null>;
  lookupBadFamily?(family: Hex): Promise<BadFamilyRecord | null>;
  lookupProfile?(chainId: number, address: Hex): Promise<RadarRecord | null>;
  lookupAlerts?(chainId: number, address: Hex): Promise<AlertRecord[]>;
  now?(): number;
}

/** No wallet UI asks for this many authorizations at once (Binance replay: 50 with consecutive nonces). */
export const MANY_AUTHORIZATIONS = 5;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function ago(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

interface DelegateVerdict {
  evidence: Evidence[];
  blockedReason?: string;
  vendor?: DelegateRecord;
  details: Record<string, unknown>;
}

/** All evidence about ONE delegate contract: chain + Arkiv. */
async function inspect(chainId: number, address: Hex, deps: DelegateDeps): Promise<DelegateVerdict> {
  const evidence: Evidence[] = [];
  const details: Record<string, unknown> = { delegate: address };
  const code = await deps.currentCode(chainId, address);
  if (!code) {
    evidence.push({ state: "fail", text: "No contract deployed there: any code could appear later" });
    return { evidence, blockedReason: "No contract at this address", details };
  }

  const [bad, alerts, vendor, profile] = await Promise.all([
    deps.lookupBadFamily?.(codeFamily(code)) ?? null,
    deps.lookupAlerts?.(chainId, address) ?? [],
    deps.lookupDelegate(chainId, address),
    deps.lookupProfile?.(chainId, address) ?? null,
  ]);
  let blockedReason: string | undefined;

  if (bad) {
    evidence.push({ state: "fail", text: `Same code family as a known drainer (${bad.label})` });
    blockedReason ??= "Same code as a known wallet drainer";
    details.badFamily = bad;
  } else if (deps.lookupBadFamily) {
    evidence.push({ state: "ok", text: "Code doesn't match any known drainer family (Arkiv)" });
  }

  for (const a of alerts) evidence.push({ state: "fail", text: `Watchtower alert: ${a.message}` });
  if (alerts.length) {
    blockedReason ??= "Its logic changed after it was first seen";
    details.alertKey = alerts[0]!.entityKey;
  }

  if (vendor) {
    if (codeHash(code).toLowerCase() !== vendor.codeHash.toLowerCase()) {
      evidence.push({ state: "fail", text: `Code differs from the version ${vendor.vendor} published` });
      blockedReason ??= "Contract code differs from the trusted version";
    } else {
      evidence.push({ state: "ok", text: `Listed in ${vendor.vendor}'s own repo (${vendor.contractName})` });
    }
    Object.assign(details, { vendor: vendor.vendor, contractName: vendor.contractName, entityKey: vendor.entityKey });
  } else {
    evidence.push({ state: "warn", text: "Not listed by any wallet vendor" });
  }

  if (profile) {
    evidence.push(
      profile.upgradeable
        ? { state: "warn", text: `Upgradeable: its logic comes from ${short(profile.upgradeableVia ?? "another contract")}, whose owner can change it` }
        : { state: "ok", text: "Logic can't be swapped by a third party" },
    );
    // "Brand new" matters for contracts nobody vouches for; a vendor listing already gives provenance.
    const age = (deps.now?.() ?? Math.floor(Date.now() / 1000)) - profile.firstSeenAt;
    const used = profile.accounts ? ` · ${profile.accounts} account${profile.accounts === 1 ? "" : "s"} seen delegating` : "";
    evidence.push({ state: age < 86400 && !vendor ? "warn" : "ok", text: `First seen by the Watchtower ${ago(age)} ago${used}` });
    details.radarKey = profile.entityKey;
  } else if (deps.lookupProfile) {
    evidence.push({ state: "warn", text: "Never seen by the PreSign Watchtower" });
  }

  return { evidence, blockedReason, vendor: vendor ?? undefined, details };
}

export async function checkDelegation(auths: Authorization[], deps: DelegateDeps): Promise<Result> {
  const evidence: Evidence[] = [];
  let blockedReason: string | undefined;
  if (auths.some((a) => a.chainId === 0)) evidence.push({ state: "warn", text: "Valid on every chain (chainId 0): replayable elsewhere" });
  if (auths.length >= MANY_AUTHORIZATIONS) {
    evidence.push({ state: "fail", text: `${auths.length} authorizations in one transaction (nonce spraying): no wallet asks for this` });
    blockedReason = `Asks for ${auths.length} authorizations at once (nonce spraying)`;
  }

  // Evidence per distinct delegate (the Binance replay has 50 authorizations to ONE contract).
  // Delegating to the zero address REVOKES a delegation (restores a plain wallet): always allowed.
  const seen = new Map<string, Authorization>();
  for (const a of auths) if (!/^0x0{40}$/i.test(a.address)) seen.set(`${a.chainId}:${a.address.toLowerCase()}`, a);
  let first: DelegateVerdict | undefined;
  for (const auth of seen.values()) {
    // chainId 0 is valid everywhere: judge it on Ethereum mainnet.
    const v = await inspect(auth.chainId === 0 ? 1 : auth.chainId, auth.address, deps);
    evidence.push(...v.evidence);
    blockedReason ??= v.blockedReason;
    first ??= v;
  }

  const warnings = evidence.filter((e) => e.state !== "ok").map((e) => e.text);
  const details = first?.details;
  if (blockedReason) {
    return { status: "blocked", reason: blockedReason, warnings, evidence, details };
  }
  if (!first) {
    return { status: "trusted", reason: auths.length ? "Removes the delegation (restores a plain wallet)" : "No authorizations", warnings, evidence, details };
  }
  if (first.vendor && !warnings.length) {
    return {
      status: "trusted",
      reason: `Upgrading your wallet with ${first.vendor.vendor}'s official contract (${first.vendor.contractName})`,
      warnings,
      evidence,
      details,
    };
  }
  return {
    status: "unknown",
    reason: first.vendor ? `${first.vendor.vendor}'s contract, but with open questions` : "Unknown contract: no wallet vendor vouches for it",
    warnings,
    evidence,
    details,
  };
}

export interface TxInput {
  chainId: number;
  to: Hex;
  value?: bigint;
  data?: Hex;
}

export interface DescriptorRecord {
  descriptorHash: Hex;
  attested: boolean;
  protocolOwner: string;
  /** Resolved descriptor JSON from Arkiv (or Swarm). null if not loaded. */
  descriptor: unknown | null;
  entityKey?: Hex;
}

export interface TransactionDeps {
  isContract(chainId: number, address: Hex): Promise<boolean>;
  lookupDescriptor(chainId: number, address: Hex): Promise<DescriptorRecord | null>;
  /** ERC-7730 formatter (./formatter.ts). Resolves null if the function isn't supported. */
  format(descriptor: unknown, tx: TxInput): Promise<Formatted | null>;
}

/**
 * Normal transaction check:
 * plain ETH send -> readable as is; contract call -> needs a verified descriptor from Arkiv.
 */
export async function checkTransaction(tx: TxInput, deps: TransactionDeps): Promise<Result> {
  const warnings: string[] = [];
  const value = tx.value ?? 0n;
  const hasData = !!tx.data && tx.data !== "0x";

  if (!hasData) {
    if (!(await deps.isContract(tx.chainId, tx.to))) {
      return {
        status: "trusted",
        reason: `Send ${formatEther(value)} ETH to ${tx.to}`,
        warnings,
        details: { kind: "nativeTransfer" },
      };
    }
    return { status: "unknown", reason: "Sends ETH to a contract with no call data", warnings };
  }

  const record = await deps.lookupDescriptor(tx.chainId, tx.to);
  if (!record) {
    return { status: "unknown", reason: "No verified translation for this contract. Be careful.", warnings, details: { to: tx.to } };
  }
  if (record.descriptor === null) {
    return { status: "unknown", reason: "Verified translation exists but could not be loaded", warnings, details: { entityKey: record.entityKey } };
  }

  // Re-check the fingerprint client-side: never trust a stored hash blindly.
  const recomputed = descriptorHash(record.descriptor);
  if (recomputed.toLowerCase() !== record.descriptorHash.toLowerCase()) {
    return { status: "blocked", reason: "Translation file tampered (fingerprint mismatch)", warnings, details: { expected: record.descriptorHash, recomputed } };
  }

  const formatted = await deps.format(record.descriptor, tx);
  if (!formatted) {
    return { status: "unknown", reason: "Verified translation found, but this function is not supported yet", warnings, details: { entityKey: record.entityKey } };
  }
  // ERC-7730 `mustMatch`: the wallet must raise an error when a value isn't allowed.
  if (formatted.warnings.length) {
    return { status: "blocked", reason: "Transaction violates its verified translation rules", warnings: [...warnings, ...formatted.warnings] };
  }
  return {
    status: "trusted",
    reason: formatted.interpolatedIntent ?? formatted.intent,
    warnings,
    details: { fields: formatted.fields, protocol: record.protocolOwner, attested: record.attested, entityKey: record.entityKey },
  };
}
