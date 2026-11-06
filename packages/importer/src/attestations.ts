/**
 * ERC-8176 auditor attestations shipped in the registry: registry/<entity>/sigs/*.json.
 * Each is an off-chain EAS attestation whose `message.data` is the descriptor hash.
 *
 * We don't just read the hash: we RECOVER THE SIGNER from the EIP-712 signature and
 * require it to be a known auditor. Otherwise anyone could add a fake sig file.
 */
import { getAddress, recoverTypedDataAddress, type Hex } from "viem";

/** Auditor keys published in the registry's auditors/ folder. */
export const TRUSTED_AUDITORS: Record<string, string> = {
  [getAddress("0x3846c3A30E62075Fa916216b35EF04B8F53931f6")]: "Cyfrin",
};

/** EAS schema UID for "bytes32 descriptorHash" (ERC-8176). */
export const ERC8176_SCHEMA = "0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2";

export interface Attestation {
  sigPath: string;
  /** The descriptor this sig refers to (same folder as sigs/, name before ".eip155-"). */
  descriptorPath: string;
  descriptorHash: Hex;
  signer: Hex;
  auditor: string | null;
}

export async function readAttestation(sigPath: string, raw: string): Promise<Attestation | null> {
  const { sig } = JSON.parse(raw);
  if (!sig?.message || sig.message.schema?.toLowerCase() !== ERC8176_SCHEMA) return null;

  const { EIP712Domain: _ignored, ...types } = sig.types ?? {};
  const signer = await recoverTypedDataAddress({
    domain: { ...sig.domain, chainId: BigInt(sig.domain.chainId) },
    types,
    primaryType: sig.primaryType,
    message: sig.message,
    signature: { v: BigInt(sig.signature.v), r: sig.signature.r, s: sig.signature.s },
  });

  // registry/1inch/sigs/calldata-X.eip155-1-0xAUDITOR.json -> registry/1inch/calldata-X.json
  const file = sigPath.split("/").pop()!;
  const dir = sigPath.split("/").slice(0, -2).join("/");
  const descriptorPath = `${dir}/${file.slice(0, file.indexOf(".eip155-"))}.json`;

  return {
    sigPath,
    descriptorPath,
    descriptorHash: (sig.message.data as string).toLowerCase() as Hex,
    signer,
    auditor: TRUSTED_AUDITORS[getAddress(signer)] ?? null,
  };
}
