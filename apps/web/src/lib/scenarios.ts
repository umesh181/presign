/**
 * Demo scenarios. Each one runs the REAL check() against live Arkiv data.
 * Mainnet / Sepolia transactions are only READ here; the browser never signs them.
 */
import {
  PUBLIC_RPC,
  checkDelegation,
  checkTransaction,
  codeHash,
  delegateLookup,
  descriptorLookup,
  erc20Lookup,
  formatCalldata,
  type DelegateDeps,
  type Result,
  type TransactionDeps,
  type TxInput,
} from "@presign/core";
import { createPublicClient, fallback, http, parseTransaction, type Hex, type PublicClient } from "viem";
import binance from "../../../../fixtures/binance-replay.json";
import registryTests from "../../../../fixtures/registry/calldata-UniswapV3SwapRouter.tests.json";
import { PUBLISHER, reader } from "./arkiv.ts";

/**
 * Browser read clients. Public RPCs have bad moments (we measured a 24 s eth_call), so each chain
 * uses several CORS-friendly endpoints with an 8 s limit, falling back to the next automatically.
 * Your own RPC (VITE_MAINNET_RPC_URL / VITE_SEPOLIA_RPC_URL) is tried first if set.
 */
const RPCS: Record<number, (string | undefined)[]> = {
  1: [import.meta.env.VITE_MAINNET_RPC_URL, PUBLIC_RPC[1], "https://1rpc.io/eth", "https://eth.drpc.org", "https://rpc.mevblocker.io"],
  11155111: [import.meta.env.VITE_SEPOLIA_RPC_URL, PUBLIC_RPC[11155111]],
};

export const clients: Record<number, PublicClient> = Object.fromEntries(
  Object.entries(RPCS).map(([id, urls]) => [
    Number(id),
    createPublicClient({
      transport: fallback(urls.filter((u): u is string => !!u).map((u) => http(u, { timeout: 8_000, retryCount: 0 }))),
    }) as PublicClient,
  ]),
);

const tokens = erc20Lookup(clients);
const lookupDescriptor = descriptorLookup(reader, PUBLISHER);

export const txDeps: TransactionDeps = {
  isContract: async (chainId, address) => {
    const code = await clients[chainId]?.getCode({ address });
    return !!code && code !== "0x";
  },
  lookupDescriptor,
  format: (descriptor, t) => formatCalldata(descriptor, { ...t, data: t.data! }, tokens),
};

export const delegateDeps: DelegateDeps = {
  lookupDelegate: delegateLookup(reader, PUBLISHER),
  currentCodeHash: async (chainId, address) => {
    const code = await clients[chainId]?.getCode({ address });
    return code && code !== "0x" ? codeHash(code) : null;
  },
};

export type Kind = "transaction" | "delegation";

export interface ScenarioRun {
  kind: Kind;
  result: Result;
  /** What the user is being asked to sign, in one line. */
  request: { label: string; value: string }[];
  chainId: number;
  note?: string;
  proof?: { label: string; href: string }[];
}

export interface Scenario {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  run: () => Promise<ScenarioRun>;
}

const UNISWAP = registryTests.tests[0]!;
const uniswapTx = parseTransaction(UNISWAP.rawTx as Hex);
const uniswapInput: TxInput = { chainId: uniswapTx.chainId!, to: uniswapTx.to!, value: uniswapTx.value ?? 0n, data: uniswapTx.data! };

