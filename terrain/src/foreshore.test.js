// Ucluelet's foreshore (look.bands, palette.js withBands): wet black rock and olive rockweed under a thin barnacle band,
// not a neutral grey seawall, at every centimetre of the intertidal, on every cover (finite).
import { describe, it, expect } from "vitest";
import { groundRGB, bands, withBands, COLOURS, linear } from "./palette.js";
import { shoreSlabs } from "./shore.js";
import { COVER } from "./cover.js";
import { DATUM, LOOK } from "./ucluelet.js";

const tide = withBands(DATUM.tide, LOOK.bands);
const colours = { ...COLOURS, ...LOOK.colours };
const sat = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
const lum = (c) => {
  const l = linear(c);
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe("Ucluelet's foreshore", () => {
  it("puts the rockweed from mean water to half a metre under MHHW, the barnacles over it to MHHW", () => {
    const b = Object.fromEntries(bands(tide).map(([top, key]) => [key, top]));
    expect(b.mussel).toBe(0);
    expect(b.rockweed).toBeCloseTo(DATUM.tide.MHHW - 0.5, 9);
    expect(b.barnacle).toBe(DATUM.tide.MHHW);
    // the tide alone where a look says nothing
    expect(withBands(DATUM.tide, null)).toBe(DATUM.tide);
  });
  it("colours every intertidal height (each centimetre from MLLW to MHHW, every cover but a beach, at the shore) at least 0.1 saturated, and none but the barnacles' lighter than the rockweed", () => {
    const weedTop = tide.weedTop, weed = lum(hex(LOOK.colours.rockweed));
    for (let c = Math.round(DATUM.tide.MLLW * 100); c <= Math.round(DATUM.tide.MHHW * 100); c++) {
      const h = c / 100;
      for (const cover of Object.values(COVER)) {
        if (cover === COVER.beach) continue;
        const rgb = groundRGB(h, cover, 0, tide, colours, -1, true, { shoreRock: true });
        expect(sat(rgb), `${h} m`).toBeGreaterThanOrEqual(0.1);
        if (h <= weedTop) expect(lum(rgb), `${h} m`).toBeLessThanOrEqual(weed + 1e-9);
      }
    }
  });
  it("cuts the shore's crisp slabs at the same levels, the rockweed's the first over the water, dry", () => {
    const slabs = shoreSlabs(tide);
    const weed = slabs.find((s) => s.key === "rockweed");
    // the first slab over the water (the water is drawn at mean water: what's under it isn't cut)
    expect(slabs[0]).toBe(weed);
    expect(weed.hi).toBeCloseTo(DATUM.tide.MHHW - 0.5, 9);
    expect(weed.wet).toBe(false);
  });
});

import { blackRockMask } from "./build.js";
describe("black rock on the exposed coast (look.blackRock)", () => {
  // a 21 × 21 grid 20 m apart: sea west of x = 0, land rising 1 m a cell east of it; coast pieces along x = 0, the south half exposed
  const n = 21, cell = 20, x0 = -200, z0 = -200, grid = { n, cell, x0, z0 };
  const h = new Float32Array(n * n), toWater = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * cell;
    h[j * n + i] = x < 0 ? -3 : 0.5 + x / cell;
    toWater[j * n + i] = x < 0 ? 0 : x + cell / 2;
  }
  const pieces = Array.from({ length: n - 1 }, (_, q) => ({ a: [-10, z0 + q * cell], b: [-10, z0 + (q + 1) * cell], exposure: q >= 10 ? 0.9 : 0.4 }));
  const br = { ...LOOK.blackRock, within: [] };
  const mask = blackRockMask(grid, h, toWater, pieces, br);
  it("blackens exactly the land under 8 m within 25 m of the water and of an exposed piece (every node)", () => {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i * cell, z = z0 + j * cell;
      const near = pieces.some((p) => p.exposure > br.exposure && Math.hypot(x - (p.a[0] + p.b[0]) / 2, z - (p.a[1] + p.b[1]) / 2) <= br.reach + cell / 2);
      expect(mask[k], `${i},${j}`).toBe(h[k] > 0 && h[k] < br.below && toWater[k] <= br.reach && near ? 1 : 0);
    }
    expect(mask.some((v) => v)).toBe(true);
  });
  it("paints it no lighter than #2a2a28, with its ±8% (the darkest of the shore)", () => {
    const l = (c) => lum(hex(c));
    expect(l(br.colour) * 1.08).toBeLessThanOrEqual(l("#2a2a28"));
  });
});
