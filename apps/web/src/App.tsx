import { useEffect, useState } from "react";
import { CheckPage, type Wallet } from "./components/CheckPage.tsx";
import { Explorer } from "./components/Explorer.tsx";
import { Radar } from "./components/Radar.tsx";
import { External, Shield } from "./components/icons.tsx";
import { ARKIV_EXPLORER, liveStats, PUBLISHER, type Stats } from "./lib/arkiv.ts";
import { radarStats, type RadarStats } from "./lib/radar.ts";
import { connectWallet } from "./wallet.ts";

type Page = "check" | "radar" | "explorer";

// Each page gets its own hero; the live numbers below it stay the same.
const HERO: Record<Page, { eyebrow: string; title: [string, string]; text: string }> = {
  check: {
    eyebrow: "The checkpoint before every signature",
    title: ["Know what you sign.", "Know who you trust."],
    text: "Pick a transaction or an EIP-7702 delegation, or paste a transaction hash. PreSign checks it against data on Arkiv and explains it in plain English, before your wallet pops up.",
  },
  radar: {
    eyebrow: "Delegation Radar",
    title: ["Every 7702 delegate,", "judged by evidence."],
    text: "The Watchtower watches EIP-7702 delegations on-chain and publishes what it finds to Arkiv: drainer code, upgradeable logic, code changes, and alerts that can't be deleted.",
  },
  explorer: {
    eyebrow: "Registry Explorer",
    title: ["Look it up yourself.", "Straight from Arkiv."],
    text: "Search any contract by chain and address to see its clear-signing translation or its delegate record, with where the data came from and who published it. No PreSign server in between.",
  },
};

export function AppPage() {
  // Deep links: #/app/radar, #/app/explorer
  const [page, setPage] = useState<Page>(() => (location.hash.includes("radar") ? "radar" : location.hash.includes("explorer") ? "explorer" : "check"));
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
    <div className="app-shell">
      <header className="header">
        <div className="container">
          <a className="brand" href="#/" title="Back to the PreSign homepage">
            <span className="brand-mark"><Shield size={14} /></span>
            PreSign
          </a>
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
          {/* key={page}: remount on tab switch so the fade-up replays */}
          <div key={page} className="hero-anim">
            <div className="eyebrow"><Shield size={15} /> {HERO[page].eyebrow}</div>
            <h1>
              {HERO[page].title[0]}<br />
              {HERO[page].title[1]}
            </h1>
            <p>{HERO[page].text}</p>
          </div>
          <div className="stats">
            <div className="stat"><b>{fmt(stats?.descriptors)}</b><span>Clear-signing translations</span><small>EF registry · {fmt(stats?.attested)} audited by Cyfrin</small></div>
            <div className="stat"><b>{fmt(radar?.profiles)}</b><span>7702 delegates watched</span><small>evidence from the chain · {fmt(stats?.delegates)} vendor-listed</small></div>
            <div className="stat"><b>{fmt(radar?.families)}</b><span>Known drainer families</span><small>matched by code, not by address</small></div>
            <div className="stat"><b>{fmt(radar?.alerts)}</b><span>Watchtower alerts</span><small>readonly on Arkiv · can&apos;t be deleted</small></div>
          </div>
        </section>

        {walletError && <p className="error">{walletError}</p>}
        {page === "check" ? <CheckPage wallet={wallet} onConnect={connect} /> : page === "radar" ? <Radar /> : <Explorer />}
      </main>

      <footer className="footer">
        <div className="container">
          <span>PreSign · built at ETHGlobal Mumbai 2026 on Arkiv</span>
          <span className="footer-links">
            <a href="#/how">How it works</a>
            <a href="#/radar">Radar</a>
            <a href="#/arkiv">Why Arkiv</a>
            <a href="https://github.com/umesh181/presign" target="_blank" rel="noreferrer">GitHub <External /></a>
            <a className="mono" href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">Publisher {PUBLISHER.slice(0, 10)}… <External /></a>
          </span>
        </div>
      </footer>
    </div>
  );
}
