/** Wallet-style verdict panel: what PreSign would show right before the signature. */
import type { FormattedField, Result } from "@presign/core";
import type { ReactNode } from "react";
import { ARKIV_EXPLORER } from "../lib/arkiv.ts";
import type { Kind } from "../lib/scenarios.ts";
import { Alert, Check, Cross, External, Shield, Stop, Warn } from "./icons.tsx";

type Step = { state: "ok" | "fail" | "warn"; text: string };

/** Which checks ran and how they ended, derived from check()'s result. */
function steps(kind: Kind, r: Result): Step[] {
  const d = r.details ?? {};
  if (kind === "delegation") {
    if (r.reason.startsWith("Removes the delegation")) return [{ state: "ok", text: "Revocation: restores a plain wallet" }];
    if (r.reason.startsWith("Hands your entire account")) return [{ state: "fail", text: "Delegate is not on any vendor allowlist on Arkiv" }];
    if (r.reason.startsWith("Contract code differs"))
      return [
        { state: "ok", text: "Delegate found on the vendor allowlist (Arkiv)" },
        { state: "fail", text: "Live on-chain code does NOT match the stored fingerprint" },
      ];
    return [
      { state: "ok", text: `On ${String(d.vendor ?? "vendor")}'s official allowlist, proven in its own repo (Arkiv)` },
      { state: "ok", text: "Live on-chain code matches the stored code fingerprint" },
    ];
  }
  if (d.kind === "nativeTransfer") return [{ state: "ok", text: "Plain ETH transfer to a wallet: no hidden contract call" }];
  if (r.reason.startsWith("No verified translation")) return [{ state: "fail", text: "No verified ERC-7730 translation on Arkiv for this contract" }];
  if (r.reason.startsWith("Translation file tampered"))
    return [
      { state: "ok", text: "Translation found on Arkiv (signed by the PreSign publisher)" },
      { state: "fail", text: "Fingerprint mismatch: the file was altered after publication" },
    ];
  const base: Step[] = [
    { state: "ok", text: "Translation found on Arkiv (signed by the PreSign publisher)" },
    { state: "ok", text: "Fingerprint re-computed in your browser: matches" },
  ];
  if (r.status === "unknown") return [...base, { state: "warn", text: "This function isn't supported by our formatter yet" }];
  if (r.status === "blocked") return [...base, { state: "fail", text: "Transaction violates its translation rules" }];
  return [...base, { state: "ok", text: "Decoded with the protocol's own ERC-7730 rules" }];
}

const LABEL = { trusted: "VERIFIED", blocked: "BLOCKED", unknown: "UNVERIFIED" } as const;
const ICON = { trusted: <Shield size={26} />, blocked: <Stop />, unknown: <Warn /> } as const;

export function Verdict(props: {
  kind: Kind;
  result: Result;
  request: { label: string; value: string }[];
  note?: string;
  proof?: { label: string; href: string }[];
  actions?: ReactNode;
  /** Header label: "before you sign" unless the transaction is already on-chain. */
  when?: string;
}) {
  const { kind, result: r } = props;
  const fields = (r.details?.fields as FormattedField[] | undefined) ?? [];
  const entityKey = typeof r.details?.entityKey === "string" ? r.details.entityKey : undefined;

  return (
    <div className={`card verdict ${r.status}`}>
      <div className="verdict-head">
        <span>PreSign · {kind === "delegation" ? "EIP-7702 delegation" : "Transaction"}</span>
        <span className="mono">{props.when ?? "before you sign"}</span>
      </div>
      <div className={`verdict-body ${r.status}`}>
        <div className="status">
          <div className="status-icon">{ICON[r.status]}</div>
          <div>
            <div className="status-label">{LABEL[r.status]}</div>
            <div className="status-reason">{r.reason}</div>
          </div>
        </div>

        {fields.length > 0 && (
          <div>
            <div className="block-title">{props.when ? "What was signed" : "What you are signing"}</div>
            <dl className="kv">
              {fields.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div>
          <div className="block-title">Request</div>
          <dl className="kv">
            {props.request.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd className="mono">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <div className="block-title">Checks</div>
          <div className="checks">
            {steps(kind, r).map((s) => (
              <div key={s.text} className={`check ${s.state}`}>
                <span className="ic">{s.state === "ok" ? <Check /> : s.state === "fail" ? <Cross /> : <Alert />}</span>
                {s.text}
              </div>
            ))}
            {r.warnings.map((w) => (
              <div key={w} className="check warn">
                <span className="ic"><Alert /></span>
                {w}
              </div>
            ))}
          </div>
        </div>

        {(typeof r.details?.protocol === "string" || entityKey) && (
          <div className="chips">
            {typeof r.details?.protocol === "string" && <span className="chip">Protocol: {r.details.protocol}</span>}
            {r.details?.attested === true && <span className="chip good"><Check size={12} /> Audited by Cyfrin</span>}
            {entityKey && (
              <a className="chip" href={`${ARKIV_EXPLORER}/entity/${entityKey}`} target="_blank" rel="noreferrer">
                Arkiv entity {entityKey.slice(0, 10)}… <External />
              </a>
            )}
          </div>
        )}

        {props.note && <div className="note">{props.note}</div>}
        {props.proof && (
          <div className="chips">
            {props.proof.map((p) => (
              <a key={p.href} className="chip" href={p.href} target="_blank" rel="noreferrer">
                {p.label} <External />
              </a>
            ))}
          </div>
        )}
        {props.actions && <div className="actions">{props.actions}</div>}
      </div>
    </div>
  );
}
