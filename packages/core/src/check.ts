/**
 * presign.check(): the decision made right before signing.
 * Deterministic on purpose: no LLM, no guessing. Unknown data => "unknown"/"blocked".
 */
import { formatEther, type Hex } from "viem";
import { descriptorHash } from "./fingerprint.ts";
import type { Formatted } from "./formatter.ts";

export type Status = "trusted" | "blocked" | "unknown";

export interface Result {
  status: Status;
  reason: string;
  warnings: string[];
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

/** Injected so check() is testable without network access. */
export interface DelegateDeps {
  lookupDelegate(chainId: number, address: Hex): Promise<DelegateRecord | null>;
  currentCodeHash(chainId: number, address: Hex): Promise<Hex | null>;
}

/** Binance replay had 50 authorizations with consecutive nonces in one tx. */
export const MANY_AUTHORIZATIONS = 5;

export async function checkDelegation(auths: Authorization[], deps: DelegateDeps): Promise<Result> {
  const warnings: string[] = [];
  if (auths.some((a) => a.chainId === 0)) warnings.push("Authorization valid on every chain (chainId 0)");
  if (auths.length >= MANY_AUTHORIZATIONS)
    warnings.push(`${auths.length} authorizations in one transaction (nonce spraying pattern)`);

  for (const auth of auths) {
    // TODO: decide which chain to verify for chainId 0 (currently mainnet).
    const chainId = auth.chainId === 0 ? 1 : auth.chainId;
    const record = await deps.lookupDelegate(chainId, auth.address);
    if (!record) {
      return { status: "blocked", reason: "Hands your entire account to an unknown contract", warnings, details: { delegate: auth.address } };
    }
    const live = await deps.currentCodeHash(chainId, auth.address);
    if (!live || live.toLowerCase() !== record.codeHash.toLowerCase()) {
      return { status: "blocked", reason: "Contract code differs from the trusted version", warnings, details: { expected: record.codeHash, live } };
    }
  }

  const first = auths[0] ? await deps.lookupDelegate(auths[0].chainId || 1, auths[0].address) : null;
  return {
    status: warnings.length ? "unknown" : "trusted",
    reason: first ? `Upgrading your wallet with ${first.vendor}'s official contract (${first.contractName})` : "No authorizations",
    warnings,
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
  /** ERC-7730 formatter (./formatter.ts). Returns null if the function isn't supported. */
  format(descriptor: unknown, tx: TxInput): Formatted | null;
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

  const formatted = deps.format(record.descriptor, tx);
  if (!formatted) {
    return { status: "unknown", reason: "Verified translation found, but this function is not supported yet", warnings, details: { entityKey: record.entityKey } };
  }
  return {
    status: "trusted",
    reason: formatted.intent,
    warnings,
    details: { fields: formatted.fields, protocol: record.protocolOwner, attested: record.attested, entityKey: record.entityKey },
  };
}
