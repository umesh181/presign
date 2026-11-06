/**
 * Token metadata for tokenAmount / tokenTicker, read on-chain (ERC-20 symbol + decimals).
 * Browser-safe; one public client per chain we can read.
 */
import { erc20Abi, type Hex, type PublicClient } from "viem";
import type { TokenInfo, TokenLookup } from "./formatter.ts";

export function erc20Lookup(clients: Record<number, PublicClient>): TokenLookup {
  const cache = new Map<string, Promise<TokenInfo | null>>();
  return (chainId, address: Hex) => {
    const client = clients[chainId];
    if (!client) return Promise.resolve(null);
    const id = `${chainId}:${address.toLowerCase()}`;
    if (!cache.has(id)) {
      cache.set(
        id,
        Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
        ]).then(
          ([symbol, decimals]) => ({ symbol, decimals }),
          () => null, // not an ERC-20 (or RPC failure): formatter shows raw units + address
        ),
      );
    }
    return cache.get(id)!;
  };
}
