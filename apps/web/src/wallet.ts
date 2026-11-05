/**
 * Real wallet connection (MetaMask or any injected EIP-1193 wallet) on Sepolia.
 * PreSign runs BEFORE the wallet popup: a dApp or wallet would integrate it the same way.
 */
import { createPublicClient, createWalletClient, custom, http, type EIP1193Provider, type Hex } from "viem";
import { sepolia } from "viem/chains";

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

export async function connectWallet() {
  const provider = window.ethereum;
  if (!provider) throw new Error("No wallet found. Install MetaMask.");
  const wallet = createWalletClient({ chain: CHAIN, transport: custom(provider) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("No account selected");
  // Make sure the wallet is on Sepolia (adds nothing: Sepolia is built into MetaMask).
  if ((await wallet.getChainId()) !== CHAIN.id) await wallet.switchChain({ id: CHAIN.id });
  return { wallet, account };
}

export async function isContract(address: Hex): Promise<boolean> {
  const code = await chainReader.getCode({ address });
  return !!code && code !== "0x";
}
