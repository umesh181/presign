import { describe, expect, it } from "vitest";
import { planSync, type ExistingEntity, type FreshRow } from "../src/plan.ts";

const k = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const ex = (n: number, id: string, hash: string): ExistingEntity => ({ key: k(n), id, hash });
const fr = (id: string, hash: string): FreshRow<string> => ({ id, hash, row: `row:${id}:${hash}` });

describe("planSync", () => {
  it("unchanged -> extend only, no history", () => {
    const plan = planSync([ex(1, "1:0xa", "h1")], [fr("1:0xa", "h1")]);
    expect(plan.extend).toEqual([k(1)]);
    expect(plan.items).toEqual([]);
  });

  it("new in source -> create + 'added'", () => {
    const plan = planSync([], [fr("1:0xa", "h1")]);
    expect(plan.extend).toEqual([]);
    expect(plan.items).toEqual([{ id: "1:0xa", create: "row:1:0xa:h1", retire: [], change: { changeType: "added", newHash: "h1" } }]);
  });

  it("changed content -> create new + supersede old + 'modified', atomically in one item", () => {
    const plan = planSync([ex(1, "1:0xa", "h1")], [fr("1:0xa", "h2")]);
    expect(plan.extend).toEqual([]);
    expect(plan.items).toEqual([
      {
        id: "1:0xa",
        create: "row:1:0xa:h2",
        retire: [{ key: k(1), status: "superseded" }],
        change: { changeType: "modified", oldHash: "h1", newHash: "h2" },
      },
    ]);
  });

  it("gone from source -> mark removed now + 'removed'", () => {
    const plan = planSync([ex(1, "1:0xa", "h1")], []);
    expect(plan.items).toEqual([{ id: "1:0xa", retire: [{ key: k(1), status: "removed" }], change: { changeType: "removed", oldHash: "h1" } }]);
  });

  it("resumes after a crash: new entity already written -> extend it, retire the old, no duplicate history", () => {
    const plan = planSync([ex(1, "1:0xa", "h1"), ex(2, "1:0xa", "h2")], [fr("1:0xa", "h2")]);
    expect(plan.extend).toEqual([k(2)]);
    expect(plan.items).toEqual([{ id: "1:0xa", retire: [{ key: k(1), status: "superseded" }] }]);
  });

  it("handles a mix of all cases independently", () => {
    const plan = planSync(
      [ex(1, "1:0xa", "same"), ex(2, "1:0xb", "old"), ex(3, "1:0xc", "gone")],
      [fr("1:0xa", "same"), fr("1:0xb", "new"), fr("1:0xd", "added")],
    );
    expect(plan.extend).toEqual([k(1)]);
    expect(plan.items.map((i) => `${i.id}:${i.change?.changeType}`).sort()).toEqual(["1:0xb:modified", "1:0xc:removed", "1:0xd:added"]);
  });
});
