/**
 * "About to Sign" with a REAL wallet:
 * build tx -> PreSign check() against Arkiv -> verdict -> only then the MetaMask popup -> real Sepolia tx.
 */
import { useEffect, useState } from "react";
import { formatEther, getAddress, isAddress, isHex, parseEther, parseTransaction, type Hex, type PublicClient, type WalletClient } from "viem";
import {
  checkTransaction,
  createReader,
  descriptorLookup,
  erc20Lookup,
  formatCalldata,
  type FormattedField,
  type Result,
  type TxInput,
} from "@presign/core";
import registryTests from "../../../fixtures/registry/calldata-UniswapV3SwapRouter.tests.json";
import { CHAIN, EXPLORER, chainReader, connectWallet, ensureSepolia, isContract, mainnetReader } from "./wallet.ts";

const publisher = import.meta.env.VITE_PUBLISHER_ADDRESS as Hex | undefined;
const reader = createReader(import.meta.env.VITE_ARKIV_ACCESS_KEY ?? "");
const lookup = publisher ? descriptorLookup(reader, publisher) : async () => null;
const tokens = erc20Lookup({ 1: mainnetReader as PublicClient, [CHAIN.id]: chainReader as PublicClient });

// Real Ethereum mainnet Uniswap V3 swap, taken from the registry's own test vectors
// (fixtures/registry). Check-only: we never sign or broadcast on mainnet.
const uniswapTx = parseTransaction(registryTests.tests[0]!.rawTx as Hex);
const UNISWAP_TX_HASH = registryTests.tests[0]!.txHash!;

const ICON = { trusted: "✅", blocked: "🛑", unknown: "⚠️" } as const;

export function SendFlow() {
  const [wallet, setWallet] = useState<{ client: WalletClient; account: Hex } | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [data, setData] = useState("");
  // Sepolia unless a mainnet check-only scenario is loaded; editing any field returns to Sepolia.
  const [chainId, setChainId] = useState<number>(CHAIN.id);
  const checkOnly = chainId !== CHAIN.id;
  const [tx, setTx] = useState<TxInput | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run<T>(fn: () => Promise<T>) {
    setError("");
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run(async () => {
      const connected = await connectWallet();
      if (connected) setWallet({ client: connected.wallet, account: connected.account });
    });

  // On page load, silently reuse an existing MetaMask connection (no popup).
  useEffect(() => {
    connectWallet(true)
      .then((c) => c && setWallet({ client: c.wallet, account: c.account }))
      .catch(() => {});
  }, []);

  // Runs check() on an explicit input (form state may not be updated yet after a scenario click).
  const runCheck = (input: TxInput) =>
    run(async () => {
      setResult(null);
      setTxHash(null);
      setTx(input);
      setResult(
        await checkTransaction(input, {
          isContract: (_c, a) => isContract(a),
          lookupDescriptor: lookup,
          format: (descriptor, t) => formatCalldata(descriptor, { ...t, data: t.data! }, tokens),
        }),
      );
    });

  const check = () => {
    setError("");
    if (!isAddress(to)) return setError("Recipient is not a valid address");
    if (data && !isHex(data)) return setError("Data must be 0x-prefixed hex");
    runCheck({
      chainId,
      to: getAddress(to),
      value: parseEther(amount || "0"),
      data: (data || undefined) as Hex | undefined,
    });
  };

  // One click: fill the form with the real mainnet tx AND run the check.
  const loadUniswap = () => {
    setTo(uniswapTx.to!);
    setAmount(formatEther(uniswapTx.value ?? 0n));
    setData(uniswapTx.data!);
    setChainId(uniswapTx.chainId!);
    runCheck({ chainId: uniswapTx.chainId!, to: uniswapTx.to!, value: uniswapTx.value ?? 0n, data: uniswapTx.data! });
  };

  // Manual edits always mean a Sepolia transaction again.
  const edit = (set: (v: string) => void, v: string) => {
    set(v);
    setChainId(CHAIN.id);
  };

  const fields = (result?.details?.fields as FormattedField[] | undefined) ?? [];

  // Only reachable after a verdict. Blocked => no button at all.
  const sign = () =>
    run(async () => {
      if (!wallet || !tx) return;
      await ensureSepolia(wallet.client);
      const hash = await wallet.client.sendTransaction({
        account: wallet.account,
        chain: CHAIN,
        to: tx.to,
        value: tx.value,
        data: tx.data,
      });
      setTxHash(hash);
    });

  return (
    <div className="flow">
      {!wallet ? (
        <button onClick={connect} disabled={busy}>Connect MetaMask (Sepolia)</button>
      ) : (
        <p>Connected: <code>{wallet.account}</code> on {CHAIN.name}</p>
      )}

      <div>
        <button onClick={loadUniswap} disabled={busy}>Scenario: Uniswap swap (Ethereum mainnet, check only)</button>
      </div>
      {checkOnly && (
        <p className="todo">
          Loaded real mainnet tx{" "}
          <a href={`https://etherscan.io/tx/${UNISWAP_TX_HASH}`} target="_blank" rel="noreferrer">{UNISWAP_TX_HASH.slice(0, 12)}…</a>. Check only: not signed.
        </p>
      )}

      <label>To <input value={to} onChange={(e) => edit(setTo, e.target.value)} placeholder="0x…" /></label>
      <label>Amount (ETH) <input value={amount} onChange={(e) => edit(setAmount, e.target.value)} /></label>
      <label>Data (optional, for contract calls) <input value={data} onChange={(e) => edit(setData, e.target.value)} placeholder="0x…" /></label>
      <button onClick={check} disabled={busy || (!checkOnly && !wallet)}>Check with PreSign</button>

      {!publisher && <p className="todo">VITE_PUBLISHER_ADDRESS not set: contract calls will show "unknown" until data is on Arkiv.</p>}

      {result && (
        <div className={`verdict ${result.status}`}>
          <strong>{ICON[result.status]} {result.status.toUpperCase()}</strong>
          <p>{result.reason}</p>
          {fields.length > 0 && (
            <dl>
              {fields.map((f) => (
                <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
              ))}
            </dl>
          )}
          {typeof result.details?.protocol === "string" && (
            <p className="meta">
              Protocol: {result.details.protocol} · Translation fingerprint verified ✅
              {result.details.attested === true && " · Audited by Cyfrin ✅"}
              {typeof result.details.entityKey === "string" && (
                <> · <a href={`https://rabdi.explorer.arkiv.network/entity/${result.details.entityKey}`} target="_blank" rel="noreferrer">Arkiv entity ↗</a></>
              )}
            </p>
          )}
          {result.warnings.map((w) => <p key={w}>⚠️ {w}</p>)}
          {checkOnly ? (
            <p>Check only (Ethereum mainnet): this demo never signs mainnet transactions.</p>
          ) : (
            <>
              {result.status === "trusted" && <button onClick={sign} disabled={busy}>Sign with MetaMask</button>}
              {result.status === "unknown" && <button onClick={sign} disabled={busy}>Sign anyway (not verified)</button>}
            </>
          )}
          {result.status === "blocked" && <p>Signing disabled.</p>}
        </div>
      )}

      {txHash && (
        <p>Sent: <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash}</a></p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
