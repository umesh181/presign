import { describe, expect, it } from "vitest";
import { checkTransaction, type DescriptorRecord, type TransactionDeps } from "../src/check.ts";
import { descriptorHash } from "../src/fingerprint.ts";

const EOA = "0x1111111111111111111111111111111111111111" as const;
const ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as const;
const descriptor = { context: { contract: { deployments: [{ chainId: 1, address: ROUTER }] } } };

function deps(record: DescriptorRecord | null): TransactionDeps {
  return {
    isContract: async (_c, a) => a === ROUTER,
    lookupDescriptor: async () => record,
    format: () => ({ intent: "Swap", fields: [] }),
  };
}

describe("checkTransaction", () => {
  it("trusts a plain ETH send to a normal wallet", async () => {
    const r = await checkTransaction({ chainId: 1, to: EOA, value: 10n ** 15n }, deps(null));
    expect(r.status).toBe("trusted");
    expect(r.reason).toMatch(/Send 0.001 ETH/);
  });

  it("returns unknown when no verified translation exists", async () => {
    const r = await checkTransaction({ chainId: 1, to: ROUTER, data: "0x414bf389" }, deps(null));
    expect(r.status).toBe("unknown");
  });

  it("blocks a tampered descriptor (fingerprint mismatch)", async () => {
    const record = { descriptorHash: descriptorHash(descriptor), attested: true, protocolOwner: "Uniswap", descriptor: { ...descriptor, tampered: true } };
    const r = await checkTransaction({ chainId: 1, to: ROUTER, data: "0x414bf389" }, deps(record));
    expect(r.status).toBe("blocked");
  });

  it("trusts a verified, formattable descriptor", async () => {
    const record = { descriptorHash: descriptorHash(descriptor), attested: true, protocolOwner: "Uniswap", descriptor };
    const r = await checkTransaction({ chainId: 1, to: ROUTER, data: "0x414bf389" }, deps(record));
    expect(r.status).toBe("trusted");
  });
});
