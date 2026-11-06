/** Landing page: what PreSign is, with live numbers read from Arkiv. The app lives at #/app. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ARKIV_EXPLORER, liveStats, PUBLISHER, type Stats } from "../lib/arkiv.ts";
import { radarStats, type RadarStats } from "../lib/radar.ts";
import { Check, Cross, External, Shield, Stop, Warn } from "./icons.tsx";

const GITHUB = "https://github.com/umesh181/presign";
const DRAINER = "0x84D05511614272694D3a9cebE896514DBDE51F40";

/** Real verdicts PreSign produced during the build (Uniswap mainnet tx, Radar demo, live mainnet finding). */
const VERDICTS = [
  {
    status: "trusted",
    label: "VERIFIED",
    kind: "Transaction",
    title: "Swap 0.55 WETH for at least 0 DACITY",
    lines: [
      ["ok", "Translation found on Arkiv (Uniswap Labs)"],
      ["ok", "Fingerprint re-computed in your browser"],
      ["ok", "Decoded with the protocol's own ERC-7730 rules"],
    ],
  },
  {
    status: "unknown",
    label: "CAUTION",
    kind: "EIP-7702 delegation",
    title: "Unknown contract: no wallet vendor vouches for it",
    lines: [
      ["ok", "Code doesn't match any known drainer family"],
      ["warn", "Upgradeable: its owner can swap the logic"],
      ["warn", "First seen by the Watchtower 1 min ago"],
    ],
  },
  {
    status: "blocked",
    label: "BLOCKED",
    kind: "EIP-7702 delegation",
    title: "Same code as a known wallet drainer",
    lines: [
      ["fail", "Code family: CrimeEnjoyor v1 (published research)"],
      ["fail", "Watchtower alert on Arkiv: can't be deleted"],
      ["warn", "Not listed by any wallet vendor"],
    ],
  },
] as const;

