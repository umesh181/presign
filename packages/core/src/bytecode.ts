/**
 * Static facts about EVM runtime bytecode, used by the Delegation Radar.
 * Pure functions: no network. Opcodes are walked properly (PUSH data is skipped, never read as opcodes).
 */
import { keccak256, type Hex } from "viem";

const PUSH1 = 0x60;
const PUSH20 = 0x73;
const PUSH32 = 0x7f;
const DELEGATECALL = 0xf4;
const SELFDESTRUCT = 0xff;

interface Push {
  /** offset of the PUSH opcode */
  at: number;
  size: number;
  data: Uint8Array;
}

function hexBytes(code: Hex): Uint8Array {
  const s = code.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Solidity/Vyper append CBOR metadata (compiler version, source hash): the last 2 bytes give its length. */
function stripMetadata(b: Uint8Array): Uint8Array {
  if (b.length < 4) return b;
  const len = (b[b.length - 2]! << 8) | b[b.length - 1]!;
  const start = b.length - 2 - len;
  // CBOR map header 0xa1..0xa5 marks real metadata; otherwise leave the code alone.
  if (len > 0 && start > 0 && b[start]! >= 0xa1 && b[start]! <= 0xa5) return b.slice(0, start);
  return b;
}

function walk(b: Uint8Array) {
  const ops: number[] = [];
  const pushes: Push[] = [];
  for (let i = 0; i < b.length; i++) {
    const op = b[i]!;
    ops.push(op);
    if (op >= PUSH1 && op <= PUSH32) {
      const size = op - PUSH1 + 1;
      pushes.push({ at: i, size, data: b.slice(i + 1, i + 1 + size) });
      i += size;
    }
  }
  return { ops, pushes };
}

const isAddressWord = (p: Push) =>
  (p.size === 20 && p.data.some((x) => x !== 0)) ||
  (p.size === 32 && p.data.slice(0, 12).every((x) => x === 0) && p.data.slice(12).some((x) => x !== 0));

/**
 * Code family: keccak of the code with metadata stripped and every 20- and 32-byte constant blanked.
 * Clones that only differ in the hardcoded attacker address (or XOR-obfuscated immutables) share a family.
 */
export function codeFamily(code: Hex): Hex {
  const b = stripMetadata(hexBytes(code));
  const masked = b.slice();
  for (const p of walk(b).pushes) if (p.size === 20 || p.size === 32) masked.fill(0, p.at + 1, p.at + 1 + p.size);
  let hex = "0x";
  for (const x of masked) hex += x.toString(16).padStart(2, "0");
  return keccak256(hex as Hex);
}

export interface CodeFacts {
  size: number;
  family: Hex;
  /** Can run code from ANOTHER address in the account's context. */
  delegatecall: boolean;
  selfdestruct: boolean;
  /** Addresses hardcoded in the code (PUSH20 constants and address-shaped PUSH32 immutables). */
  addressRefs: Hex[];
}

export function codeFacts(code: Hex): CodeFacts {
  const b = stripMetadata(hexBytes(code));
  const { ops, pushes } = walk(b);
  const refs = new Set<string>();
  for (const p of pushes.filter(isAddressWord)) {
    const a = p.data.slice(p.size - 20);
    refs.add("0x" + [...a].map((x) => x.toString(16).padStart(2, "0")).join(""));
  }
  return {
    size: (code.length - 2) / 2,
    family: codeFamily(code),
    delegatecall: ops.includes(DELEGATECALL),
    selfdestruct: ops.includes(SELFDESTRUCT),
    addressRefs: [...refs] as Hex[],
  };
}
