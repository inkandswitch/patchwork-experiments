// W1's golden file (probes/ocean-golden.mjs, recorded from sailing's own
// evaluator before it moved to the water package): sailing's spectrum
// (ocean.js, which runs) makes exactly the recorded components, and the copy
// of water's evaluator its fakes use (test/surface.js) answers every query on
// the grid exactly as recorded. water/ keeps a verbatim copy of the file its
// surface.js is checked against, so the fakes and the real reader agree bit
// for bit.
import { describe, expect, it } from "vitest";
import { seaWaves } from "./ocean.js";
import { createOcean } from "./test/ocean.js";

import golden from "./test/ocean-golden.json";
const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => same(v, b[i])) : a === b);

describe("sailing's spectrum and its fakes' evaluator against the golden file", () => {
  for (const sea of golden.seas)
    it(`${sea.name}: the same components, and every query on the grid, exactly`, () => {
      expect(JSON.parse(JSON.stringify(seaWaves(sea).components))).toEqual(sea.components);
      const o = createOcean(sea);
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