/** Fade sections in as they scroll into view. */
function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return setShown(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setShown(true), io.disconnect()), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${shown ? "in" : ""} ${className}`}>
      {children}
    </div>
  );
}

function VerdictPreview() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % VERDICTS.length), 3600);
    return () => clearInterval(t);
  }, []);
  const v = VERDICTS[i]!;
  const icon = { trusted: <Shield size={22} />, unknown: <Warn />, blocked: <Stop /> }[v.status];
  return (
    <div className={`lp-verdict ${v.status}`} key={i}>
      <div className="lp-verdict-head">
        <span>PreSign · {v.kind}</span>
        <span className="mono">before you sign</span>
      </div>
      <div className="lp-verdict-body">
        <div className="lp-verdict-status">
          <span className="lp-verdict-icon">{icon}</span>
          <div>
            <div className="lp-verdict-label">{v.label}</div>
            <div className="lp-verdict-title">{v.title}</div>
          </div>
        </div>
        <div className="lp-verdict-lines">
          {v.lines.map(([s, t]) => (
            <div key={t} className={`check ${s}`}>
              <span className="ic">{s === "ok" ? <Check /> : s === "fail" ? <Cross /> : <Warn />}</span>
              {t}
            </div>
          ))}
        </div>
      </div>
      <div className="lp-verdict-dots">
        {VERDICTS.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}
      </div>
    </div>
  );
}

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [radar, setRadar] = useState<RadarStats | null>(null);
  useEffect(() => {
    liveStats().then(setStats).catch(() => {});
    radarStats().then(setRadar).catch(() => {});
  }, []);
  const fmt = (n?: number) => (n === undefined ? "…" : n.toLocaleString("en-US"));
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="brand" href="#/" onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: "smooth" }))}>
          <span className="brand-mark"><Shield size={18} /></span>
          PreSign
        </a>
        <nav className="lp-pill">
          <button onClick={() => go("problem")}>Problem</button>
          <button onClick={() => go("how")}>How it works</button>
          <button onClick={() => go("radar")}>Radar</button>
          <button onClick={() => go("arkiv")}>Why Arkiv</button>
        </nav>
        <button className="btn btn-light" onClick={onLaunch}>Launch app <span aria-hidden>→</span></button>
      </header>

      {/* ---------- hero ---------- */}
      <section className="lp-hero">
        <div className="lp-floor" aria-hidden />
        <div className="lp-glow" aria-hidden />
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-badge"><span className="dot" /> Live on Arkiv · ETHGlobal Mumbai 2026</span>
            <h1>
              The checkpoint
              <br />
              <span className="lp-fade">before every signature.</span>
            </h1>
            <p>
              PreSign shows what a transaction really does in plain English, and judges who you're handing your account to from
              on-chain evidence. All of it is public on Arkiv, before your wallet pops up.
            </p>
            <div className="lp-cta">
              <button className="btn btn-light btn-lg" onClick={onLaunch}>Launch app <span aria-hidden>→</span></button>
              <a className="btn btn-ghost btn-lg" href={GITHUB} target="_blank" rel="noreferrer">View source <External /></a>
            </div>
          </div>
          <VerdictPreview />
        </div>
      </section>

      {/* ---------- live numbers ---------- */}
      <section className="lp-frame lp-stats">
        <div className="lp-cell">
          <b>{fmt(stats?.descriptors)}</b>
          <span>Clear-signing translations</span>
          <small>EF registry · {fmt(stats?.attested)} audited by Cyfrin</small>
        </div>
        <div className="lp-cell">
          <b>{fmt(radar?.profiles)}</b>
          <span>EIP-7702 delegates watched</span>
          <small>evidence read from 7 chains</small>
        </div>
        <div className="lp-cell">
          <b>{fmt(radar?.families)}</b>
          <span>Known drainer families</span>
          <small>matched by code, not by address</small>
        </div>
        <div className="lp-cell">
          <b>{fmt(radar?.alerts)}</b>
          <span>Watchtower alerts</span>
          <small>readonly · can't be deleted</small>
        </div>
        <div className="lp-live"><span className="dot" /> live from Arkiv, no PreSign server</div>
      </section>

      {/* ---------- problem ---------- */}
      <section id="problem" className="lp-section">
        <Reveal>
          <div className="lp-kicker">The problem</div>
          <h2>Wallets show addresses.<br /><span className="lp-fade">Attackers count on it.</span></h2>
        </Reveal>
        <div className="lp-frame lp-grid-3">
          <Reveal className="lp-cell lp-card">
            <div className="lp-num">01</div>
            <h3>You can't read what you sign</h3>
            <p>A contract address, an amount and a wall of hex. Most people click confirm and hope.</p>
            <code className="lp-hex">0x414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2…</code>
          </Reveal>
          <Reveal className="lp-cell lp-card">
            <div className="lp-num">02</div>
            <h3>One signature hands over your account</h3>
            <p>
              Since EIP-7702, a single authorization lets a contract act as your wallet. On Oct 29, a Binance hot wallet signed 50 of
              them in one transaction, to a sweeper no vendor lists.
            </p>
          </Reveal>
          <Reveal className="lp-cell lp-card">
            <div className="lp-num">03</div>
            <h3>Guest lists don't scale</h3>
            <p>
              "Trusted provider" lists cover a fraction of real delegations, can be lobbied onto, and say nothing when a listed
              contract changes later.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section id="how" className="lp-section">
        <Reveal>
          <div className="lp-kicker">How it works</div>
          <h2>Mirror. Watch. <span className="lp-fade">Check.</span></h2>
        </Reveal>
        <div className="lp-frame lp-grid-3">
          <Reveal className="lp-cell lp-card">
            <div className="lp-step">Mirror</div>
            <h3>Plain English, verified</h3>
            <p>
              The Ethereum Foundation's ERC-7730 clear-signing registry, mirrored to Arkiv with a fingerprint per file. Your browser
              re-computes it, so a tampered translation is caught.
            </p>
          </Reveal>
          <Reveal className="lp-cell lp-card">
            <div className="lp-step">Watch</div>
            <h3>Evidence about every delegate</h3>
            <p>
              The Watchtower reads every EIP-7702 delegation on-chain and publishes what each contract is: drainer code family,
              upgradeable logic, vendor listing, age, adoption.
            </p>
          </Reveal>
          <Reveal className="lp-cell lp-card">
            <div className="lp-step">Check</div>
            <h3>A verdict before the popup</h3>
            <p>
              Wallets, dApps, exchanges and AI agents call <code>check()</code> before signing: verified, caution or blocked, with
              the evidence behind it. The Signer Guard refuses to sign otherwise.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---------- radar ---------- */}
      <section id="radar" className="lp-section">
        <Reveal>
          <div className="lp-kicker">Delegation Radar</div>
          <h2>Evidence, <span className="lp-fade">not a guest list.</span></h2>
          <p className="lp-lead">There's no trust to buy. Every line is recomputable from the chain, and alerts can't be deleted.</p>
        </Reveal>
        <div className="lp-frame lp-split">
          <Reveal className="lp-cell">
            <ul className="lp-evidence">
              <li><span className="chip bad">Blocked</span> Same code as a known drainer, even at a brand-new address</li>
              <li><span className="chip bad">Blocked</span> Logic changed after it was first seen, even for a vendor's contract</li>
              <li><span className="chip bad">Blocked</span> 50 authorizations at once: nonce spraying</li>
              <li><span className="chip warn">Caution</span> Upgradeable: someone else can swap its logic</li>
              <li><span className="chip warn">Caution</span> Unknown, or first seen hours ago</li>
              <li><span className="chip good">Verified</span> Vendor-listed, code unchanged, clean evidence</li>
            </ul>
          </Reveal>
          <Reveal className="lp-cell lp-finding">
            <div className="lp-step">Found live on Ethereum mainnet</div>
            <div className="lp-finding-addr mono">{DRAINER.slice(0, 10)}…{DRAINER.slice(-4)}</div>
            <p>
              In one hour of mainnet traffic, the Watchtower found a delegate whose bytecode is <b>byte-for-byte</b> the published
              CrimeEnjoyor v1 drainer, at an address that isn't on any published list. A guest list would have missed it.
            </p>
            <div className="chips">
              <a className="chip" href={`https://etherscan.io/address/${DRAINER}`} target="_blank" rel="noreferrer">Etherscan <External /></a>
              <a className="chip" href="#/app/radar">See the alert in the app</a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- why arkiv ---------- */}
      <section id="arkiv" className="lp-section">
        <Reveal>
          <div className="lp-kicker">Why Arkiv</div>
          <h2>A trust layer <span className="lp-fade">shouldn't need trust in us.</span></h2>
        </Reveal>
        <div className="lp-frame lp-grid-4">
          {[
            ["Readable by anyone", "Wallets query Arkiv directly. No PreSign API to go down, rate-limit or quietly change answers."],
            ["Provable author", "Every entity carries its creator. Readers pin to the publisher, so nobody can forge an entry."],
            ["Trust expires", "Entries live 7 days unless the keeper re-confirms them against the source. Stale trust disappears."],
            ["Permanent alerts", "Alerts are readonly: nobody can edit or delete \"this contract changed\" after the fact."],
          ].map(([t, d]) => (
            <Reveal key={t} className="lp-cell lp-card">
              <h3>{t}</h3>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- who ---------- */}
      <section className="lp-section">
        <Reveal>
          <div className="lp-kicker">Built for</div>
          <h2>Anything that <span className="lp-fade">signs.</span></h2>
        </Reveal>
        <div className="lp-frame lp-grid-4">
          {[
            ["Wallets", "Show the verdict and evidence before the confirm screen."],
            ["dApps", "Explain the transaction you're about to request, in plain English."],
            ["Exchanges & custody", "The Signer Guard refuses anything not verified. The money never moves."],
            ["AI agents", "Agents that sign need a deterministic check, not a guess."],
          ].map(([t, d]) => (
            <Reveal key={t} className="lp-cell lp-card">
              <h3>{t}</h3>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- final cta ---------- */}
      <section className="lp-final">
        <div className="lp-glow small" aria-hidden />
        <h2>Know what you sign.<br /><span className="lp-fade">Know who you trust.</span></h2>
        <div className="lp-cta center">
          <button className="btn btn-light btn-lg" onClick={onLaunch}>Launch app <span aria-hidden>→</span></button>
          <a className="btn btn-ghost btn-lg" href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">Data on Arkiv <External /></a>
        </div>
      </section>

      <footer className="lp-footer">
        <span>PreSign · built at ETHGlobal Mumbai 2026 on Arkiv</span>
        <span>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub <External /></a>
          {" · "}
          <a href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">Publisher on Arkiv <External /></a>
        </span>
      </footer>
    </div>
  );
}
