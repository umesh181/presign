/**
 * Landing page. Motion: Lenis smooth scroll + GSAP ScrollTrigger, a WebGL glass-shield lh,
 * and a pinned section where scrolling decodes a real transaction's hex into plain English.
 * Every number is read live from Arkiv; every verdict shown is one PreSign actually produced.
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect, useRef, useState } from "react";
import { ARKIV_EXPLORER, liveStats, PUBLISHER, type Stats } from "../lib/arkiv.ts";
import { listProfiles, radarStats, type ProfileRow, type RadarStats } from "../lib/radar.ts";
import { Check, Cross, External, Shield, Stop, Warn } from "../components/icons.tsx";
import { countUp, cursor, decodeFrame, magnetic, reducedMotion, scrambleIn, splitChars, spotlight } from "./effects.ts";
import "./landing.css";

gsap.registerPlugin(ScrollTrigger);

const GITHUB = "https://github.com/umesh181/presign";
const DRAINER = "0x84D05511614272694D3a9cebE896514DBDE51F40";

/** Real calldata of the Uniswap V3 mainnet swap in our demo, and what PreSign decoded it to. */
const HEX =
  "0x414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000054ce4b27caabba24926865f035d432dbde2901f70000000000000000000000000000000000000000000000000000000000000064000000000000000000000000d59dde3ca6d315";
const PLAIN =
  "Swap 0.551044464601797306 WETH for at least 0 DACITY on the Uniswap V3 Router. Pool fee 0.01%. Deadline 2026-10-22 09:37 UTC. Recipient 0xd59d…64ba.";

const VERDICTS = [
  { s: "trusted", label: "VERIFIED", kind: "Transaction", title: "Swap 0.55 WETH for at least 0 DACITY", lines: [["ok", "Translation found on Arkiv (Uniswap Labs)"], ["ok", "Fingerprint re-computed in your browser"], ["ok", "Decoded with the protocol's own ERC-7730 rules"]] },
  { s: "unknown", label: "CAUTION", kind: "EIP-7702 delegation", title: "Unknown contract: no wallet vendor vouches for it", lines: [["ok", "Code doesn't match any known drainer family"], ["warn", "Upgradeable: its owner can swap the logic"], ["warn", "First seen by the Watchtower 1 min ago"]] },
  { s: "blocked", label: "BLOCKED", kind: "EIP-7702 delegation", title: "Same code as a known wallet drainer", lines: [["fail", "Code family: CrimeEnjoyor v1 (published research)"], ["fail", "Watchtower alert on Arkiv: can't be deleted"], ["warn", "Not listed by any wallet vendor"]] },
] as const;

