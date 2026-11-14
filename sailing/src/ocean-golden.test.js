// W1's golden file (probes/ocean-golden.mjs): sailing's ocean.js answers
// every query on its grid exactly as recorded, and water/ keeps a verbatim
// copy its own evaluator is checked against, so the two agree bit for bit.
import { describe, expect, it } from "vitest";
import { createOcean } from "./ocean.js";

import golden from "./test/ocean-golden.json";
const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => same(v, b[i])) : a === b);

describe("sailing's ocean.js against the golden file", () => {
  for (const sea of golden.seas)
    it(`${sea.name}: the same components, and every query on the grid, exactly`, () => {
      const o = createOcean(sea);
      expect(JSON.parse(JSON.stringify(o.components))).toEqual(sea.components);
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
