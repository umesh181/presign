/**
 * Formatter conformance: render the registry's own test transactions (real Ethereum mainnet
 * txs, see fixtures/registry/README.md) and compare with the display the registry expects.
 */
import { describe, expect, it } from "vitest";
import { parseTransaction, type Hex } from "viem";
import { formatCalldata, type TokenLookup } from "../src/formatter.ts";
import descriptor from "../../../fixtures/registry/calldata-UniswapV3SwapRouter.json" with { type: "json" };
import suite from "../../../fixtures/registry/calldata-UniswapV3SwapRouter.tests.json" with { type: "json" };

const tokens: TokenLookup = async (_chainId, address) => {
  const t = (suite.dataProvider.tokens as Record<string, { symbol: string; decimals: number }>)[address.toLowerCase()];
  return t ? { symbol: t.symbol, decimals: t.decimals } : null;
};

describe("ERC-7730 formatter vs registry test vectors (Uniswap V3 SwapRouter)", () => {
  for (const t of suite.tests) {
    it(t.description, async () => {
      const tx = parseTransaction(t.rawTx as Hex);
      const out = await formatCalldata(
        descriptor,
        { chainId: tx.chainId!, to: tx.to!, from: t.from as Hex, value: tx.value ?? 0n, data: tx.data! },
        tokens,
      );
      expect(out).not.toBeNull();
      expect(out!.warnings).toEqual([]);
      expect({ intent: out!.intent, interpolatedIntent: out!.interpolatedIntent, fields: out!.fields }).toEqual({
        intent: t.expected.intent,
        interpolatedIntent: t.expected.interpolatedIntent,
        fields: t.expected.fields,
      });
    });
  }

  it("returns null for malformed calldata of a known function", async () => {
    const out = await formatCalldata(descriptor, { chainId: 1, to: "0xE592427A0AEce92De3Edee1F18E0157C05861564", data: "0x414bf389" }, tokens);
    expect(out).toBeNull();
  });

  it("returns null for a selector the descriptor does not cover", async () => {
    const out = await formatCalldata(descriptor, { chainId: 1, to: "0xE592427A0AEce92De3Edee1F18E0157C05861564", data: "0xdeadbeef" }, tokens);
    expect(out).toBeNull();
  });
});
