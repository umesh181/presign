/**
 * Fingerprints used to detect tampering.
 *
 * Descriptors follow ERC-8176: resolve `includes`, canonicalise with RFC 8785 (JCS),
 * then keccak256. Output: 0x + 64 lowercase hex.
 * Delegates: keccak256 of the deployed runtime bytecode (eth_getCode).
 */
import canonicalize from "canonicalize";
import { keccak256, stringToBytes, type Hex } from "viem";

export function descriptorHash(resolvedDescriptor: unknown): Hex {
  const canonical = canonicalize(resolvedDescriptor);
  if (canonical === undefined) throw new Error("Descriptor could not be canonicalised");
  return keccak256(stringToBytes(canonical));
}

export function codeHash(runtimeBytecode: Hex): Hex {
  return keccak256(runtimeBytecode);
}

// TODO(A): resolveIncludes(descriptor, readFile) — merge `includes` per ERC-7730
// (including file wins; `fields` merge by `path`). Then verify one hash against
// registry/*/sigs/*.json (Cyfrin attestation) before importing everything.
