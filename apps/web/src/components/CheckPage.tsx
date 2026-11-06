/**
 * "Check before you sign": demo scenarios on the left, wallet-style verdict on the right.
 * "Your transaction" is REAL: PreSign checks it, and only then does MetaMask open (Sepolia).
 */
import { checkTransaction, type Result, type TxInput } from "@presign/core";
import { useState } from "react";
import { getAddress, isAddress, isHex, parseEther, type Hex, type WalletClient } from "viem";
import { SCENARIOS, txDeps, type ScenarioRun } from "../lib/scenarios.ts";
import { CHAIN, EXPLORER, ensureSepolia } from "../wallet.ts";
import { External, Shield } from "./icons.tsx";
import { Verdict } from "./Verdict.tsx";

export type Wallet = { client: WalletClient; account: Hex } | null;

export function CheckPage({ wallet, onConnect }: { wallet: Wallet; onConnect: () => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // "Your transaction" form (Sepolia, really signed after the check)
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [data, setData] = useState("");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  // The exact transaction PreSign checked: signing uses THIS, never the (possibly edited) form.
  const [checked, setChecked] = useState<TxInput | null>(null);

  async function go(id: string, fn: () => Promise<ScenarioRun>) {
    setActive(id);
    setRun(null);
    setError("");
    setTxHash(null);
    setBusy(true);
    try {
      // Never leave the demo spinning forever if a public RPC hangs.
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Network is slow: please try again.")), 25_000));
      setRun(await Promise.race([fn(), timeout]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const checkCustom = () => {
    if (!isAddress(to)) return setError("Recipient is not a valid address");
    if (data && !isHex(data)) return setError("Data must be 0x-prefixed hex");
    const input: TxInput = { chainId: CHAIN.id, to: getAddress(to), value: parseEther(amount || "0"), data: (data || undefined) as Hex | undefined };
    setChecked(input);
    go("custom", async () => ({
      kind: "transaction",
      chainId: CHAIN.id,
      result: await checkTransaction(input, txDeps),
      request: [
        { label: "To", value: input.to },
        { label: "Value", value: `${amount || "0"} ETH` },
        ...(input.data ? [{ label: "Data", value: `${input.data.slice(0, 26)}…` }] : []),
      ],
    }));
  };

  const sign = async () => {
    if (!wallet || !checked) return;
    setError("");
    setBusy(true);
    try {
      await ensureSepolia(wallet.client);
      const hash = await wallet.client.sendTransaction({
        account: wallet.account,
        chain: CHAIN,
        to: checked.to,
        value: checked.value,
        data: checked.data,
      });
      setTxHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Editing the form invalidates the previous verdict: the user must check again before signing.
  const edit = (set: (v: string) => void, v: string) => {
    set(v);
    if (active === "custom") {
      setRun(null);
      setChecked(null);
      setActive(null);
    }
  };

  const signButtons = (r: Result) =>
    r.status === "blocked" ? (
      <button className="btn btn-danger" disabled>Signing disabled</button>
    ) : (
      <>
        <button className="btn btn-primary" onClick={sign} disabled={busy}>
          {r.status === "trusted" ? "Sign with MetaMask" : "Sign anyway (not verified)"}
        </button>
        {txHash && (
          <a className="btn" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
            Sent ✓ view on Etherscan <External />
          </a>
        )}
      </>
    );

  return (
    <>
      <div className="section-title">
        <h2>Check before you sign</h2>
        <p>Every verdict below is computed live from data on Arkiv.</p>
      </div>
      <div className="grid-2">
        <div className="scenarios">
          {SCENARIOS.map((s) => (
            <button key={s.id} className="scenario" aria-pressed={active === s.id} onClick={() => go(s.id, s.run)} disabled={busy}>
              <strong>{s.title}</strong>
              <span className="tag">{s.tag}</span>
              <p>{s.subtitle}</p>
            </button>
          ))}

          <div className="custom">
            <div className="wallet-line">
              <strong style={{ color: "var(--text)" }}>Your transaction (Sepolia)</strong>
              {wallet ? (
                <span className="mono">{wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</span>
              ) : (
                <button className="btn" onClick={onConnect}>Connect wallet</button>
              )}
            </div>
            <label className="field"><span>To</span><input value={to} onChange={(e) => edit(setTo, e.target.value)} placeholder="0x…" /></label>
            <label className="field"><span>Amount (ETH)</span><input value={amount} onChange={(e) => edit(setAmount, e.target.value)} /></label>
            <label className="field"><span>Data (optional)</span><input value={data} onChange={(e) => edit(setData, e.target.value)} placeholder="0x…" /></label>
            <button className="btn btn-primary" onClick={checkCustom} disabled={busy || !wallet}>Check with PreSign</button>
          </div>
        </div>

        <div>
          {busy && !run ? (
            <div className="card empty"><div className="spinner" /><div>Reading Arkiv and the chain…</div></div>
          ) : run ? (
            <Verdict {...run} actions={active === "custom" ? signButtons(run.result) : undefined} />
          ) : (
            <div className="card empty">
              <div className="status-icon"><Shield size={26} /></div>
              <strong style={{ color: "var(--text)", fontSize: 17 }}>Pick something to sign</strong>
              <div>PreSign checks it against Arkiv and shows the verdict here, before any wallet popup.</div>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </>
  );
}
