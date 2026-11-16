// The far hills as forest (forest.js farRoof): Ukee grey's fog, the roof's patches and clearcuts, and its toothed
// crests, checked on a made-up mountain at every node and over every vertex (finite, nothing random).
import { describe, it, expect } from "vitest";
import { forestRoof, farRoof, crestAt, inClearcut, patchAt, FAR_ROOF } from "./forest.js";
import { bakeStratus } from "./cloud.js";
import { hexToLinear } from "./glb.js";
import { COVER } from "./cover.js";
import { SKIES, LOOK } from "./ucluelet.js";

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// three.js's linear fog: (d - near) / (far - near), held to [0, 1]
const fogAt = (d, { near, far }) => Math.max(0, Math.min(1, (d - near) / (far - near)));

describe("Ukee grey's fog", () => {
  const fog = SKIES["ukee-grey"].fog;
  it("veils Ozzard (5 km) by at most 0.3 and the Mackenzie Range (15 km on) by at least 0.7, rising with distance (every km to 20)", () => {
    let last = -1;
    for (let km = 0; km <= 20; km++) {
      const f = fogAt(km * 1000, fog);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
      if (km <= 5) expect(f).toBeLessThanOrEqual(0.3);
      if (km >= 15) expect(f).toBeGreaterThanOrEqual(0.7);
    }
  });
});

// a made-up mountain: a 2.56 km square, 20 m apart, a 750 m peak with a ridge running off it, forest everywhere
const n = 129, cell = 20, x0 = 4000, z0 = -1200, N = n * n;
const grid = { n, cell, x0, z0 };
const heights = new Float32Array(N), label = new Int8Array(N).fill(1), cover = new Uint8Array(N).fill(COVER.wood), canopy = new Float32Array(N).fill(30), dist = new Float32Array(N).fill(1000);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const dx = i - 64, dz = j - 64;
  const r = Math.hypot(dx, dz) * cell;
  // a cone, a ridge along +x, and a gentle ripple, so there are summits, ridges and slopes of every steepness
  heights[j * n + i] = Math.max(5, 750 - r * 0.55 + Math.max(0, 120 - Math.abs(dz) * cell * 0.5) * (dx > 0 ? 1 : 0) + 6 * Math.sin(i * 0.9) * Math.cos(j * 0.7));
}

