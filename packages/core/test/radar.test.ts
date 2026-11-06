import { describe, expect, it } from "vitest";
import { codeFacts, codeFamily } from "../src/bytecode.ts";
import { checkDelegation, type DelegateDeps } from "../src/check.ts";
import { codeHash } from "../src/fingerprint.ts";

// PUSH20 <addr> BALANCE STOP ... : two clones that differ only in the hardcoded address.
const clone = (addr: string) => `0x73${addr}3100` as const;
const A = "11".repeat(20);
const B = "22".repeat(20);

describe("codeFamily", () => {
  it("groups clones that differ only in a hardcoded address", () => {
    expect(codeFamily(clone(A))).toBe(codeFamily(clone(B)));
    expect(codeHash(clone(A))).not.toBe(codeHash(clone(B)));
  });

  it("separates different logic", () => {
    expect(codeFamily(clone(A))).not.toBe(codeFamily(`0x73${A}3200`));
  });

  it("does not read PUSH data as opcodes", () => {
    // PUSH1 0xf4 (data, not DELEGATECALL) vs a real DELEGATECALL opcode.
    expect(codeFacts("0x60f400").delegatecall).toBe(false);
    expect(codeFacts("0x6000f4").delegatecall).toBe(true);
  });

  it("finds hardcoded addresses (PUSH20 and address-shaped PUSH32)", () => {
    const refs = codeFacts(`0x73${A}7f${"00".repeat(12)}${B}00`).addressRefs;
    expect(refs).toEqual([`0x${A}`, `0x${B}`]);
  });
});

const VENDOR = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as const;
const OTHER = "0x00000000000000000000000000000000000000aa" as const;
const NOW = 1_800_000_000;

/** Fake chain + Arkiv. Override pieces per test. */
function deps(over: Partial<DelegateDeps> = {}): DelegateDeps {
  return {
    lookupDelegate: async (_c, a) => (a === VENDOR ? { vendor: "MetaMask", contractName: "DeleGator", codeHash: codeHash("0x6001") } : null),
    currentCode: async () => "0x6001",
    lookupBadFamily: async () => null,
    lookupProfile: async () => ({ upgradeable: false, firstSeenAt: NOW - 30 * 86400, accounts: 1200, authorizations: 1500 }),
    lookupAlerts: async () => [],
    now: () => NOW,
    ...over,
  };
}
const one = (address: `0x${string}`) => [{ chainId: 1, address, nonce: 0 }];

describe("checkDelegation (Radar evidence)", () => {
  it("trusts a vendor contract with clean evidence", async () => {
    const r = await checkDelegation(one(VENDOR), deps());
    expect(r.status).toBe("trusted");
    expect(r.evidence!.every((e) => e.state === "ok")).toBe(true);
  });

  it("blocks known drainer code even at a brand-new address", async () => {
    const r = await checkDelegation(one(OTHER), deps({ lookupBadFamily: async () => ({ label: "CrimeEnjoyor v1 clone", source: "x" }) }));
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/known wallet drainer/);
  });

  it("blocks a VENDOR contract once the Watchtower raised a logic-change alert", async () => {
    const r = await checkDelegation(
      one(VENDOR),
      deps({ lookupAlerts: async () => [{ alertType: "logicChanged", message: "Logic changed at block 1", detectedAt: NOW }] }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/logic changed/);
  });

  it("is cautious (not blocked) about an unknown contract with no bad evidence", async () => {
    const r = await checkDelegation(one(OTHER), deps());
    expect(r.status).toBe("unknown");
    expect(r.warnings).toContain("Not listed by any wallet vendor");
  });

  it("warns when the logic is upgradeable by a third party, even for a vendor", async () => {
    const r = await checkDelegation(
      one(VENDOR),
      deps({ lookupProfile: async () => ({ upgradeable: true, upgradeableVia: OTHER, firstSeenAt: NOW - 30 * 86400, accounts: 5, authorizations: 5 }) }),
    );
    expect(r.status).toBe("unknown");
    expect(r.warnings.join(" ")).toMatch(/Upgradeable/);
  });

  it("warns about contracts the Watchtower never saw or saw only recently", async () => {
    expect((await checkDelegation(one(OTHER), deps({ lookupProfile: async () => null }))).warnings).toContain("Never seen by the PreSign Watchtower");
    const fresh = await checkDelegation(one(OTHER), deps({ lookupProfile: async () => ({ upgradeable: false, firstSeenAt: NOW - 7200, accounts: 3, authorizations: 3 }) }));
    expect(fresh.warnings.join(" ")).toMatch(/First seen by the Watchtower 2 h ago/);
  });

  it("does not hold a vendor contract back just because the Watchtower profiled it recently", async () => {
    const r = await checkDelegation(one(VENDOR), deps({ lookupProfile: async () => ({ upgradeable: false, firstSeenAt: NOW - 60, accounts: 0, authorizations: 0 }) }));
    expect(r.status).toBe("trusted");
  });

  it("blocks delegating to an address with no contract", async () => {
    const r = await checkDelegation(one(OTHER), deps({ currentCode: async () => null }));
    expect(r.status).toBe("blocked");
  });
});

describe("inspectDelegate (fake chain)", async () => {
  const { inspectDelegate } = await import("../src/radar.ts");
  const BEACON = "33".repeat(20);
  const IMPL1 = `0x${"44".repeat(20)}`;
  const IMPL2 = `0x${"55".repeat(20)}`;
  // Delegate: PUSH32 <beacon as immutable> ... DELEGATECALL. Beacon: dispatcher with PUSH4 upgradeTo(address).
  const delegateCode = `0x7f${"00".repeat(12)}${BEACON}f400`;
  const beaconCode = "0x63" + "3659cfe6" + "00";
  const fake = (impl: string) =>
    ({
      getCode: async ({ address }: { address: string }) =>
        address.toLowerCase() === "0x" + "aa".repeat(20) ? delegateCode : address.toLowerCase() === `0x${BEACON}` ? beaconCode : "0x6001",
      getStorageAt: async () => `0x${"00".repeat(32)}`,
      call: async () => ({ data: `0x${"00".repeat(12)}${impl.slice(2)}` }),
    }) as never;

  it("flags a delegate whose logic sits behind a beacon, and fingerprints the current logic", async () => {
    const a = await inspectDelegate(fake(IMPL1), `0x${"aa".repeat(20)}`);
    expect(a!.upgradeable).toBe(true);
    expect(a!.upgradeableVia).toBe(`0x${BEACON}`);
    expect(a!.deps[0]!.implementation).toBe(IMPL1);
    const b = await inspectDelegate(fake(IMPL2), `0x${"aa".repeat(20)}`);
    expect(b!.codeHash).toBe(a!.codeHash); // same delegate code…
    expect(b!.logicHash).not.toBe(a!.logicHash); // …but the logic changed
  });
});
