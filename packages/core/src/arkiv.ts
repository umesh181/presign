/**
 * Read-only Arkiv access (browser-safe: no private keys here).
 * Writes live in ./node.ts so the web app never bundles a signer.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, eq } from "@arkiv-network/sdk/query";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { hexToBytes, http, type Hex } from "viem";
import { gunzip } from "./compress.ts";
import type { DelegateRecord, DescriptorRecord } from "./check.ts";
import { Delegate, Descriptor } from "./schemas.ts";

export function createReader(accessKey: string) {
  // Rabdi = Arkiv's current testnet (chain 7794095). An empty key falls back to the
  // heavily rate-limited public RPC.
  // 30 s: viem's 10 s default is too short for Arkiv on a slow network.
  return createPublicClient({ chain: rabdi({ accessKey }), transport: http(undefined, { timeout: 30_000 }) });
}

export type Reader = ReturnType<typeof createReader>;

/**
 * Find the active descriptor for (chainId, address).
 * `createdBy(publisher)` is essential: the schema name is a tag anyone can forge,
 * so we only trust entities our publisher wallet created.
 */
export async function findDescriptor(reader: Reader, publisher: Hex, chainId: number, address: Hex) {
  const result = await reader
    .select()
    .from(Descriptor)
    .where(and(eq("chainId", u64(chainId)), eq("address", addr(address)), eq("status", "active")))
    .createdBy(publisher)
    .limit(1)
    .fetch();
  return result.entities[0] ?? null;
}

/** Find the active trusted delegate for (chainId, address), created by our publisher. */
export async function findDelegate(reader: Reader, publisher: Hex, chainId: number, address: Hex) {
  const result = await reader
    .select()
    .from(Delegate)
    .where(and(eq("chainId", u64(chainId)), eq("address", addr(address)), eq("status", "active")))
    .createdBy(publisher)
    .limit(1)
    .fetch();
  return result.entities[0] ?? null;
}

/** Adapts an Arkiv Descriptor row to the shape check() expects. */
export function descriptorLookup(reader: Reader, publisher: Hex) {
  return async (chainId: number, address: Hex): Promise<DescriptorRecord | null> => {
    const row = await findDescriptor(reader, publisher, chainId, address);
    if (!row) return null;
    const raw = row.descriptor?.value;
    return {
      descriptorHash: row.descriptorHash.value as Hex,
      attested: row.attested.value,
      protocolOwner: row.protocolOwner.value,
      // Stored gzip-compressed (see core/src/compress.ts).
      descriptor: raw ? JSON.parse(new TextDecoder().decode(await gunzip(hexToBytes(raw as Hex)))) : null,
      entityKey: row.$key,
    };
  };
}

/** Adapts an Arkiv Delegate row to the shape checkDelegation() expects. */
export function delegateLookup(reader: Reader, publisher: Hex) {
  return async (chainId: number, address: Hex): Promise<DelegateRecord | null> => {
    const row = await findDelegate(reader, publisher, chainId, address);
    if (!row) return null;
    return {
      vendor: row.vendor.value,
      contractName: row.contractName.value,
      codeHash: row.codeHash.value as Hex,
      entityKey: row.$key,
    };
  };
}
