/**
 * "Check before you sign": demo scenarios on the left, wallet-style verdict on the right.
 * "Your transaction" is REAL: PreSign checks it, and only then does MetaMask open (Sepolia).
 */
import { checkTransaction, type Result, type TxInput } from "@presign/core";
import { useState } from "react";
import { encodeFunctionData, getAddress, isAddress, isHex, parseAbi, parseEther, type Hex, type WalletClient } from "viem";
import { NETWORKS, SCENARIOS, lookupTx, txDeps, type ScenarioRun } from "../lib/scenarios.ts";
import { CHAIN, EXPLORER, ensureSepolia } from "../wallet.ts";
import { External, Shield } from "./icons.tsx";
import { Verdict } from "./Verdict.tsx";

export type Wallet = { client: WalletClient; account: Hex } | null;

/**
 * Sepolia WETH: a real contract the EF clear-signing registry covers on Sepolia
 * (registry/weth/calldata-weth.json), so PreSign can show plain English before MetaMask opens.
 */
const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const WETH_ABI = parseAbi(["function deposit() payable", "function withdraw(uint256 wad)"]);
const WETH_ACTIONS = {
  wrap: { label: "Wrap 0.001 ETH → WETH", amount: "0.001", data: encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }) },
  unwrap: { label: "Unwrap 0.001 WETH → ETH", amount: "0", data: encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [parseEther("0.001")] }) },
} as const;

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

  // "Already signed?" lookup: explain a past transaction from its hash (read-only).
  const [hashChain, setHashChain] = useState("1");
  const [hash, setHash] = useState("");

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

  /** Check explicit values (React state may not be updated yet when a WETH button fills the form). */
  const checkTx = (to: string, amount: string, data: string) => {
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

  const checkCustom = () => checkTx(to, amount, data);

  const checkHash = () => {
    const h = hash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return setError("A transaction hash is 0x followed by 64 hex characters");
    go("hash", () => lookupTx(Number(hashChain), h as Hex));
  };

  // One click: fill the form with a real Sepolia WETH call and check it right away.
  const loadWeth = (kind: keyof typeof WETH_ACTIONS) => {
    const a = WETH_ACTIONS[kind];
    setTo(SEPOLIA_WETH);
    setAmount(a.amount);
    setData(a.data);
    checkTx(SEPOLIA_WETH, a.amount, a.data);
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
        {wallet ? (
          <button className="btn btn-primary" onClick={sign} disabled={busy}>
            {r.status === "trusted" ? "Sign with MetaMask" : "Sign anyway (not verified)"}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onConnect}>Connect wallet to sign</button>
        )}
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
            <div className="actions">
              <button className="btn" onClick={() => loadWeth("wrap")} disabled={busy}>{WETH_ACTIONS.wrap.label}</button>
              <button className="btn" onClick={() => loadWeth("unwrap")} disabled={busy}>{WETH_ACTIONS.unwrap.label}</button>
            </div>
            <label className="field"><span>To</span><input value={to} onChange={(e) => edit(setTo, e.target.value)} placeholder="0x…" /></label>
            <label className="field"><span>Amount (ETH)</span><input value={amount} onChange={(e) => edit(setAmount, e.target.value)} /></label>
            <label className="field"><span>Data (optional)</span><input value={data} onChange={(e) => edit(setData, e.target.value)} placeholder="0x…" /></label>
            <button className="btn btn-primary" onClick={checkCustom} disabled={busy}>Check with PreSign</button>
          </div>

          <div className="custom">
            <div className="wallet-line">
              <strong style={{ color: "var(--text)" }}>Already signed? Paste a transaction hash</strong>
            </div>
            <label className="field">
              <span>Network</span>
              <select value={hashChain} onChange={(e) => setHashChain(e.target.value)}>
                {Object.entries(NETWORKS).map(([id, n]) => <option key={id} value={id}>{n.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Transaction hash</span><input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" /></label>
            <button className="btn btn-primary" onClick={checkHash} disabled={busy}>Explain this transaction</button>
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
