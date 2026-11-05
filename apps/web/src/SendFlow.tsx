/**
 * "About to Sign" with a REAL wallet:
 * build tx -> PreSign check() against Arkiv -> verdict -> only then the MetaMask popup -> real Sepolia tx.
 */
import { useEffect, useState } from "react";
import { getAddress, isAddress, isHex, parseEther, type Hex, type WalletClient } from "viem";
import {
  checkTransaction,
  createReader,
  descriptorLookup,
  formatWithDescriptor,
  type Result,
  type TxInput,
} from "@presign/core";
import { CHAIN, EXPLORER, connectWallet, ensureSepolia, isContract } from "./wallet.ts";

const publisher = import.meta.env.VITE_PUBLISHER_ADDRESS as Hex | undefined;
const reader = createReader(import.meta.env.VITE_ARKIV_ACCESS_KEY ?? "");
const lookup = publisher ? descriptorLookup(reader, publisher) : async () => null;

const ICON = { trusted: "✅", blocked: "🛑", unknown: "⚠️" } as const;

export function SendFlow() {
  const [wallet, setWallet] = useState<{ client: WalletClient; account: Hex } | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [data, setData] = useState("");
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

  const check = () =>
    run(async () => {
      setResult(null);
      setTxHash(null);
      if (!isAddress(to)) throw new Error("Recipient is not a valid address");
      if (data && !isHex(data)) throw new Error("Data must be 0x-prefixed hex");
      const input: TxInput = {
        chainId: CHAIN.id,
        to: getAddress(to),
        value: parseEther(amount || "0"),
        data: (data || undefined) as Hex | undefined,
      };
      setTx(input);
      setResult(
        await checkTransaction(input, {
          isContract: (_c, a) => isContract(a),
          lookupDescriptor: lookup,
          format: formatWithDescriptor,
        }),
      );
    });

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

      <label>To <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" /></label>
      <label>Amount (ETH) <input value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label>Data (optional, for contract calls) <input value={data} onChange={(e) => setData(e.target.value)} placeholder="0x…" /></label>
      <button onClick={check} disabled={busy || !wallet}>Check with PreSign</button>

      {!publisher && <p className="todo">VITE_PUBLISHER_ADDRESS not set: contract calls will show "unknown" until data is on Arkiv.</p>}

      {result && (
        <div className={`verdict ${result.status}`}>
          <strong>{ICON[result.status]} {result.status.toUpperCase()}</strong>
          <p>{result.reason}</p>
          {result.warnings.map((w) => <p key={w}>⚠️ {w}</p>)}
          {result.status === "trusted" && <button onClick={sign} disabled={busy}>Sign with MetaMask</button>}
          {result.status === "unknown" && <button onClick={sign} disabled={busy}>Sign anyway (not verified)</button>}
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
