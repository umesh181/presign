/** Minimal motion helpers for the landing page (no animation library). */

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const GLYPHS = "0123456789abcdef";

/** Decode `from` into `to` at progress p (0..1), left to right, with a short band of hex glyphs at the edge. */
export function decodeFrame(from: string, to: string, p: number, band = 6): string {
  const n = Math.max(from.length, to.length);
  const head = p * (n + band);
  let out = "";
  for (let i = 0; i < n; i++) {
    if (i < head - band) out += to[i] ?? "";
    else if (i < head) out += to[i] === " " ? " " : GLYPHS[(i * 7 + Math.floor(head)) % 16];
    else out += from[i] ?? "";
  }
  return out.trimEnd();
}

/** Tween a value 0 -> 1 over `ms` with ease-out, calling `step(t)` every frame. */
export function tween(ms: number, step: (t: number) => void): () => void {
  if (reducedMotion()) {
    step(1);
    return () => {};
  }
  const start = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const x = Math.min(1, (now - start) / ms);
    step(1 - Math.pow(1 - x, 3));
    if (x < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/** Run `fn` once, the first time `el` is mostly on screen. */
export function onceVisible(el: Element, fn: () => void, threshold = 0.35): () => void {
  const io = new IntersectionObserver(([e]) => {
    if (e?.isIntersecting) {
      fn();
      io.disconnect();
    }
  }, { threshold });
  io.observe(el);
  return () => io.disconnect();
}
