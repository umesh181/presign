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
import type { AlertRecord, BadFamilyRecord, DelegateDeps, DelegateRecord, DescriptorRecord, RadarRecord } from "./check.ts";
import { Alert, BadFamily, Delegate, Descriptor, RadarProfile } from "./schemas.ts";

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

// ---------- Delegation Radar (written by the Watchtower) ----------

/** Known drainer family (presign.badfamily.v1) for a code family hash. */
export function badFamilyLookup(reader: Reader, publisher: Hex) {
  return async (family: Hex): Promise<BadFamilyRecord | null> => {
    const r = await reader
      .select({ $key: true, label: true, source: true })
      .from(BadFamily)
      .where(and(eq("family", family), eq("status", "active")))
      .createdBy(publisher)
      .limit(1)
      .fetch();
    const row = r.entities[0];
    return row ? { label: row.label.value, source: row.source.value, entityKey: row.$key } : null;
  };
}

/** The Watchtower's profile of a delegate (presign.radar.v1). */
export function profileLookup(reader: Reader, publisher: Hex) {
  return async (chainId: number, address: Hex): Promise<RadarRecord | null> => {
    const r = await reader
      .select({ $key: true, upgradeable: true, upgradeableVia: true, firstSeenAt: true, accounts: true, authorizations: true })
      .from(RadarProfile)
      .where(and(eq("chainId", u64(chainId)), eq("address", addr(address)), eq("status", "active")))
      .createdBy(publisher)
      .limit(1)
      .fetch();
    const row = r.entities[0];
    if (!row) return null;
    return {
      upgradeable: row.upgradeable.value,
      ...(row.upgradeableVia?.value ? { upgradeableVia: row.upgradeableVia.value } : {}),
      firstSeenAt: Number(row.firstSeenAt.value),
      accounts: Number(row.accounts.value),
      authorizations: Number(row.authorizations.value),
      entityKey: row.$key,
    };
  };
}

/** Watchtower alerts about a delegate that haven't expired yet (presign.alert.v1, readonly). */
export function alertsLookup(reader: Reader, publisher: Hex) {
  return async (chainId: number, address: Hex): Promise<AlertRecord[]> => {
    const r = await reader
      .select({ $key: true, alertType: true, message: true, detectedAt: true })
      .from(Alert)
      .where(and(eq("chainId", u64(chainId)), eq("delegate", addr(address))))
      .createdBy(publisher)
      .limit(20)
      .fetch();
    return r.entities.map((e) => ({ alertType: e.alertType.value, message: e.message.value, detectedAt: Number(e.detectedAt.value), entityKey: e.$key }));
  };
}

/** Everything checkDelegation() needs: chain reads + vendor list + Radar evidence, all from Arkiv. */
export function delegateDepsFor(reader: Reader, publisher: Hex, clients: Record<number, { getCode(a: { address: Hex }): Promise<Hex | undefined> }>): DelegateDeps {
  return {
    lookupDelegate: delegateLookup(reader, publisher),
    currentCode: async (chainId, address) => {
      const client = clients[chainId];
      if (!client) throw new Error(`No RPC for chain ${chainId}`);
      const code = await client.getCode({ address });
      return code && code !== "0x" ? code : null;
    },
    lookupBadFamily: badFamilyLookup(reader, publisher),
    lookupProfile: profileLookup(reader, publisher),
    lookupAlerts: alertsLookup(reader, publisher),
  };
}