function VerdictCycle() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % VERDICTS.length), 3400);
    return () => clearInterval(t);
  }, []);
  const v = VERDICTS[i]!;
  return (
    <div className={`vc ${v.s}`} key={i}>
      <div className="vc-head"><span>PreSign · {v.kind}</span><span className="mono">before you sign</span></div>
      <div className="vc-status">
        <span className="vc-icon">{v.s === "trusted" ? <Shield size={22} /> : v.s === "unknown" ? <Warn /> : <Stop />}</span>
        <div><div className="vc-label">{v.label}</div><div className="vc-title">{v.title}</div></div>
      </div>
      <div className="vc-lines">
        {v.lines.map(([s, t]) => (
          <div key={t} className={`check ${s}`}><span className="ic">{s === "ok" ? <Check /> : s === "fail" ? <Cross /> : <Warn />}</span>{t}</div>
        ))}
      </div>
      <div className="vc-dots">{VERDICTS.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
    </div>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A number that counts up the first time it is on screen (after the live value has loaded). */
function Count({ to }: { to?: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || to === undefined) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        countUp(el, to);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <b ref={ref}>{to === undefined ? "…" : "0"}</b>;
}

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [radar, setRadar] = useState<RadarStats | null>(null);
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loaded, setLoaded] = useState(reducedMotion());

  useEffect(() => {
    liveStats().then(setStats).catch(() => {});
    radarStats().then(setRadar).catch(() => {});
    listProfiles(1).then((r) => setRows(r.slice(0, 24))).catch(() => {});
  }, []);

  // WebGL hero (three.js is loaded on demand, so the app route never downloads it).
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import("./HeroScene.ts")
      .then(({ mountHero }) => {
        if (!cancelled) dispose = mountHero(el, { reducedMotion: reducedMotion() });
      })
      .catch((e) => {
        console.warn("Hero 3D disabled:", e);
        el.style.display = "none"; // no WebGL: the page still works
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // Intro loader: decode "PRESIGN" from hex, then reveal the page.
  useEffect(() => {
    if (loaded) return;
    const el = root.current?.querySelector<HTMLElement>(".loader-word");
    const o = { p: 0 };
    const tl = gsap.timeline({ onComplete: () => setLoaded(true) });
    tl.to(o, { p: 1, duration: 1.1, ease: "power2.inOut", onUpdate: () => el && (el.textContent = decodeFrame("0x5072655369676e", "PRESIGN", o.p, 4)) });
    tl.to(".loader-bar i", { scaleX: 1, duration: 1.1, ease: "power2.inOut" }, 0);
    tl.to(".loader", { yPercent: -100, duration: 0.8, ease: "expo.inOut" }, "+=0.15");
    return () => void tl.kill();
  }, [loaded]);

  // Scroll + motion system.
  useEffect(() => {
    if (!loaded || !root.current) return;
    const rm = reducedMotion();
    const cleanups: (() => void)[] = [];
    const lenis = rm ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 1 });
    if (lenis) {
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      cleanups.push(() => gsap.ticker.remove(tick), () => lenis.destroy());
    }
    cleanups.push(cursor(), spotlight(root.current));
    root.current.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => cleanups.push(magnetic(el)));

    const ctx = gsap.context(() => {
      if (rm) return;
      // Hero intro.
      const heroChars = splitChars(root.current!.querySelector<HTMLElement>(".lh-title")!);
      gsap.from(heroChars, { yPercent: 115, rotate: 6, duration: 1.1, ease: "expo.out", stagger: 0.025 });
      gsap.from(".lh-fade", { opacity: 0, y: 24, duration: 1, ease: "power3.out", stagger: 0.1, delay: 0.5 });
      gsap.from(".lh-canvas", { opacity: 0, scale: 1.08, duration: 1.8, ease: "power2.out" });
      // Hero parallax out.
      gsap.to(".lh-canvas", { yPercent: 18, opacity: 0.25, ease: "none", scrollTrigger: { trigger: ".lh", start: "top top", end: "bottom top", scrub: true } });
      gsap.to(".lh-content", { yPercent: -12, opacity: 0, ease: "none", scrollTrigger: { trigger: ".lh", start: "40% top", end: "bottom top", scrub: true } });

      // Section headings: chars rise in.
      gsap.utils.toArray<HTMLElement>("[data-split]").forEach((h) => {
        gsap.from(splitChars(h), { yPercent: 110, duration: 1, ease: "expo.out", stagger: 0.018, scrollTrigger: { trigger: h, start: "top 85%" } });
      });
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.from(el, { opacity: 0, y: 40, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } });
      });
      gsap.utils.toArray<HTMLElement>("[data-scramble]").forEach((el) => {
        ScrollTrigger.create({ trigger: el, start: "top 85%", once: true, onEnter: () => scrambleIn(el) });
      });

      // Pinned decode: scrolling turns the hex into plain English.
      const out = root.current!.querySelector<HTMLElement>(".decode-text")!;
      const bar = root.current!.querySelector<HTMLElement>(".decode-progress i")!;
      const pill = root.current!.querySelector<HTMLElement>(".decode-pill")!;
      ScrollTrigger.create({
        trigger: ".decode",
        start: "top top",
        end: "+=1800",
        pin: true,
        scrub: 0.6,
        onUpdate: (self) => {
          const p = gsap.utils.clamp(0, 1, (self.progress - 0.08) / 0.8);
          out.textContent = decodeFrame(HEX, PLAIN, p, 18);
          out.classList.toggle("plain", p > 0.98);
          bar.style.transform = `scaleX(${self.progress})`;
          pill.classList.toggle("on", p > 0.98);
        },
      });

      // Horizontal pinned panels (desktop only).
      const mm = gsap.matchMedia();
      mm.add("(min-width: 900px)", () => {
        const track = root.current!.querySelector<HTMLElement>(".hz-track")!;
        const dist = () => track.scrollWidth - window.innerWidth;
        gsap.to(track, { x: () => -dist(), ease: "none", scrollTrigger: { trigger: ".hz", start: "top top", end: () => `+=${dist()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true } });
      });

      // Evidence rows stagger in; the finding card glitches its address in.
      gsap.from(".ev-row", { opacity: 0, x: -30, duration: 0.8, ease: "power3.out", stagger: 0.08, scrollTrigger: { trigger: ".ev-list", start: "top 80%" } });
    }, root);
    cleanups.push(() => ctx.revert());

    requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cleanups.reverse().forEach((f) => f());
  }, [loaded]);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const marquee = rows.length
    ? rows.map((r) => ({
        addr: short(r.address),
        tag: r.knownBad !== "none" ? `KNOWN DRAINER · ${r.knownBad}` : r.vendor !== "none" ? r.vendor : r.upgradeable ? "UPGRADEABLE" : "no vendor",
        tone: r.knownBad !== "none" ? "bad" : r.vendor !== "none" ? "good" : r.upgradeable ? "warn" : "",
        acc: r.accounts,
      }))
    : [];

  return (
    <div className="L" ref={root}>
      <div className="grain" aria-hidden />
      {!loaded && (
        <div className="loader">
          <div className="loader-word mono">0x5072655369676e</div>
          <div className="loader-bar"><i /></div>
          <div className="loader-meta mono">decoding · live on Arkiv</div>
        </div>
      )}

      <header className="L-nav">
        <a className="L-brand" href="#/" onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: "smooth" }))}>
          <span className="brand-mark"><Shield size={16} /></span>PreSign
        </a>
        <nav className="L-links">
          <button onClick={() => go("decode")}>Decode</button>
          <button onClick={() => go("how")}>How</button>
          <button onClick={() => go("radar")}>Radar</button>
          <button onClick={() => go("arkiv")}>Arkiv</button>
        </nav>
        <button className="L-btn light" data-magnetic onClick={onLaunch}>Launch app <span>↗</span></button>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="lh">
        <canvas className="lh-canvas" ref={canvas} />
        <div className="lh-content">
          <div className="lh-top lh-fade mono"><span>[ 001 ]</span><span>The checkpoint before every signature</span><span className="live"><i className="dot" /> live on Arkiv</span></div>
          <h1 className="lh-title">Know what<br /><em>you sign.</em></h1>
          <div className="lh-bottom">
            <p className="lh-fade">
              PreSign turns raw transactions into plain English and judges every EIP-7702 delegate from on-chain evidence, before your wallet pops up. All of it public on Arkiv.
            </p>
            <div className="lh-cta lh-fade">
              <button className="L-btn light lg" data-magnetic onClick={onLaunch}>Launch app <span>↗</span></button>
              <a className="L-btn ghost lg" data-magnetic href={GITHUB} target="_blank" rel="noreferrer">Source <External /></a>
            </div>
          </div>
          <button className="scroll-hint lh-fade mono" onClick={() => go("decode")}>scroll to decode <span>↓</span></button>
        </div>
      </section>

      {/* ---------- MARQUEE: live delegates ---------- */}
      <section className="mq" aria-label="Delegates the Watchtower sees on Ethereum">
        {[0, 1].map((row) => (
          <div key={row} className={`mq-row ${row ? "rev" : ""}`}>
            <div className="mq-track">
              {(marquee.length ? [...marquee, ...marquee] : Array.from({ length: 16 }, () => ({ addr: "0x……", tag: "loading from Arkiv", tone: "", acc: 0 }))).map((m, i) => (
                <span key={i} className={`mq-item ${m.tone}`}>
                  <b className="mono">{m.addr}</b>
                  <em>{m.tag}</em>
                  {m.acc > 0 && <small>{m.acc} accounts</small>}
                  <i>✦</i>
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ---------- DECODE (pinned) ---------- */}
      <section id="decode" className="decode">
        <div className="decode-inner">
          <div className="decode-head">
            <div className="kicker mono">[ 002 ] what your wallet shows → what PreSign shows</div>
            <h2 data-split>Hex in. <em>Meaning out.</em></h2>
          </div>
          <div className="decode-box">
            <div className="decode-bar mono"><span>calldata · Uniswap V3 Router · Ethereum mainnet</span><span>0x6e3e…154a</span></div>
            <p className="decode-text mono">{HEX}</p>
            <div className="decode-foot">
              <div className="decode-progress"><i /></div>
              <span className="decode-pill"><Check size={13} /> VERIFIED · translation on Arkiv · fingerprint matches</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- PROBLEM ---------- */}
      <section className="problem">
        <div className="kicker mono">[ 003 ] the problem</div>
        <h2 data-split>One signature can hand over <em>your whole account.</em></h2>
        <div className="problem-grid">
          <div className="big-stat" data-reveal>
            <b>50</b>
            <span>EIP-7702 authorizations a Binance hot wallet signed in one transaction on Oct 29, to a sweeper contract no vendor lists.</span>
          </div>
          <div className="big-stat" data-reveal>
            <b>1</b>
            <span>signature is all EIP-7702 needs to let a contract act as your wallet, until you revoke it.</span>
          </div>
          <div className="big-stat" data-reveal>
            <b>9/10</b>
            <span>EIP-7702 delegations in our one-hour mainnet sample went to contracts no wallet vendor lists. A guest list can't judge them.</span>
          </div>
        </div>
      </section>

      {/* ---------- HOW (horizontal pinned) ---------- */}
      <section id="how" className="hz">
        <div className="hz-track">
          <div className="hz-intro">
            <div className="kicker mono">[ 004 ] how it works</div>
            <h2 data-split>Mirror.<br />Watch.<br /><em>Check.</em></h2>
          </div>
          {[
            ["01", "Mirror", "Plain English, verified", "The Ethereum Foundation's ERC-7730 clear-signing registry, mirrored to Arkiv with a fingerprint per file. Your browser re-computes it, so a tampered translation is caught.", "1,917 contracts · 143 chains"],
            ["02", "Watch", "Evidence about every delegate", "The Watchtower reads every EIP-7702 delegation on-chain and publishes what each contract is: drainer code family, upgradeable logic, vendor listing, age, adoption.", "readonly alerts · 7-day expiry"],
            ["03", "Check", "A verdict before the popup", "Wallets, dApps, exchanges and AI agents call check() before signing: verified, caution or blocked, with the evidence behind it. The Signer Guard refuses to sign otherwise.", "no PreSign server in between"],
          ].map(([num, step, title, text, meta]) => (
            <article key={num} className="hz-panel" data-spot>
              <div className="hz-num">{num}</div>
              <div className="kicker mono">{step}</div>
              <h3>{title}</h3>
              <p>{text}</p>
              <div className="hz-meta mono">{meta}</div>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- RADAR ---------- */}
      <section id="radar" className="radar">
        <div className="radar-grid">
          <div>
            <div className="kicker mono">[ 005 ] delegation radar</div>
            <h2 data-split>Evidence, <em>not a guest list.</em></h2>
            <p className="lead" data-reveal>There's no trust to buy. Every line is recomputable from the chain, and alerts on Arkiv can't be deleted.</p>
            <ul className="ev-list">
              {[
                ["bad", "Blocked", "Same code as a known drainer, even at a brand-new address"],
                ["bad", "Blocked", "Logic changed after it was first seen, even for a vendor's contract"],
                ["bad", "Blocked", "50 authorizations at once: nonce spraying"],
                ["warn", "Caution", "Upgradeable: someone else can swap its logic"],
                ["warn", "Caution", "Unknown, or first seen hours ago"],
                ["good", "Verified", "Vendor-listed, code unchanged, clean evidence"],
              ].map(([tone, label, text]) => (
                <li key={text} className="ev-row"><span className={`chip ${tone}`}>{label}</span>{text}</li>
              ))}
            </ul>
          </div>
          <div className="radar-side" data-reveal>
            <VerdictCycle />
          </div>
        </div>

        <div className="finding" data-spot data-reveal>
          <div className="finding-pulse" aria-hidden />
          <div className="kicker mono red">found live on ethereum mainnet</div>
          <div className="finding-addr mono" data-scramble>{DRAINER}</div>
          <p>
            In one hour of mainnet traffic, the Watchtower found a delegate whose bytecode is <b>byte-for-byte</b> the published CrimeEnjoyor v1
            drainer, at an address that isn't on any published list. A guest list would have missed it.
          </p>
          <div className="chips">
            <a className="chip" href={`https://etherscan.io/address/${DRAINER}`} target="_blank" rel="noreferrer">Etherscan <External /></a>
            <a className="chip" href="#/app/radar">See the alert in the app ↗</a>
          </div>
        </div>
      </section>

      {/* ---------- NUMBERS ---------- */}
      <section className="nums">
        <div className="kicker mono">[ 006 ] live from arkiv · no presign server</div>
        <div className="nums-grid">
          {[
            [stats?.descriptors, "clear-signing translations", `EF registry · ${stats?.attested ?? "…"} audited by Cyfrin`],
            [radar?.profiles, "EIP-7702 delegates watched", "evidence read from 7 chains"],
            [radar?.families, "known drainer families", "matched by code, not by address"],
            [radar?.alerts, "Watchtower alerts", "readonly · can't be deleted"],
          ].map(([v, label, sub]) => (
            <div key={String(label)} className="num" data-spot>
              <Count to={v as number | undefined} />
              <span>{label}</span>
              <small>{sub}</small>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- WHY ARKIV ---------- */}
      <section id="arkiv" className="why">
        <div className="kicker mono">[ 007 ] why arkiv</div>
        <h2 data-split>A trust layer shouldn't need <em>trust in us.</em></h2>
        <div className="why-grid">
          {[
            ["Readable by anyone", "Wallets query Arkiv directly. No PreSign API to go down, rate-limit or quietly change answers."],
            ["Provable author", "Every entity carries its creator. Readers pin to the publisher, so nobody can forge an entry."],
            ["Trust expires", "Entries live 7 days unless the keeper re-confirms them against the source. Stale trust disappears."],
            ["Permanent alerts", "Alerts are readonly: nobody can edit or delete \"this contract changed\" after the fact."],
          ].map(([t, d], i) => (
            <div key={t} className="why-card" data-spot data-reveal>
              <span className="mono">0{i + 1}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- BUILT FOR ---------- */}
      <section className="for">
        <div className="kicker mono">[ 008 ] built for anything that signs</div>
        {[
          ["Wallets", "the verdict and evidence before the confirm screen"],
          ["dApps", "explain the request in plain English"],
          ["Exchanges", "the Signer Guard refuses anything unverified"],
          ["AI agents", "a deterministic check, not a guess"],
        ].map(([t, d]) => (
          <a key={t} className="for-row" href="#/app" data-reveal>
            <span className="for-t">{t}</span>
            <span className="for-d">{d}</span>
            <span className="for-a">↗</span>
          </a>
        ))}
      </section>

      {/* ---------- FINAL ---------- */}
      <section className="final">
        <h2 data-split>Know who<br /><em>you trust.</em></h2>
        <div className="lh-cta center">
          <button className="L-btn light lg" data-magnetic onClick={onLaunch}>Launch app <span>↗</span></button>
          <a className="L-btn ghost lg" data-magnetic href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">Data on Arkiv <External /></a>
        </div>
      </section>

      <footer className="L-foot">
        <div className="L-wordmark" aria-hidden>PRESIGN</div>
        <div className="L-foot-row">
          <span>Built at ETHGlobal Mumbai 2026 on Arkiv</span>
          <span>
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a> · <a href={`${ARKIV_EXPLORER}/address/${PUBLISHER}`} target="_blank" rel="noreferrer">Publisher on Arkiv</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
