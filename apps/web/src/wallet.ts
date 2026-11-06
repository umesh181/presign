/**
 * Real wallet connection (MetaMask or any injected EIP-1193 wallet) on Sepolia.
 * PreSign runs BEFORE the wallet popup: a dApp or wallet would integrate it the same way.
 */
import { createPublicClient, createWalletClient, custom, http, type EIP1193Provider, type Hex, type WalletClient } from "viem";
import { mainnet, sepolia } from "viem/chains";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const CHAIN = sepolia;
export const EXPLORER = "https://sepolia.etherscan.io";

export const chainReader = createPublicClient({
  chain: CHAIN,
  transport: http(import.meta.env.VITE_SEPOLIA_RPC_URL || undefined),
});

/** MetaMask error -32002: a connect popup is already open and unanswered. */
function isPendingRequest(e: unknown): boolean {
  const err = e as { code?: number; cause?: { code?: number }; message?: string };
  return err?.code === -32002 || err?.cause?.code === -32002 || /already pending/i.test(err?.message ?? "");
}

/**
 * Connect the wallet.
 * silent=true: only reuse an existing connection (no popup), used on page load.
 */
/**
 * Read-only Ethereum mainnet access, for check-only scenarios (token symbols/decimals). Never signs.
 * Default: publicnode, because viem's built-in mainnet RPC rejects browser CORS preflights.
 */
export const mainnetReader = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com"),
});

export async function connectWallet(silent = false) {
  const provider = window.ethereum;
  if (!provider) throw new Error("No wallet found. Install MetaMask.");
  const wallet = createWalletClient({ chain: CHAIN, transport: custom(provider) });

  // Already connected before? eth_accounts returns it without opening a popup.
  let [account] = await wallet.getAddresses();
  if (!account) {
    if (silent) return null;
    try {
      [account] = await wallet.requestAddresses();
    } catch (e) {
      if (isPendingRequest(e)) {
        throw new Error(
          "MetaMask already has a connection request open. Click the MetaMask fox icon in your browser toolbar and approve it, then try again.",
        );
      }
      throw e;
    }
  }
  if (!account) throw new Error("No account selected");
  // On load (silent) don't pop up a network switch; ensureSepolia() runs before signing.
  if (!silent) await ensureSepolia(wallet);
  return { wallet, account };
}

/** Make sure the wallet is on Sepolia (built into MetaMask, so no network needs adding). */
export async function ensureSepolia(wallet: WalletClient) {
  if ((await wallet.getChainId()) !== CHAIN.id) await wallet.switchChain({ id: CHAIN.id });
}

export async function isContract(address: Hex): Promise<boolean> {
  const code = await chainReader.getCode({ address });
  return !!code && code !== "0x";
}
