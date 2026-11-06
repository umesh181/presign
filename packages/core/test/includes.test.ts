import { describe, expect, it } from "vitest";
import { joinRepoPath, resolveDescriptor } from "../src/includes.ts";

describe("joinRepoPath", () => {
  it("resolves relative includes like the registry does", () => {
    expect(joinRepoPath("registry/x/calldata-A.json", "../../ercs/calldata-erc4626.json")).toBe("ercs/calldata-erc4626.json");
    expect(joinRepoPath("registry/x/calldata-A.json", "common-A.json")).toBe("registry/x/common-A.json");
  });
});

describe("resolveDescriptor", () => {
  const files: Record<string, string> = {
    "registry/x/common.json": JSON.stringify({
      metadata: { owner: "Base", info: { url: "a" } },
      display: { formats: { "f(uint256 a)": { intent: "Old", fields: [{ path: "a", label: "A" }, { path: "b", label: "B" }] } } },
    }),
    "registry/x/calldata-X.json": JSON.stringify({
      includes: "common.json",
      metadata: { owner: "X" },
      display: { formats: { "f(uint256 a)": { intent: "New", fields: [{ path: "a", label: "A2" }, { path: "c", label: "C" }] } } },
    }),
  };
  const merged = resolveDescriptor("registry/x/calldata-X.json", (p) => files[p]);

  it("lets the including file win and drops `includes`", () => {
    expect(merged.includes).toBeUndefined();
    expect(merged.metadata).toEqual({ owner: "X", info: { url: "a" } });
    expect(merged.display.formats["f(uint256 a)"].intent).toBe("New");
  });

  it("merges fields by path, keeping included order then appending new ones", () => {
    expect(merged.display.formats["f(uint256 a)"].fields.map((f: { path: string; label: string }) => `${f.path}:${f.label}`)).toEqual([
      "a:A2",
      "b:B",
      "c:C",
    ]);
  });
});
