/** Delegation Radar: Watchtower evidence about EIP-7702 delegates, live from Arkiv. */
import { useEffect, useState } from "react";
import { isAddress, type Hex } from "viem";
import { ARKIV_EXPLORER } from "../lib/arkiv.ts";
import { RADAR_CHAINS, checkAccount, checkDelegate, listAlerts, listProfiles, radarStats, type AlertRow, type ProfileRow, type RadarStats } from "../lib/radar.ts";
import type { ScenarioRun } from "../lib/scenarios.ts";
import { External, Search, Shield } from "./icons.tsx";
import { Verdict } from "./Verdict.tsx";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (unix: number) => {
  const s = Math.max(60, Date.now() / 1000 - unix);
  return s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

export function Radar() {
  const [stats, setStats] = useState<RadarStats | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [chainId, setChainId] = useState(1);
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [account, setAccount] = useState("");
  const [accountChain, setAccountChain] = useState("11155111");
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Alerts are the live part: refresh every 15 s.
  useEffect(() => {
    const load = () => {
      listAlerts().then(setAlerts).catch(() => {});
      radarStats().then(setStats).catch(() => {});
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setProfiles(null);
    listProfiles(chainId).then(setProfiles).catch((e) => setError(String(e)));
  }, [chainId]);

  async function go(fn: () => Promise<ScenarioRun | null>, none?: string) {
    setError("");
    setInfo("");
    setRun(null);
    setBusy(true);
    try {
      const r = await fn();
      if (r) setRun(r);
      else if (none) setInfo(none);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  }

  const checkMyAccount = () => {
    const a = account.trim();
    if (!isAddress(a)) return setError("Enter a valid 0x account address");
    go(() => checkAccount(Number(accountChain), a as Hex), "No EIP-7702 delegation on this account: it's a plain wallet.");
  };

  const fmt = (n?: number) => (n === undefined ? "…" : n.toLocaleString("en-US"));

  return (
    <>
      <div className="section-title">
        <h2>Delegation Radar</h2>
        <p>No contract is trusted because it says so: the Watchtower publishes on-chain evidence to Arkiv, and every verdict is computed from it.</p>
      </div>

      <div className="stats radar-stats">
        <div className="stat"><b>{fmt(stats?.profiles)}</b><span>Delegates watched</span><small>Ethereum · Sepolia · vendor chains</small></div>
        <div className="stat"><b>{fmt(stats?.families)}</b><span>Known drainer families</span><small>from published incident research</small></div>
        <div className="stat"><b>{fmt(stats?.upgradeable)}</b><span>Upgradeable delegates</span><small>logic someone else can swap</small></div>
        <div className="stat"><b>{fmt(stats?.alerts)}</b><span>Alerts</span><small>readonly · can't be deleted</small></div>
      </div>

      <div className="grid-2">
        <div className="scenarios">
          <div className="custom">
            <div className="wallet-line"><strong style={{ color: "var(--text)" }}>Is my account exposed?</strong></div>
            <label className="field">
              <span>Network</span>
              <select value={accountChain} onChange={(e) => setAccountChain(e.target.value)}>
                {Object.entries(RADAR_CHAINS).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Account address</span><input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="0x…" /></label>
            <button className="btn btn-primary" onClick={checkMyAccount} disabled={busy}><Search /> Check its delegation</button>
          </div>

          <div className="card card-pad">
            <div className="wallet-line" style={{ marginBottom: 10 }}>
              <strong style={{ color: "var(--text)" }}>Live alerts</strong>
              <span className="live"><span className="dot" /> refreshes every 15 s</span>
            </div>
            {alerts === null ? (
              <div className="empty" style={{ padding: 16 }}><div className="spinner" /></div>
            ) : alerts.length === 0 ? (
              <p className="muted">No alerts yet.</p>
            ) : (
              <div className="alerts">
                {alerts.slice(0, 8).map((a) => (
                  <div key={a.key} className={`alert ${a.alertType}`}>
                    <div className="alert-top">
                      <span className="tag">{a.alertType === "logicChanged" ? "Logic changed" : "Known drainer"}</span>
                      <span className="muted">{RADAR_CHAINS[a.chainId]?.name ?? a.chainId} · {ago(a.detectedAt)}</span>
                    </div>
                    <div className="alert-msg">{a.message}</div>
                    <div className="alert-actions">
                      <button className="chip" onClick={() => go(() => checkDelegate(a.chainId, a.delegate))}>Check {short(a.delegate)}</button>
                      <a className="chip" href={`${ARKIV_EXPLORER}/entity/${a.key}`} target="_blank" rel="noreferrer">Arkiv entity <External /></a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          {busy ? (
            <div className="card empty"><div className="spinner" /><div>Reading the chain and Arkiv…</div></div>
          ) : run ? (
            <Verdict {...run} />
          ) : (
            <div className="card empty">
              <div className="status-icon"><Shield size={26} /></div>
              <strong style={{ color: "var(--text)", fontSize: 17 }}>Pick a delegate or an account</strong>
              <div>{info || "PreSign shows the evidence a wallet would show before signing a delegation."}</div>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 36 }}>
        <h2>Delegates seen on-chain</h2>
        <div className="nav">
          {Object.entries(RADAR_CHAINS).map(([id, c]) => (
            <button key={id} aria-pressed={chainId === Number(id)} onClick={() => setChainId(Number(id))}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="card table-wrap">
        {profiles === null ? (
          <div className="empty"><div className="spinner" /><div>Querying Arkiv…</div></div>
        ) : profiles.length === 0 ? (
          <div className="empty"><div>No delegates on Arkiv for this chain yet: run <code>npm run watchtower -- --write</code>.</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Delegate contract</th><th>Evidence</th><th className="num">Accounts</th><th>First seen</th><th /></tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.key}>
                  <td className="mono">{short(p.address)}</td>
                  <td>
                    <div className="chips">
                      {p.knownBad !== "none" && <span className="chip bad">Known drainer: {p.knownBad}</span>}
                      {p.vendor !== "none" ? <span className="chip good">{p.vendor}</span> : <span className="chip">No vendor</span>}
                      {p.upgradeable && <span className="chip warn">Upgradeable</span>}
                    </div>
                  </td>
                  <td className="num">{p.accounts.toLocaleString("en-US")}</td>
                  <td className="muted">{ago(p.firstSeenAt)}</td>
                  <td><button className="btn btn-sm" onClick={() => go(() => checkDelegate(chainId, p.address))}>Check</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
