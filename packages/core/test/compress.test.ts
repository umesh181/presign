import { expect, it } from "vitest";
import { gunzip, gzip } from "../src/compress.ts";

it("gzip round-trips descriptor JSON", async () => {
  const json = JSON.stringify({ display: { formats: { "f()": { intent: "Swap".repeat(500) } } } });
  const packed = await gzip(new TextEncoder().encode(json));
  expect(packed.length).toBeLessThan(json.length);
  expect(new TextDecoder().decode(await gunzip(packed))).toBe(json);
});
