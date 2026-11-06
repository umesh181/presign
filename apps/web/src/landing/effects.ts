/** Small motion helpers for the landing page (no React state: they work on elements directly). */
import { gsap } from "gsap";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = () => window.matchMedia("(pointer: fine)").matches;

const SCRAMBLE = "0123456789abcdefx#%&*+=/<>";
const rand = () => SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]!;

/**
 * Decode `from` into `to` at progress p (0..1), left to right, with a band of scrambling
 * glyphs at the frontier. Used scroll-scrubbed (hex -> plain English) and for one-shot reveals.
 */
export function decodeFrame(from: string, to: string, p: number, band = 14): string {
  const n = Math.max(from.length, to.length);
  const head = p * (n + band);
  let out = "";
  for (let i = 0; i < n; i++) {
    if (i < head - band) out += to[i] ?? " ";
    else if (i < head) out += to[i] === " " ? " " : rand();
    else out += from[i] ?? " ";
  }
  return out;
}

/** One-shot scramble-in of an element's text. */
export function scrambleIn(el: HTMLElement, duration = 1.1) {
  const text = el.dataset.text ?? el.textContent ?? "";
  el.dataset.text = text;
  if (reducedMotion()) return void (el.textContent = text);
  const noise = text.replace(/\S/g, () => rand());
  const o = { p: 0 };
  gsap.to(o, { p: 1, duration, ease: "power2.out", onUpdate: () => void (el.textContent = decodeFrame(noise, text, o.p, 6)) });
}

/** Wrap each character in spans (words kept together) so they can be animated. */
export function splitChars(el: HTMLElement): HTMLElement[] {
  // Own marker: React renders a bare data-split attribute as "true".
  if (el.dataset.splitDone) return [...el.querySelectorAll<HTMLElement>(".ch")];
  el.dataset.splitDone = "1";
  const chars: HTMLElement[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment();
      for (const word of (node.textContent ?? "").split(/(\s+)/)) {
        if (!word) continue;
        if (/^\s+$/.test(word)) {
          frag.append(document.createTextNode(word));
          continue;
        }
        const w = document.createElement("span");
        w.className = "word";
        for (const c of word) {
          const s = document.createElement("span");
          s.className = "ch";
          s.textContent = c;
          w.append(s);
          chars.push(s);
        }
        frag.append(w);
      }
      node.parentNode?.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName !== "BR") {
      [...node.childNodes].forEach(walk);
    }
  };
  [...el.childNodes].forEach(walk);
  // Gradient phrases (<em>): colour each letter along the gradient, so it survives the split.
  el.querySelectorAll("em").forEach((em) => {
    const cs = [...em.querySelectorAll<HTMLElement>(".ch")];
    cs.forEach((c, i) => c.style.setProperty("--t", String(cs.length > 1 ? i / (cs.length - 1) : 0)));
  });
  return chars;
}

/** Buttons that lean toward the cursor. */
export function magnetic(el: HTMLElement, strength = 0.35) {
  if (!finePointer() || reducedMotion()) return () => {};
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * strength, y: (e.clientY - r.top - r.height / 2) * strength, duration: 0.4, ease: "power3.out" });
  };
  const leave = () => gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.4)" });
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerleave", leave);
  return () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerleave", leave);
  };
}

/** Cursor-following spotlight on cards (sets --mx/--my used by CSS). */
export function spotlight(root: HTMLElement) {
  const move = (e: PointerEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-spot]");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  root.addEventListener("pointermove", move);
  return () => root.removeEventListener("pointermove", move);
}

/** Custom cursor: a dot plus a lagging ring that grows over interactive elements. */
export function cursor() {
  if (!finePointer() || reducedMotion()) return () => {};
  const dot = document.createElement("div");
  const ring = document.createElement("div");
  dot.className = "cur-dot";
  ring.className = "cur-ring";
  document.body.append(dot, ring);
  document.documentElement.classList.add("has-cursor");
  const dx = gsap.quickTo(dot, "x", { duration: 0.08 });
  const dy = gsap.quickTo(dot, "y", { duration: 0.08 });
  const rx = gsap.quickTo(ring, "x", { duration: 0.45, ease: "power3.out" });
  const ry = gsap.quickTo(ring, "y", { duration: 0.45, ease: "power3.out" });
  const move = (e: PointerEvent) => {
    document.documentElement.classList.add("cur-on");
    dx(e.clientX);
    dy(e.clientY);
    rx(e.clientX);
    ry(e.clientY);
    ring.classList.toggle("hover", !!(e.target as HTMLElement).closest("a, button, [data-spot]"));
  };
  window.addEventListener("pointermove", move);
  return () => {
    window.removeEventListener("pointermove", move);
    dot.remove();
    ring.remove();
    document.documentElement.classList.remove("has-cursor", "cur-on");
  };
}

/** Count a number up from 0 when called. */
export function countUp(el: HTMLElement, to: number, duration = 1.6) {
  if (reducedMotion()) return void (el.textContent = to.toLocaleString("en-US"));
  const o = { v: 0 };
  gsap.to(o, { v: to, duration, ease: "power3.out", onUpdate: () => void (el.textContent = Math.round(o.v).toLocaleString("en-US")) });
}