const BINANCE_TX = "0xad99264d5532ae0dd04b2004eebda05f25657e70dacb764f7ac8d4ccd051298b" as const;
const METAMASK_DELEGATOR = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as const;
/** Real Sepolia tx sent by `npm run guard:demo` after PreSign approved it. */
const GUARD_DEMO_TX = "0x3e72f880d5b2e8e8d0755b2fddccfdf7306162ba76a13ed4b29a4d02af24987e";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const SCENARIOS: Scenario[] = [
  {
    id: "uniswap",
    title: "Uniswap swap",
    subtitle: "Real mainnet transaction, raw calldata → plain English",
    tag: "Clear signing",
    run: async () => ({
      kind: "transaction",
      chainId: 1,
      result: await checkTransaction(uniswapInput, txDeps),
      request: [
        { label: "To", value: `${short(uniswapInput.to)} (Uniswap V3 SwapRouter)` },
        { label: "Data", value: `${uniswapInput.data!.slice(0, 26)}…` },
      ],
      note: "Check only: a real Ethereum mainnet transaction, never signed here.",
      proof: [{ label: "Original tx on Etherscan", href: `https://etherscan.io/tx/${UNISWAP.txHash}` }],
    }),
  },
  {
    id: "binance",
    title: "Binance hot-wallet delegation",
    subtitle: "The real Oct 29 sweeper delegation, replayed read-only",
    tag: "EIP-7702",
    run: async () => {
      // The real authorization list of the mainnet tx, saved in fixtures/binance-replay.json
      // (copied from eth_getTransactionByHash) so the demo never waits on a public RPC.
      // The verdict itself is computed live against the delegate allowlist on Arkiv.
      const auths = binance.authorizationList.map((a) => ({ chainId: a.chainId, address: a.address as Hex, nonce: a.nonce }));
      return {
        kind: "delegation",
        chainId: 1,
        result: await checkDelegation(auths, delegateDeps),
        request: [
          { label: "Account", value: `${short(binance.authority)} (Binance 14)` },
          { label: "Delegate to", value: `${short(auths[0]!.address)} (sweeper)` },
          { label: "Authorizations", value: `${auths.length} in one transaction` },
        ],
        note: "Read-only replay of the mainnet transaction: a guarded signer would have refused it.",
        proof: [{ label: "Original tx on Etherscan", href: `https://etherscan.io/tx/${BINANCE_TX}` }],
      };
    },
  },
  {
    id: "metamask",
    title: "Upgrade to MetaMask smart account",
    subtitle: "Delegation to MetaMask's official EIP-7702 contract",
    tag: "EIP-7702",
    run: async () => ({
      kind: "delegation",
      chainId: 11155111,
      result: await checkDelegation([{ chainId: 11155111, address: METAMASK_DELEGATOR, nonce: 0 }], delegateDeps),
      request: [
        { label: "Delegate to", value: `${short(METAMASK_DELEGATOR)} (EIP7702StatelessDeleGator)` },
        { label: "Network", value: "Sepolia" },
      ],
      note: "Our Signer Guard sent this exact delegation as a real transaction after PreSign approved it.",
      proof: [{ label: "Real delegation tx (Sepolia)", href: `https://sepolia.etherscan.io/tx/${GUARD_DEMO_TX}` }],
    }),
  },
  {
    id: "tampered",
    title: "Tampered translation",
    subtitle: "Same Uniswap swap, but one character of the file is altered",
    tag: "Integrity",
    run: async () => {
      // Simulate a poisoned mirror: download the real descriptor, then change one character.
      const tamperedDeps: TransactionDeps = {
        ...txDeps,
        lookupDescriptor: async (c, a) => {
          const rec = await lookupDescriptor(c, a);
          if (!rec?.descriptor) return rec;
          const json = structuredClone(rec.descriptor) as { display: { formats: Record<string, { intent: string }> } };
          const key = Object.keys(json.display.formats).find((k) => k.startsWith("exactInputSingle"))!;
          json.display.formats[key]!.intent = "Swep"; // one character
          return { ...rec, descriptor: json };
        },
      };
      return {
        kind: "transaction",
        chainId: 1,
        result: await checkTransaction(uniswapInput, tamperedDeps),
        request: [
          { label: "To", value: `${short(uniswapInput.to)} (Uniswap V3 SwapRouter)` },
          { label: "Tampering", value: `intent "Swap" → "Swep" in the downloaded file` },
        ],
        note: "Simulated poisoning of the downloaded file. The fingerprint stored on Arkiv no longer matches.",
      };
    },
  },
];
