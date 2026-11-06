/**
 * Public, CORS-friendly read-only RPCs (publicnode) for the chains PreSign verifies delegates on.
 * Each one was checked to return the right eth_chainId (2026-11-06). Override with your own RPCs in production.
 */
export const PUBLIC_RPC: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};
