/** Registry Explorer: what PreSign has on Arkiv for an address, with its proof. */
import { useState } from "react";
import { isAddress, type Hex } from "viem";
import { ARKIV_EXPLORER, arkivCurl, explore, formatDuration, PUBLISHER, type ExplorerEntry } from "../lib/arkiv.ts";
import { Check, Cross, External, Search } from "./icons.tsx";

const CHAINS: Record<number, string> = { 1: "Ethereum", 10: "Optimism", 56: "BNB Chain", 137: "Polygon", 8453: "Base", 42161: "Arbitrum", 11155111: "Sepolia" };

const PICKS = [
  { label: "Uniswap V3 SwapRouter", chainId: 1, address: "0xE592427A0AEce92De3Edee1F18E0157C05861564" },
  { label: "MetaMask EIP-7702 delegator", chainId: 11155111, address: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" },
  { label: "Coinbase EIP7702Proxy (Base)", chainId: 8453, address: "0x7702cb554e6bFb442cb743A7dF23154544a7176C" },
  { label: "Binance sweeper", chainId: 1, address: "0x63e842B054Bd624a465454D533C33F573e9c6fAe" },
];

const date = (unix: number) => new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const ghLink = (repo: string, commit: string, path: string) => `https://github.com/${repo}/blob/${commit}/${path}`;

export function Explorer() {
  const [chainId, setChainId] = useState("1");
  const [address, setAddress] = useState("");
  const [entries, setEntries] = useState<ExplorerEntry[] | null>(null);
  const [searched, setSearched] = useState<{ chainId: number; address: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function lookup(c: number, a: string) {
    setError("");
    if (!isAddress(a)) return setError("Enter a valid 0x address");
    if (!Number.isInteger(c) || c <= 0) return setError("Enter a chain id, e.g. 1");
    setChainId(String(c));
    setAddress(a);
    setBusy(true);
    setEntries(null);
    try {
      setEntries(await explore(c, a as Hex));
      setSearched({ chainId: c, address: a });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <>
      <div className="section-title">
        <h2>Registry Explorer</h2>
        <p>Read straight from Arkiv: no PreSign server in between.</p>
      </div>

      <div className="card card-pad">
        <form className="search" onSubmit={(e) => (e.preventDefault(), lookup(Number(chainId), address.trim()))}>
          <label className="field">
            <span>Chain</span>
            <input list="chains" value={chainId} onChange={(e) => setChainId(e.target.value)} />
            <datalist id="chains">
              {Object.entries(CHAINS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </datalist>
          </label>
          <label className="field">
            <span>Contract address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" />
          </label>
          <button className="btn btn-primary" style={{ alignSelf: "end", height: 44 }} disabled={busy}>
            <Search /> Look up
          </button>
        </form>
        <div className="picks">
          {PICKS.map((p) => (
            <button key={p.label} className="chip" style={{ cursor: "pointer" }} onClick={() => lookup(p.chainId, p.address)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {busy && <div className="card empty entry"><div className="spinner" /><div>Querying Arkiv…</div></div>}

      {entries && searched && entries.length === 0 && (
        <div className="card entry">
          <div className="entry-head">
            <div>
              <span className="tag" style={{ color: "var(--red)", background: "var(--red-bg)", borderColor: "rgba(244,63,94,.3)" }}>Not in PreSign</span>
              <h3 className="mono">{searched.address}</h3>
            </div>
          </div>
          <div className="entry-body">
            <div className="check fail"><span className="ic"><Cross /></span>No verified translation and not on any vendor allowlist on {CHAINS[searched.chainId] ?? `chain ${searched.chainId}`}.</div>
            <div className="note">A signer using PreSign shows <b>unknown</b> for calls to this contract, and <b>blocks</b> EIP-7702 delegations to it.</div>
          </div>
        </div>
      )}

      {entries?.map((e) => (
        <div key={e.key} className="card entry">
          <div className="entry-head">
            <div>
              <span className="tag">{e.kind === "descriptor" ? "Clear-signing translation" : "Trusted EIP-7702 delegate"}</span>
              <h3>{e.kind === "descriptor" ? `${e.protocolOwner}${e.contractName ? ` · ${e.contractName}` : ""}` : `${e.vendor} · ${e.contractName}${e.version ? ` v${e.version}` : ""}`}</h3>
            </div>
            <a className="btn" href={`${ARKIV_EXPLORER}/entity/${e.key}`} target="_blank" rel="noreferrer">Arkiv entity <External /></a>
          </div>
          <div className="entry-body">
            <div className="chips">
              {e.kind === "descriptor" && (e.fingerprintOk
                ? <span className="chip good"><Check size={12} /> Fingerprint verified in your browser</span>
                : <span className="chip" style={{ color: "var(--red)" }}><Cross size={12} /> Fingerprint mismatch</span>)}
              {e.kind === "descriptor" && e.attested && <span className="chip good"><Check size={12} /> Audited by Cyfrin</span>}
              {e.creator.toLowerCase() === PUBLISHER.toLowerCase() && <span className="chip good"><Check size={12} /> Written by PreSign publisher</span>}
              <span className="chip">Expires in {formatDuration(e.expiresInSeconds)}</span>
            </div>

            <dl className="kv">
              <div><dt>Chain</dt><dd>{CHAINS[searched!.chainId] ?? searched!.chainId}</dd></div>
              <div><dt>Address</dt><dd className="mono">{searched!.address}</dd></div>
              {e.kind === "descriptor" ? (
                <div><dt>Fingerprint (ERC-8176)</dt><dd className="mono">{e.descriptorHash}</dd></div>
              ) : (
                <div><dt>Code hash</dt><dd className="mono">{e.codeHash}</dd></div>
              )}
              <div><dt>Source</dt><dd><a href={ghLink(e.sourceRepo, e.sourceCommit, e.sourcePath)} target="_blank" rel="noreferrer">{e.sourceRepo} @ {e.sourceCommit.slice(0, 7)} <External /></a></dd></div>
              <div><dt>File</dt><dd className="mono">{e.sourcePath}</dd></div>
              <div><dt>Imported</dt><dd>{date(e.importedAt)}</dd></div>
              <div><dt>Publisher</dt><dd className="mono">{e.creator}</dd></div>
            </dl>

            {e.kind === "descriptor" && e.functions.length > 0 && (
              <div>
                <div className="block-title">Functions it can translate ({e.functions.length})</div>
                <div className="fn-list">{e.functions.map((f) => <code key={f}>{f}</code>)}</div>
              </div>
            )}

            <div>
              <div className="block-title">Run this query yourself</div>
              <div className="codebox">
                {arkivCurl(e.kind, searched!.chainId, searched!.address)}
                <button className="btn" onClick={() => copy(arkivCurl(e.kind, searched!.chainId, searched!.address))}>
                  {copied === arkivCurl(e.kind, searched!.chainId, searched!.address) ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--faint)" }}>
                Works without a key on Arkiv's small anonymous quota. If you see ANON_COST_LIMITED, add <code>-H "X-API-KEY: …"</code> with a free key from hub.arkiv.network.
              </p>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
