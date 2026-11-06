/**
 * Browser-side Arkiv reads for the UI: live stats and the Registry Explorer.
 * Every query is pinned to createdBy(PUBLISHER): the schema name alone can be forged.
 */
import { and, eq } from "@arkiv-network/sdk/query";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { Delegate, Descriptor, createReader, descriptorHash, gunzip } from "@presign/core";
import { hexToBytes, type Hex } from "viem";

export const PUBLISHER = (import.meta.env.VITE_PUBLISHER_ADDRESS ?? "0x1784A22855d5E482112F94d2169c28bC7e6aF885") as Hex;
export const reader = createReader(import.meta.env.VITE_ARKIV_ACCESS_KEY ?? "");
export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
export const ARKIV_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";

const BLOCK_SECONDS = 2; // Rabdi block time

export interface Stats {
  descriptors: number;
  attested: number;
  delegates: number;
}

export async function liveStats(): Promise<Stats> {
  const [descriptors, attested, delegates] = await Promise.all([
    reader.count().from(Descriptor).where(eq("status", "active")).createdBy(PUBLISHER).fetch(),
    reader.count().from(Descriptor).where(and(eq("status", "active"), eq("attested", true))).createdBy(PUBLISHER).fetch(),
    reader.count().from(Delegate).where(eq("status", "active")).createdBy(PUBLISHER).fetch(),
  ]);
  return { descriptors: Number(descriptors), attested: Number(attested), delegates: Number(delegates) };
}

export interface ExplorerDescriptor {
  kind: "descriptor";
  key: Hex;
  creator: Hex;
  expiresInSeconds: number;
  protocolOwner: string;
  descriptorHash: string;
  attested: boolean;
  sourceRepo: string;
  sourcePath: string;
  sourceCommit: string;
  importedAt: number;
  /** Recomputed in the browser from the stored JSON. */
  fingerprintOk: boolean;
  contractName?: string;
  functions: string[];
}

export interface ExplorerDelegate {
  kind: "delegate";
  key: Hex;
  creator: Hex;
  expiresInSeconds: number;
  vendor: string;
  contractName: string;
  version?: string;
  codeHash: string;
  sourceRepo: string;
  sourcePath: string;
  sourceCommit: string;
  importedAt: number;
}

export type ExplorerEntry = ExplorerDescriptor | ExplorerDelegate;

/** Everything PreSign has on Arkiv for (chainId, address): a descriptor and/or a trusted delegate. */
export async function explore(chainId: number, address: Hex): Promise<ExplorerEntry[]> {
  const where = and(eq("chainId", u64(chainId)), eq("address", addr(address)), eq("status", "active"));
  const [d, g] = await Promise.all([
    reader.select().from(Descriptor).where(where).createdBy(PUBLISHER).limit(1).fetch(),
    reader.select().from(Delegate).where(where).createdBy(PUBLISHER).limit(1).fetch(),
  ]);
  // Query responses carry the block they were read at: no extra RPC call for expiry.
  const block = d.blockNumber;
  const secondsLeft = (expiresAt: bigint | number | undefined) => (Number(expiresAt ?? 0) - Number(block)) * BLOCK_SECONDS;
  const out: ExplorerEntry[] = [];

  const desc = d.entities[0];
  if (desc) {
    const raw = desc.descriptor?.value as Hex | undefined;
    const json = raw ? JSON.parse(new TextDecoder().decode(await gunzip(hexToBytes(raw)))) : null;
    out.push({
      kind: "descriptor",
      key: desc.$key,
      creator: desc.$creator as Hex,
      expiresInSeconds: secondsLeft(desc.$expiresAt),
      protocolOwner: desc.protocolOwner.value,
      descriptorHash: desc.descriptorHash.value,
      attested: desc.attested.value,
      sourceRepo: desc.sourceRepo.value,
      sourcePath: desc.sourcePath.value,
      sourceCommit: desc.sourceCommit.value,
      importedAt: Number(desc.importedAt.value),
      fingerprintOk: !!json && descriptorHash(json) === desc.descriptorHash.value,
      contractName: json?.metadata?.contractName,
      functions: Object.keys(json?.display?.formats ?? {}).map((k) => k.split("(")[0]!),
    });
  }

  const del = g.entities[0];
  if (del) {
    out.push({
      kind: "delegate",
      key: del.$key,
      creator: del.$creator as Hex,
      expiresInSeconds: secondsLeft(del.$expiresAt),
      vendor: del.vendor.value,
      contractName: del.contractName.value,
      version: del.version?.value,
      codeHash: del.codeHash.value,
      sourceRepo: del.sourceRepo.value,
      sourcePath: del.sourcePath.value,
      sourceCommit: del.sourceCommit.value,
      importedAt: Number(del.importedAt.value),
    });
  }
  return out;
}

/** The exact Arkiv query string for an address (shown in the UI so anyone can run it). */
export function arkivQuery(kind: "descriptor" | "delegate", chainId: number, address: string) {
  return `arkiv.schema = str('presign.${kind}.v1') AND chainId = u64(${chainId}) AND address = addr(${address}) AND $creator = addr(${PUBLISHER})`;
}

/**
 * A copy-pasteable curl for that query (no API key needed). Heredoc form, because the query itself
 * contains single quotes (str('…')) and `$creator`, which a quoted shell string would break.
 */
export function arkivCurl(kind: "descriptor" | "delegate", chainId: number, address: string) {
  const attributes =
    kind === "descriptor"
      ? { protocolOwner: true, descriptorHash: true, attested: true, sourcePath: true, sourceCommit: true }
      : { vendor: true, contractName: true, codeHash: true, sourceRepo: true, sourceCommit: true };
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "arkiv_query",
    params: [arkivQuery(kind, chainId, address), { select: { key: true, expiresAt: true, attributes } }],
  });
  return `curl -s ${ARKIV_RPC} --json @- <<'EOF'\n${body}\nEOF`;
}

export function formatDuration(seconds: number) {
  if (seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
}
