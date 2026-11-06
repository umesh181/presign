import { describe, expect, it } from "vitest";
import { checkDelegation, type DelegateDeps } from "../src/check.ts";
import { codeHash, descriptorHash } from "../src/fingerprint.ts";
import binance from "../../../fixtures/binance-replay.json" with { type: "json" };

const METAMASK = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as const;
const FAKE_CODE_HASH = codeHash("0x6001");

// Fake Arkiv + chain: only MetaMask's delegator is on the allowlist.
const deps: DelegateDeps = {
  async lookupDelegate(_chainId, address) {
    return address.toLowerCase() === METAMASK.toLowerCase()
      ? { vendor: "MetaMask", contractName: "EIP7702StatelessDeleGatorImpl", codeHash: FAKE_CODE_HASH }
      : null;
  },
  async currentCode() {
    return "0x6001";
  },
};

describe("checkDelegation", () => {
  it("blocks the Binance sweeper (not on any vendor allowlist)", async () => {
    const auths = Array.from({ length: binance.authorizationCount }, (_, i) => ({
      chainId: binance.chainId,
      address: binance.delegate as `0x${string}`,
      nonce: binance.nonceRange[0]! + i,
    }));
    const result = await checkDelegation(auths, deps);
    expect(result.status).toBe("blocked");
    expect(result.warnings.join(" ")).toMatch(/50 authorizations/);
  });

  it("allows revoking a delegation (zero address)", async () => {
    const result = await checkDelegation([{ chainId: 1, address: "0x0000000000000000000000000000000000000000", nonce: 0 }], deps);
    expect(result.status).toBe("trusted");
    expect(result.reason).toMatch(/Removes the delegation/);
  });

  it("blocks when live code differs from the trusted code hash", async () => {
    const result = await checkDelegation([{ chainId: 1, address: METAMASK, nonce: 0 }], { ...deps, currentCode: async () => "0x6002" });
    expect(result.status).toBe("blocked");
  });

  it("trusts MetaMask's official delegator", async () => {
    const result = await checkDelegation([{ chainId: 1, address: METAMASK, nonce: 0 }], deps);
    expect(result.status).toBe("trusted");
  });
});

describe("descriptorHash", () => {
  it("is independent of JSON key order (JCS)", () => {
    expect(descriptorHash({ a: 1, b: [1, 2] })).toBe(descriptorHash({ b: [1, 2], a: 1 }));
  });
});
