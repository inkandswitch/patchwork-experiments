// W1's golden half: water's evaluator, given the components sailing's
// spectrum made, answers every query on the golden grid exactly as sailing's
// ocean.js does (src/test/golden.json, a verbatim copy of sailing's
// src/test/ocean-golden.json, which sailing's own test pins its ocean.js to).
import { describe, expect, it } from "vitest";
import { createSurface } from "./surface.js";

import golden from "./test/golden.json";
const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => same(v, b[i])) : a === b);

describe("water's surface against the golden file", () => {
  it("covers the seas W1 names", () => {
    expect(golden.seas.map((s) => s.name)).toEqual(["Ship at sea", "Ship at anchor", "Cadboro Bay", "calm", "Harbour"]);
    expect(golden.seas.every((s) => s.samples.length === 64)).toBe(true);
  });
  for (const sea of golden.seas)
    it(`${sea.name}: every query on the grid, bit for bit`, () => {
      const o = createSurface(sea.components);
      let bad = 0;
      for (const s of sea.samples) {
        const { x, z, t } = s;
        if (!same(o.heightAt(x, z, t), s.height)) bad++;
        if (!same(o.sampleAt(x, z, t, [0, 0, 0, 0]), s.sample)) bad++;
        if (!same(o.normalAt(x, z, t, [0, 0, 0]), s.normal)) bad++;
        if (!same([-1, 0.5].map((y) => o.velocityAt(x, y, z, t, [0, 0, 0])), s.velocity)) bad++;
        if (!same(o.displaced(x, z, t, [0, 0, 0, 0]), s.displaced)) bad++;
      }
      expect(bad).toBe(0);
    });
});
