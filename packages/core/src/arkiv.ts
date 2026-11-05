/**
 * Read-only Arkiv access (browser-safe: no private keys here).
 * Writes live in ./node.ts so the web app never bundles a signer.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";

export function createReader(accessKey: string) {
  // Rabdi = Arkiv's current testnet (chain 7794095). An empty key falls back to the
  // heavily rate-limited public RPC.
  return createPublicClient({ chain: rabdi({ accessKey }), transport: http() });
}

export type Reader = ReturnType<typeof createReader>;

// TODO(B): findDescriptor(reader, publisher, chainId, address)
//   select().from(Descriptor).where(and(eq("chainId", u64(chainId)), eq("address", addr(address)),
//   eq("status", "active"))).createdBy(publisher).limit(1).fetch()
// TODO(B): findDelegate(reader, publisher, chainId, address) — same pattern with Delegate.
