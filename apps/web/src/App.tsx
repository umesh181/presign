import { useEffect, useState } from "react";
import { CheckPage, type Wallet } from "./components/CheckPage.tsx";
import { Explorer } from "./components/Explorer.tsx";
import { Radar } from "./components/Radar.tsx";
import { External, Shield } from "./components/icons.tsx";
import { ARKIV_EXPLORER, liveStats, PUBLISHER, type Stats } from "./lib/arkiv.ts";
import { radarStats, type RadarStats } from "./lib/radar.ts";
import { connectWallet } from "./wallet.ts";

type Page = "check" | "radar" | "explorer";

export function App() {
  const [page, setPage] = useState<Page>("check");
  const [stats, setStats] = useState<Stats | null>(null);
  const [radar, setRadar] = useState<RadarStats | null>(null);
  const [wallet, setWallet] = useState<Wallet>(null);
  const [walletError, setWalletError] = useState("");

  useEffect(() => {
    liveStats().then(setStats).catch(() => setStats(null));
    radarStats().then(setRadar).catch(() => setRadar(null));
    // Reuse an existing MetaMask connection silently (no popup).
    connectWallet(true)
      .then((c) => c && setWallet({ client: c.wallet, account: c.account }))
      .catch(() => {});
  }, []);

  const connect = async () => {
    setWalletError("");
    try {
      const c = await connectWallet();
      if (c) setWallet({ client: c.wallet, account: c.account });
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : String(e));
    }
  };

  const fmt = (n?: number) => (n === undefined ? "…" : n.toLocaleString("en-US"));

  return (
    <>
      <header className="header">
        <div className="container">
          <div className="brand">
            <span className="brand-mark"><Shield size={18} /></span>
            PreSign
          </div>
          <nav className="nav">
            <button aria-pressed={page === "check"} onClick={() => setPage("check")}>Check</button>
            <button aria-pressed={page === "radar"} onClick={() => setPage("radar")}>Radar</button>
            <button aria-pressed={page === "explorer"} onClick={() => setPage("explorer")}>Explorer</button>
          </nav>
          <div className="header-right">
            <a className="pill hide-sm" href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">
              <span className="dot" /> Arkiv · Rabdi
            </a>
            {wallet ? (
              <span className="pill mono">{wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</span>
            ) : (
              <button className="btn" onClick={connect}>Connect wallet</button>
            )}
          </div>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <div className="eyebrow"><Shield size={15} /> The checkpoint before every signature</div>
          <h1>
            Know <em>what you sign</em>.<br />
            Know <em>who you trust</em>.
          </h1>
          <p>
            PreSign mirrors Ethereum's clear-signing translations onto Arkiv and watches every EIP-7702 delegate contract
            on-chain, publishing the evidence (drainer code, upgradeable logic, logic changes) for any wallet to check before
            a signature.
          </p>
          <div className="stats">
            <div className="stat"><b>{fmt(stats?.descriptors)}</b><span>Clear-signing translations</span><small>EF registry · {fmt(stats?.attested)} audited by Cyfrin</small></div>
            <div className="stat"><b>{fmt(radar?.profiles)}</b><span>7702 delegates watched</span><small>evidence from the chain · {fmt(stats?.delegates)} vendor-listed</small></div>
            <div className="stat"><b>{fmt(radar?.families)}</b><span>Known drainer families</span><small>matched by code, not by address</small></div>
            <div className="stat"><b>{fmt(radar?.alerts)}</b><span>Watchtower alerts</span><small>readonly on Arkiv · 7-day trust expiry</small></div>
          </div>
        </section>

        {walletError && <p className="error">{walletError}</p>}
        {page === "check" ? <CheckPage wallet={wallet} onConnect={connect} /> : page === "radar" ? <Radar /> : <Explorer />}
      </main>

      <footer className="footer">
        <div className="container">
          <span>PreSign · built at ETHGlobal Mumbai 2026 on Arkiv</span>
          <span>
            Publisher <a className="mono" href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">{PUBLISHER.slice(0, 10)}… <External /></a>
            {" · "}
            <a href="https://github.com/umesh181/presign" target="_blank" rel="noreferrer">GitHub <External /></a>
          </span>
        </div>
      </footer>
    </>
  );
}
