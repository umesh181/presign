import { useState } from "react";

// Four demo pages, all reading from Arkiv (see README "Demo").
const PAGES = {
  simulator: { title: "About to Sign", todo: "Pick a scenario or paste a tx hash -> check() -> wallet-style verdict." },
  timeMachine: { title: "Binance Time Machine", todo: "Replay the Oct 29 delegation step by step with verified timestamps." },
  watchtower: { title: "Live Watchtower", todo: "Live mainnet EIP-7702 delegations: trusted / unknown / burst alerts." },
  explorer: { title: "Registry Explorer", todo: "Search chainId + address; show provenance, fingerprint, author, expiry, copyable query." },
} as const;

type PageKey = keyof typeof PAGES;

export function App() {
  const [page, setPage] = useState<PageKey>("simulator");
  return (
    <main>
      <header>
        <h1>PreSign</h1>
        <p>Verified pre-signing checks, mirrored on Arkiv.</p>
        <nav>
          {(Object.keys(PAGES) as PageKey[]).map((key) => (
            <button key={key} aria-pressed={page === key} onClick={() => setPage(key)}>
              {PAGES[key].title}
            </button>
          ))}
        </nav>
      </header>
      <section>
        <h2>{PAGES[page].title}</h2>
        <p className="todo">TODO: {PAGES[page].todo}</p>
      </section>
    </main>
  );
}
