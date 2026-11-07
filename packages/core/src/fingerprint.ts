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

// `includes` are resolved before hashing in ./includes.ts (a port of the registry's own resolver);
// `npm run verify:registry` checks the result against the Cyfrin attestations (166/169 match).