describe("the far roof (outside the skin's zone)", () => {
  const roofMask = new Uint8Array(N).fill(1);
  const fr = farRoof({ grid, heights, roof: roofMask });
  it("lifts every crest node by 4 to 9 m, and no other node", () => {
    let crests = 0;
    for (let k = 0; k < N; k++) {
      if (crestAt(k, n, heights)) {
        crests++;
        expect(fr.lift[k]).toBeGreaterThanOrEqual(FAR_ROOF.lift[0]);
        expect(fr.lift[k]).toBeLessThanOrEqual(FAR_ROOF.lift[1]);
      } else expect(fr.lift[k]).toBe(0);
    }
    expect(crests).toBeGreaterThan(20);
    expect(fr.crests).toBe(crests);
  });
  it("lifts nothing inside the skin's zone", () => {
    const under = new Uint8Array(N).fill(1);
    const inside = farRoof({ grid, heights, roof: roofMask, under });
    expect(inside.lift.every((v) => v === 0)).toBe(true);
    for (let k = 0; k < N; k += 7) expect(inside.colourOf(k)).toBe(null);
  });
  it("cuts about 8% of the land into clearcut blocks (every 10 m over a 10 km square: between 5% and 11%)", () => {
    let inCut = 0, all = 0;
    for (let z = -5000; z < 5000; z += 10) for (let x = -5000; x < 5000; x += 10) (all++, (inCut += inClearcut(x, z) ? 1 : 0));
    expect(inCut / all).toBeGreaterThan(0.05);
    expect(inCut / all).toBeLessThan(0.11);
  });
  it("spreads its patches over the whole range (every 30 m over a 6 km square: p10 under 0.3, p90 over 0.7)", () => {
    const v = [];
    for (let z = 0; z < 6000; z += 30) for (let x = 0; x < 6000; x += 30) v.push(patchAt(x, z));
    v.sort((a, b) => a - b);
    expect(v[Math.floor(v.length * 0.1)]).toBeLessThan(0.3);
    expect(v[Math.floor(v.length * 0.9)]).toBeGreaterThan(0.7);
  });
  it("draws a crest's vertex at its lift over the roof (every crest node in the mesh)", () => {
    const plain = forestRoof({ grid, heights, label, cover, canopy, dist, colours: LOOK.trees.roofColours, tolerance: 4 });
    const far = forestRoof({ grid, heights, label, cover, canopy, dist, colours: LOOK.trees.roofColours, tolerance: 4, far: {} });
    const at = (r) => {
      const m = new Map();
      for (let v = 0; v < r.positions.length / 3; v++) m.set(`${r.positions[v * 3]},${r.positions[v * 3 + 2]}`, r.positions[v * 3 + 1]);
      return m;
    };
    const a = at(plain), b = at(far);
    let seen = 0;
    for (let k = 0; k < N; k++) {
      const i = k % n, j = (k - i) / n;
      const key = `${x0 + i * cell},${z0 + j * cell}`;
      if (!b.has(key) || !a.has(key)) continue;
      const lifted = b.get(key) - a.get(key);
      if (fr.lift[k] > 0) (expect(lifted).toBeCloseTo(fr.lift[k], 3), seen++);
      else expect(lifted).toBeCloseTo(0, 3);
    }
    expect(seen).toBeGreaterThan(10);
  });
  it("reads as forest to the summit after the stratus: luminance p90/p10 at least 1.6, and no vertex lighter than the horizon (every roof vertex)", () => {
    const r = forestRoof({ grid, heights, label, cover, canopy, dist, colours: LOOK.trees.roofColours, jitter: LOOK.trees.roofJitter, far: LOOK.trees.far });
    bakeStratus(r.positions, r.colors, LOOK.clouds.bake);
    const L = [];
    for (let v = 0; v < r.colors.length / 3; v++) L.push(lum([r.colors[v * 3], r.colors[v * 3 + 1], r.colors[v * 3 + 2]]));
    L.sort((a, b) => a - b);
    expect(L[Math.floor(L.length * 0.9)] / L[Math.floor(L.length * 0.1)]).toBeGreaterThanOrEqual(1.6);
    const horizon = lum(hexToLinear(SKIES["ukee-grey"].sky.horizon));
    expect(L.at(-1)).toBeLessThanOrEqual(horizon);
  });
});

import { SCRUB_COLOURS, SKIN_LAYOUTS, crownsOf, EMERGENT } from "./forest.js";
describe("a ragged forest and salal, not a tree farm and tents", () => {
  const hsl = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const hue = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return { hue: (hue + 360) % 360, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  };
  it("colours salal and shore pine green and dark: every bush colour's hue 80–120°, none lighter than #3a4a2e", () => {
    for (const c of SCRUB_COLOURS) {
      const { hue, lum: l } = hsl(c);
      expect(hue).toBeGreaterThanOrEqual(80);
      expect(hue).toBeLessThanOrEqual(120);
      expect(l).toBeLessThanOrEqual(hsl("#3a4a2e").lum + 1e-12);
    }
  });
  it("stands every clump's crowns at heights spanning at least 0.3 of it, within 0.8 to 1.25 but for its emergents (every layout)", () => {
    for (const c of [3, 4]) for (const layout of SKIN_LAYOUTS[c]) {
      const k = crownsOf(layout).map((x) => x[2]);
      expect(Math.max(...k) - Math.min(...k)).toBeGreaterThanOrEqual(0.3 - 1e-9);
      for (const x of k) if (x < EMERGENT.at) (expect(x).toBeGreaterThanOrEqual(0.8), expect(x).toBeLessThanOrEqual(1.25));
      else expect(x).toBeLessThanOrEqual(1.5);
    }
  });
  it("makes about one crown in seven an emergent (every crown of every layout: between 1 in 9 and 1 in 5)", () => {
    const all = [3, 4].flatMap((c) => SKIN_LAYOUTS[c].flatMap((l) => crownsOf(l).map((x) => x[2])));
    const share = all.filter((x) => x >= EMERGENT.at).length / all.length;
    expect(share).toBeGreaterThan(1 / 9);
    expect(share).toBeLessThan(1 / 5);
  });
});
