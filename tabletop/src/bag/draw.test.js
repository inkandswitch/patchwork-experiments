import { describe, it, expect } from "vitest";
import { DEFAULT_RULE, RULES, drawIndex, replaces, ruleOf } from "./draw.js";

describe("the draw rules", () => {
  it("every rule, over every small bag, can take every item (and only an item)", () => {
    for (const { value: rule } of RULES) {
      for (let n = 1; n <= 6; n++) {
        // every value random() can give, to the resolution that matters: each item's whole share, its edges included
        const taken = new Set();
        for (let k = 0; k < n; k++) for (const r of [k / n, (k + 0.5) / n, (k + 1) / n - 1e-12]) taken.add(drawIndex(rule, n, () => r));
        for (const i of taken) expect(Number.isInteger(i) && i >= 0 && i < n).toBe(true);
        if (rule === "top") {
          // last in, first out: draining the bag takes each item once, newest first
          const order = [];
          for (let left = n; left > 0; left--) order.push(drawIndex(rule, left, () => 0.3));
          expect(order).toEqual(Array.from({ length: n }, (_, i) => n - 1 - i));
        } else {
          expect([...taken].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
        }
      }
    }
  });

  it("an empty bag gives nothing, and a random source out of range still gives an item", () => {
    for (const { value: rule } of RULES) {
      expect(drawIndex(rule, 0)).toBe(-1);
      expect(drawIndex(rule, -1)).toBe(-1);
      expect(drawIndex(rule, 1.5)).toBe(-1);
      for (const r of [1, 7, -3, NaN, Infinity]) {
        const i = drawIndex(rule, 4, () => r);
        expect(i >= 0 && i < 4).toBe(true);
      }
    }
  });

  it("a doc names its rule; one this version doesn't know reads as the default", () => {
    expect(ruleOf({ rule: "top" })).toBe("top");
    expect(ruleOf({ rule: "random-replace" })).toBe("random-replace");
    for (const doc of [{}, null, { rule: "sideways" }, { rule: 3 }]) expect(ruleOf(doc)).toBe(DEFAULT_RULE);
    expect(RULES.map((r) => [r.value, replaces(r.value)])).toEqual([["random", false], ["random-replace", true], ["top", false]]);
  });
});
