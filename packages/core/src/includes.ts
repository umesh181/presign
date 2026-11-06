/**
 * Resolve ERC-7730 `includes` into one merged descriptor.
 *
 * Ported 1:1 from the registry's own resolver (CC0):
 * ethereum/clear-signing-erc7730-registry/.github/scripts/resolve-erc7730-includes.js
 * We copy its exact rules so our ERC-8176 hashes match the auditor attestations.
 *
 * Merge rules: the including file wins on conflicts; display.formats[sig].fields merge by `path`.
 */
type Json = any; // descriptor JSON is free-form

/** Loads a file by its repo-relative path, e.g. "registry/uniswap/calldata-X.json". */
export type FileLoader = (repoPath: string) => string | undefined;

function mergeFields(includedFields: Json[], includingFields: Json[]): Json[] {
  if (!Array.isArray(includedFields)) return includingFields || [];
  if (!Array.isArray(includingFields)) return includedFields;
  const byPath = new Map<string, Json>();
  for (const f of includedFields) if (f.path !== undefined) byPath.set(f.path, { ...f });
  for (const f of includingFields) {
    if (f.path === undefined) continue;
    const existing = byPath.get(f.path);
    byPath.set(f.path, existing ? { ...existing, ...f } : { ...f });
  }
  const order = includedFields.map((f) => f.path).filter((p) => p !== undefined);
  const appended = includingFields.filter((f) => f.path !== undefined && !order.includes(f.path));
  return [...order.map((p) => byPath.get(p)), ...appended].filter(Boolean);
}

const isObj = (v: Json) => typeof v === "object" && v !== null && !Array.isArray(v);

function deepMerge(a: Json, b: Json): Json {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  if (typeof a !== "object" || typeof b !== "object") return b;
  if (Array.isArray(a) && Array.isArray(b)) return b;
  const out: Json = { ...a };
  for (const key of Object.keys(b)) {
    if (key === "fields" && Array.isArray(a.fields) && Array.isArray(b.fields)) {
      out.fields = mergeFields(a.fields, b.fields);
    } else if (key === "formats" && isObj(a.formats) && isObj(b.formats)) {
      out.formats = {};
      for (const sig of new Set([...Object.keys(a.formats), ...Object.keys(b.formats)])) {
        out.formats[sig] = deepMerge(a.formats[sig] || {}, b.formats[sig] || {});
      }
    } else if (isObj(b[key]) && isObj(a[key])) {
      out[key] = deepMerge(a[key], b[key]);
    } else {
      out[key] = b[key];
    }
  }
  return out;
}

/** POSIX-style join + normalise ("registry/a/../../ercs/x.json" -> "ercs/x.json"). */
export function joinRepoPath(fromFile: string, ref: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const seg of ref.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

export function resolveDescriptor(repoPath: string, load: FileLoader, depth = 0): Json {
  if (depth > 10) throw new Error(`includes nested too deep at ${repoPath}`);
  const raw = load(repoPath);
  if (raw === undefined) throw new Error(`Descriptor not found: ${repoPath}`);
  const doc = JSON.parse(raw);
  if (doc.includes == null || doc.includes === "") return { ...doc };
  const included = resolveDescriptor(joinRepoPath(repoPath, doc.includes), load, depth + 1);
  const including = { ...doc };
  delete including.includes;
  return deepMerge(included, including);
}
