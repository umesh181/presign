/**
 * Minimal ERC-7730 formatter: calldata -> plain English, using ONLY descriptors from Arkiv.
 * We do not use Sourcify-made libraries (track rule).
 *
 * Conformance is tested against the registry's own test vectors (real mainnet txs):
 * packages/core/test/formatter.test.ts.
 *
 * Safety rule: if anything can't be rendered EXACTLY (unknown format, unresolvable path,
 * $ref, slices...), formatCalldata returns null and check() reports "unknown".
 * We never show a partial or guessed translation.
 */
import {
  decodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseAbiItem,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from "viem";

export interface FormattedField {
  label: string;
  value: string;
}

export interface Formatted {
  intent: string;
  /** Present only if every placeholder could be filled from a displayed field. */
  interpolatedIntent?: string;
  fields: FormattedField[];
  /** e.g. a `mustMatch` field whose value is not allowed. check() treats any warning as blocked. */
  warnings: string[];
}

export interface TokenInfo {
  symbol: string;
  decimals: number;
}

/** Token metadata source (on-chain ERC-20 reads in the app, a fixture in tests). */
export type TokenLookup = (chainId: number, address: Hex) => Promise<TokenInfo | null>;

export interface FormatInput {
  chainId: number;
  to: Hex;
  from?: Hex;
  value?: bigint;
  data: Hex;
}

type Json = any; // descriptor JSON is free-form

class Unsupported extends Error {}

const NATIVE_SYMBOL: Record<number, string> = { 1: "ETH", 10: "ETH", 8453: "ETH", 42161: "ETH", 11155111: "ETH", 56: "BNB", 137: "POL" };

export async function formatCalldata(descriptor: Json, tx: FormatInput, tokens: TokenLookup): Promise<Formatted | null> {
  try {
    return await render(descriptor, tx, tokens);
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}

async function render(descriptor: Json, tx: FormatInput, tokens: TokenLookup): Promise<Formatted | null> {
  const selector = tx.data.slice(0, 10).toLowerCase();
  const formats: Record<string, Json> = descriptor?.display?.formats ?? {};

  // 1. Find the format whose function signature hashes to the calldata selector.
  let abiItem: AbiFunction | undefined;
  let format: Json;
  for (const [key, value] of Object.entries(formats)) {
    if (key.startsWith("0x")) continue; // selector-only keys can't be decoded without an ABI
    const item = parseAbiItem(`function ${key}`) as AbiFunction;
    if (toFunctionSelector(item) === selector) {
      abiItem = item;
      format = value;
      break;
    }
  }
  if (!abiItem) return null;

  // 2. Decode calldata; viem returns named tuples as objects.
  let args: readonly unknown[];
  try {
    args = decodeFunctionData({ abi: [abiItem], data: tx.data }).args ?? [];
  } catch {
    throw new Unsupported("calldata does not match the function signature");
  }
  const calldata: Record<string, unknown> = {};
  abiItem.inputs.forEach((input, i) => {
    if (!input.name) throw new Unsupported("unnamed parameter");
    calldata[input.name] = args[i];
  });

  const ctx = { descriptor, tx, calldata, tokens };
  const fields: FormattedField[] = [];
  const byPath = new Map<string, string>();
  const warnings: string[] = [];

  // 3. Render each field in order, honouring visibility rules.
  for (const field of format.fields ?? []) {
    if (field.$ref || field.fields) throw new Unsupported("$ref / nested fields");
    const value = field.path !== undefined ? resolvePath(ctx, field.path) : field.value;
    if (value === undefined) throw new Unsupported(`unresolved ${field.path}`);

    const visible = field.visible;
    if (visible === "never") continue;
    if (visible && typeof visible === "object") {
      if (visible.ifNotIn && visible.ifNotIn.some((v: unknown) => same(v, value))) continue;
      if (visible.mustMatch) {
        if (!visible.mustMatch.some((v: unknown) => same(v, value))) warnings.push(`${field.label}: unexpected value ${String(value)}`);
        continue; // mustMatch fields are always hidden
      }
    }

    const text = await formatValue(ctx, field.format, field.params ?? {}, value);
    fields.push({ label: field.label, value: text });
    if (field.path !== undefined) byPath.set(field.path, text);
  }

  // 4. Fill "{path}" placeholders; drop the sentence if any placeholder isn't a displayed field.
  let interpolatedIntent: string | undefined;
  if (typeof format.interpolatedIntent === "string") {
    let complete = true;
    const filled = format.interpolatedIntent.replace(/\{([^}]+)\}/g, (_: string, p: string) => {
      const text = byPath.get(p);
      if (text === undefined) complete = false;
      return text ?? "";
    });
    if (complete) interpolatedIntent = filled;
  }

  const intent = typeof format.intent === "string" ? format.intent : Object.values(format.intent ?? {}).join(", ");
  return { intent, interpolatedIntent, fields, warnings };
}

interface Ctx {
  descriptor: Json;
  tx: FormatInput;
  calldata: Record<string, unknown>;
  tokens: TokenLookup;
}

/** ERC-7730 paths: "#.a.b" / "a.b" (calldata), "@.value|to|from|chainId" (container), "$.x" (descriptor). */
function resolvePath(ctx: Ctx, path: string): unknown {
  if (path.startsWith("@.")) {
    const containers: Record<string, unknown> = { value: ctx.tx.value ?? 0n, to: ctx.tx.to, from: ctx.tx.from, chainId: BigInt(ctx.tx.chainId) };
    return containers[path.slice(2)];
  }
  let root: unknown = ctx.calldata;
  let rest = path;
  if (path.startsWith("$.")) [root, rest] = [ctx.descriptor, path.slice(2)];
  else if (path.startsWith("#.")) rest = path.slice(2);

  let node = root;
  for (const segment of rest.split(".")) {
    const m = segment.match(/^([^[\]]*)((?:\[-?\d+\])*)$/);
    if (!m) throw new Unsupported(`path segment ${segment}`); // e.g. slices [a:b]
    if (m[1]) node = (node as Record<string, unknown>)?.[m[1]];
    for (const idx of m[2]!.match(/-?\d+/g) ?? []) {
      if (!Array.isArray(node)) return undefined;
      const i = Number(idx);
      node = node[i < 0 ? node.length + i : i];
    }
  }
  return node;
}

/** A params value can be a literal or a "$." reference into the descriptor. */
function param(ctx: Ctx, v: unknown): unknown {
  return typeof v === "string" && v.startsWith("$.") ? resolvePath(ctx, v) : v;
}

async function formatValue(ctx: Ctx, format: string | undefined, params: Json, value: unknown): Promise<string> {
  switch (format) {
    case undefined:
    case "raw":
      return raw(value);

    case "amount": {
      const v = toBigInt(value);
      const symbol = NATIVE_SYMBOL[ctx.tx.chainId] ?? "native";
      if (overThreshold(ctx, params, v)) return `${params.message ?? "All"} ${symbol}`;
      return `${formatEther(v)} ${symbol}`;
    }

    case "tokenAmount": {
      const v = toBigInt(value);
      const token = params.tokenPath !== undefined ? resolvePath(ctx, params.tokenPath) : param(ctx, params.token);
      if (typeof token !== "string" || !isAddress(token)) throw new Unsupported("token address");
      const native = [param(ctx, params.nativeCurrencyAddress)].flat().filter(Boolean) as string[];
      const info: TokenInfo | null = native.some((a) => a.toLowerCase() === token.toLowerCase())
        ? { symbol: NATIVE_SYMBOL[ctx.tx.chainId] ?? "native", decimals: 18 }
        : await ctx.tokens(ctx.tx.chainId, token);
      if (!info) return `${v} (raw units of unknown token ${getAddress(token)})`;
      if (overThreshold(ctx, params, v)) return `${params.message ?? "Unlimited"} ${info.symbol}`;
      return `${formatUnits(v, info.decimals)} ${info.symbol}`;
    }

    case "tokenTicker": {
      if (typeof value !== "string" || !isAddress(value)) throw new Unsupported("tokenTicker value");
      return (await ctx.tokens(ctx.tx.chainId, value))?.symbol ?? getAddress(value);
    }

    case "addressName": {
      // No trusted name sources (ENS/local) yet: ERC-55 address, as the spec's fallback says.
      if (typeof value !== "string" || !isAddress(value)) throw new Unsupported("addressName value");
      return getAddress(value);
    }

    case "date": {
      if (params.encoding !== "timestamp") throw new Unsupported("date encoding"); // blockheight needs RPC
      const iso = new Date(Number(toBigInt(value)) * 1000).toISOString();
      return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
    }

    case "unit": {
      if (params.prefix) throw new Unsupported("unit SI prefix");
      return `${formatUnits(toBigInt(value), params.decimals ?? 0)}${params.base}`;
    }

    default:
      throw new Unsupported(`format ${format}`);
  }
}

function overThreshold(ctx: Ctx, params: Json, v: bigint): boolean {
  const t = param(ctx, params.threshold);
  return t !== undefined && v >= BigInt(t as string | number);
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" || (typeof v === "string" && /^(0x[0-9a-f]+|\d+)$/i.test(v))) return BigInt(v);
  throw new Unsupported(`not an integer: ${String(v)}`);
}

function raw(v: unknown): string {
  if (typeof v === "string" && isAddress(v)) return getAddress(v);
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean" || typeof v === "string") return String(v);
  throw new Unsupported("raw value type");
}

/** Compare a descriptor literal (JSON) with a decoded value. */
function same(a: unknown, b: unknown): boolean {
  try {
    if (typeof b === "bigint" || typeof a === "number") return toBigInt(a) === toBigInt(b);
  } catch {
    return false;
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}
