/**
 * Signer Guard: wraps a signer so it REFUSES to sign when check() says anything but "trusted".
 * For automated signers (exchanges, custody, bots, AI agents): the money never moves.
 */
import { checkDelegation, type DelegateDeps, type Result } from "@presign/core";
import type { Account, Chain, Hex, Transport, WalletClient } from "viem";

export class RefusedToSign extends Error {
  constructor(public readonly result: Result) {
    super(`Refused: ${result.reason}`);
  }
}

/** Throws RefusedToSign unless the decision is "trusted". */
export function enforce(result: Result): void {
  if (result.status !== "trusted") throw new RefusedToSign(result);
}

type Signer = WalletClient<Transport, Chain, Account>;

/**
 * Guarded EIP-7702 delegation: prepare -> PreSign check -> sign EXACTLY what was checked -> send.
 * The account delegates itself (executor "self"), so the authorization nonce is current nonce + 1.
 */
export async function guardedDelegate(wallet: Signer, contractAddress: Hex, deps: DelegateDeps) {
  const prepared = await wallet.prepareAuthorization({ contractAddress, executor: "self" });
  const result = await checkDelegation([prepared], deps);
  enforce(result); // throws before anything is signed

  // Explicit chainId + nonce: viem signs exactly the authorization we checked.
  const authorization = await wallet.signAuthorization({ address: prepared.address, chainId: prepared.chainId, nonce: prepared.nonce });
  const txHash = await wallet.sendTransaction({ authorizationList: [authorization], to: wallet.account.address, data: "0x" });
  return { result, txHash };
}
