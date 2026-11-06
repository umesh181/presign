/**
 * Landing page: minimal and calm. Smooth scroll (Lenis), soft fade-ups, count-ups, and one
 * "hex -> plain English" moment. Numbers are read live from Arkiv; verdicts are real PreSign output.
 */
import Lenis from "lenis";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ARKIV_EXPLORER, liveStats, PUBLISHER, type Stats } from "../lib/arkiv.ts";
import { radarStats, type RadarStats } from "../lib/radar.ts";
import { Check, Cross, External, Shield, Stop, Warn } from "../components/icons.tsx";
import { decodeFrame, onceVisible, reducedMotion, tween } from "./effects.ts";
import "./landing.css";

const GITHUB = "https://github.com/umesh181/presign";
const DRAINER = "0x84D05511614272694D3a9cebE896514DBDE51F40";

/** Real calldata of the Uniswap V3 mainnet swap in our demo, and what PreSign decoded it to. */
const HEX =
  "0x414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000054ce4b27caabba24926865f035d432dbde2901f70000000000000000000000000000000000000000000000000000000000000064";
const PLAIN = "Swap 0.551 WETH for at least 0 DACITY on Uniswap V3. Pool fee 0.01%. Deadline Oct 22, 09:37 UTC.";

const VERDICTS = [
  { s: "trusted", label: "Verified", kind: "Transaction", title: "Swap 0.55 WETH for at least 0 DACITY", lines: [["ok", "Translation found on Arkiv (Uniswap Labs)"], ["ok", "Fingerprint re-computed in your browser"], ["ok", "Decoded with the protocol's own ERC-7730 rules"]] },
  { s: "unknown", label: "Caution", kind: "EIP-7702 delegation", title: "Unknown contract: no wallet vendor vouches for it", lines: [["ok", "Code doesn't match any known drainer family"], ["warn", "Upgradeable: its owner can swap the logic"], ["warn", "First seen by the Watchtower 1 min ago"]] },
  { s: "blocked", label: "Blocked", kind: "EIP-7702 delegation", title: "Same code as a known wallet drainer", lines: [["fail", "Code family: CrimeEnjoyor v1 (published research)"], ["fail", "Watchtower alert on Arkiv"], ["warn", "Not listed by any wallet vendor"]] },
] as const;

