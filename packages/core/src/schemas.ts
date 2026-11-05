/**
 * Arkiv entity schemas for PreSign (SDK 1.0, schema-based model).
 *
 * WHY these limits matter (see arkiv/schema.md):
 * - `str` values are capped at 128 BYTES -> keep hashes/paths short; importer must check.
 * - `bytes` share a 128 KiB budget per create/patch and can't be indexed.
 * - Max 31 columns per named schema.
 * - Only `.indexed()` columns can be filtered on.
 *
 * The schema name is a tag anyone can forge, so readers must ALSO filter by
 * `createdBy(PUBLISHER_ADDRESS)` to trust an entity.
 */
import { addr, bool, bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

/** One ERC-7730 clear-signing descriptor deployment: (chainId, contract address). */
export const Descriptor = defineSchema("presign.descriptor.v1", {
  chainId: u64().indexed(),
  address: addr().indexed(),
  /** ERC-8176 fingerprint: keccak256(JCS(descriptor with includes resolved)). */
  descriptorHash: str().indexed(),
  /** true if a trusted auditor (e.g. Cyfrin) EAS attestation matches descriptorHash. */
  attested: bool().indexed(),
  /** "active" while the keeper re-confirms it (Arkiv has no NOT/!= operator, so use a positive value). */
  status: str().indexed(),
  importedAt: u64().indexed(),
  protocolOwner: str(),
  sourceRepo: str(),
  sourceCommit: str().indexed(),
  sourcePath: str(),
  swarmRef: str().optional(),
  /** Resolved descriptor JSON (UTF-8). Omitted if too large; then read from Swarm. */
  descriptor: bytes().optional(),
});

/** One trusted EIP-7702 delegate contract on one chain, from a vendor's official source. */
export const Delegate = defineSchema("presign.delegate.v1", {
  chainId: u64().indexed(),
  address: addr().indexed(),
  /** keccak256 of the runtime bytecode returned by eth_getCode at import time. */
  codeHash: str().indexed(),
  vendor: str().indexed(),
  status: str().indexed(),
  importedAt: u64().indexed(),
  contractName: str(),
  version: str().optional(),
  sourceType: str(),
  sourceRepo: str(),
  sourcePath: str(),
  sourceCommit: str(),
});

/** Append-only history record written by the keeper (created with the readonly flag). */
export const Change = defineSchema("presign.change.v1", {
  kind: str().indexed(), // "descriptor" | "delegate"
  changeType: str().indexed(), // "added" | "modified" | "removed" | "codeHashMismatch" | "newCandidate"
  chainId: u64().indexed(),
  address: addr().indexed(),
  detectedAt: u64().indexed(),
  oldHash: str().optional(),
  newHash: str().optional(),
  sourceCommit: str().optional(),
});

/** Live watchtower alert about EIP-7702 delegations seen on mainnet (short expiry). */
export const Alert = defineSchema("presign.alert.v1", {
  alertType: str().indexed(), // "unknownDelegate" | "burst" | "chainIdZero"
  chainId: u64().indexed(),
  delegate: addr().indexed(),
  detectedAt: u64().indexed(),
  count: u64(),
  txHash: str().optional(),
  blockNumber: u64().optional(),
});
