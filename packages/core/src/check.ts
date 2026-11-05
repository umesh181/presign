/**
 * presign.check(): the decision made right before signing.
 * Deterministic on purpose: no LLM, no guessing. Unknown data => "unknown"/"blocked".
 */
import type { Hex } from "viem";

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

// TODO(B): checkTransaction({ chainId, to, data }) — find descriptor on Arkiv, verify
// descriptorHash (+ attestation), then format with ./formatter.ts.