/** Fade up once, the first time it scrolls into view. */
function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => (ref.current ? onceVisible(ref.current, () => setOn(true), 0.15) : undefined), []);
  return (
    <div ref={ref} className={`rv ${on ? "on" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Count({ to }: { to?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || to === undefined) return;
    let stop = () => {};
    const off = onceVisible(el, () => (stop = tween(1400, (t) => void (el.textContent = Math.round(to * t).toLocaleString("en-US")))));
    return () => (off(), stop());
  }, [to]);
  return <span ref={ref}>{to === undefined ? "–" : "0"}</span>;
}

function VerdictCard() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setI((x) => (x + 1) % VERDICTS.length), 4200);
    return () => clearInterval(t);
  }, []);
  const v = VERDICTS[i]!;
  return (
    <div className={`m-verdict ${v.s}`}>
      <div className="m-verdict-head">
        <span>PreSign · {v.kind}</span>
        <span className="m-tabs">{VERDICTS.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</span>
      </div>
      <div className="m-verdict-body" key={i}>
        <div className="m-verdict-status">
          <span className="m-verdict-icon">{v.s === "trusted" ? <Shield size={18} /> : v.s === "unknown" ? <Warn /> : <Stop />}</span>
          <div>
            <div className="m-verdict-label">{v.label}</div>
            <div className="m-verdict-title">{v.title}</div>
          </div>
        </div>
        <div className="m-verdict-lines">
          {v.lines.map(([s, t]) => (
            <div key={t} className={`check ${s}`}><span className="ic">{s === "ok" ? <Check /> : s === "fail" ? <Cross /> : <Warn />}</span>{t}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Hex dissolves into the plain-English verdict, once, when it scrolls into view. */
function Decode() {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(HEX);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    let stop = () => {};
    const off = onceVisible(box.current, () => {
      stop = tween(2600, (t) => {
        setText(decodeFrame(HEX, PLAIN, t));
        if (t >= 1) setDone(true);
      });
    }, 0.6);
    return () => (off(), stop());
  }, []);
  return (
    <div className="m-decode" ref={box}>
      <div className="m-decode-head"><span>Uniswap V3 Router · Ethereum mainnet</span><span>tx 0x6e3e…154a</span></div>
      <p className={`m-decode-text ${done ? "plain" : ""}`}>{text}</p>
      <div className={`m-decode-foot ${done ? "on" : ""}`}>
        <Check size={14} /> Verified · translation on Arkiv · fingerprint matches
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

  // Smooth scrolling.
  useEffect(() => {
    if (reducedMotion()) return;
    const lenis = new Lenis({ lerp: 0.1 });
    let raf = requestAnimationFrame(function loop(t) {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="M">
      <header className="m-nav">
        <div className="m-wrap m-nav-in">
          <a className="m-brand" href="#/" onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: "smooth" }))}>
            <span className="m-mark"><Shield size={14} /></span>PreSign
          </a>
          <nav className="m-links">
            <button onClick={() => go("how")}>How it works</button>
            <button onClick={() => go("radar")}>Radar</button>
            <button onClick={() => go("arkiv")}>Why Arkiv</button>
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <button className="m-btn primary sm" onClick={onLaunch}>Launch app</button>
        </div>
      </header>

      {/* hero */}
      <section className="m-hero">
        <div className="m-wrap">
          <Reveal>
            <a className="m-pill" href="#/app/radar">
              <span className="dot" /> Live on Arkiv{radar ? ` · ${radar.profiles} delegates watched` : ""} <span className="m-arrow">→</span>
            </a>
          </Reveal>
          <Reveal delay={80}><h1>The checkpoint before<br />every signature.</h1></Reveal>
          <Reveal delay={160}>
            <p className="m-sub">
              PreSign shows what a transaction really does in plain English, and judges every EIP-7702 delegate from on-chain evidence. Before your wallet pops up.
            </p>
          </Reveal>
          <Reveal delay={240} className="m-cta">
            <button className="m-btn primary" onClick={onLaunch}>Launch app <span className="m-arrow">→</span></button>
            <a className="m-btn" href={GITHUB} target="_blank" rel="noreferrer">View source</a>
          </Reveal>
          <Reveal delay={320} className="m-hero-card"><VerdictCard /></Reveal>
        </div>
      </section>

      {/* numbers */}
      <section className="m-wrap m-stats">
        {[
          [stats?.descriptors, "Clear-signing translations", "from the EF registry"],
          [radar?.profiles, "EIP-7702 delegates watched", "across 7 chains"],
          [radar?.families, "Known drainer families", "matched by code"],
          [radar?.alerts, "Watchtower alerts", "readonly on Arkiv"],
        ].map(([v, label, sub], i) => (
          <Reveal key={String(label)} delay={i * 60} className="m-stat">
            <b><Count to={v as number | undefined} /></b>
            <span>{label}</span>
            <small>{sub}</small>
          </Reveal>
        ))}
      </section>

      {/* decode */}
      <section className="m-section m-wrap m-split">
        <Reveal>
          <div className="m-eyebrow">Clear signing</div>
          <h2>Hex in.<br />Meaning out.</h2>
          <p className="m-body">
            Your wallet shows a contract address and a wall of hex. PreSign reads the protocol's own ERC-7730 translation from Arkiv, checks its
            fingerprint in your browser, and tells you what you're about to do.
          </p>
        </Reveal>
        <Reveal delay={120}><Decode /></Reveal>
      </section>

      {/* how */}
      <section id="how" className="m-section m-wrap">
        <Reveal>
          <div className="m-eyebrow">How it works</div>
          <h2>Mirror. Watch. Check.</h2>
        </Reveal>
        <div className="m-grid3">
          {[
            ["01", "Mirror", "The Ethereum Foundation's clear-signing registry, mirrored to Arkiv with a fingerprint per file. A tampered translation is caught."],
            ["02", "Watch", "The Watchtower reads every EIP-7702 delegation on-chain and publishes evidence about each contract: drainer code, upgradeable logic, age, adoption."],
            ["03", "Check", "Wallets, dApps, exchanges and agents call check() before signing and get verified, caution or blocked, with the evidence behind it."],
          ].map(([n, t, d], i) => (
            <Reveal key={n} delay={i * 80} className="m-card">
              <span className="m-num">{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* radar */}
      <section id="radar" className="m-section m-wrap">
        <Reveal>
          <div className="m-eyebrow">Delegation Radar</div>
          <h2>Evidence, not a guest list.</h2>
          <p className="m-body narrow">
            One EIP-7702 signature can hand a contract your whole account. Lists of "trusted providers" can be lobbied onto and say nothing when a
            contract changes. PreSign judges what the contract is, from evidence anyone can recompute.
          </p>
        </Reveal>
        <div className="m-evidence">
          {[
            ["bad", "Blocked", "Same code as a known drainer, even at a brand-new address"],
            ["bad", "Blocked", "Logic changed after it was first seen, even for a vendor's contract"],
            ["bad", "Blocked", "Many authorizations at once (nonce spraying)"],
            ["warn", "Caution", "Upgradeable: someone else can swap its logic"],
            ["warn", "Caution", "Unknown, or first seen hours ago"],
            ["good", "Verified", "Vendor-listed, code unchanged, clean evidence"],
          ].map(([tone, label, text], i) => (
            <Reveal key={text} delay={i * 50} className="m-ev">
              <span className={`m-tag ${tone}`}>{label}</span>
              <span>{text}</span>
            </Reveal>
          ))}
        </div>
        <Reveal className="m-finding">
          <div>
            <div className="m-eyebrow red">Found live on Ethereum mainnet</div>
            <p>
              In one hour of mainnet traffic, the Watchtower found a delegate whose bytecode is byte-for-byte the published CrimeEnjoyor v1 drainer,
              at an address that isn't on any published list.
            </p>
          </div>
          <div className="m-finding-side">
            <code>{DRAINER.slice(0, 10)}…{DRAINER.slice(-4)}</code>
            <a href={`https://etherscan.io/address/${DRAINER}`} target="_blank" rel="noreferrer">Etherscan <External /></a>
          </div>
        </Reveal>
      </section>

      {/* why arkiv */}
      <section id="arkiv" className="m-section m-wrap">
        <Reveal>
          <div className="m-eyebrow">Why Arkiv</div>
          <h2>A trust layer shouldn't need trust in us.</h2>
        </Reveal>
        <div className="m-grid2">
          {[
            ["Readable by anyone", "Wallets query Arkiv directly. No PreSign API to go down or quietly change answers."],
            ["Provable author", "Every entity carries its creator. Readers pin to the publisher, so entries can't be forged."],
            ["Trust expires", "Entries live 7 days unless re-confirmed against the source. Stale trust disappears."],
            ["Permanent alerts", "Alerts are readonly: nobody can delete \"this contract changed\" after the fact."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 60} className="m-why">
              <h3>{t}</h3>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* cta */}
      <section className="m-section m-wrap m-final">
        <Reveal>
          <h2>Know what you sign.<br /><span className="m-muted">Know who you trust.</span></h2>
          <div className="m-cta center">
            <button className="m-btn primary" onClick={onLaunch}>Launch app <span className="m-arrow">→</span></button>
            <a className="m-btn" href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">Data on Arkiv</a>
          </div>
        </Reveal>
      </section>

      <footer className="m-wrap m-foot">
        <span>PreSign · ETHGlobal Mumbai 2026 · built on Arkiv</span>
        <span>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">Publisher on Arkiv</a>
        </span>
      </footer>
    </div>
  );
}
