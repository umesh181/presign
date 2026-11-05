/**
 * Signer Guard: wraps a signer so it REFUSES to sign when check() says "blocked".
 * For automated signers (exchanges, custody, AI agents). Optional: expose as an MCP tool.
 */
import type { Result } from "@presign/core";

export class RefusedToSign extends Error {
  constructor(public readonly result: Result) {
    super(`Refused: ${result.reason}`);
  }
}

/** Throws RefusedToSign unless the decision is "trusted". */
export function enforce(result: Result): void {
  if (result.status !== "trusted") throw new RefusedToSign(result);
}

// TODO(B): guardWalletClient(walletClient, deps) — intercept signAuthorization /
// sendTransaction, run checkDelegation / checkTransaction, then enforce().
