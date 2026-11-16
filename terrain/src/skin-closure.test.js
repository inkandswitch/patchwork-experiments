// The forest's skin closes the canopy from above, and carries the coast's two signature silhouettes:
// every layout of every profile, every quarter turn, every neighbourhood of one layout, checked on a
// 20 × 20 sample of the cell (finite enumeration, nothing random).
import { describe, it, expect } from "vitest";
import { SKIN_LAYOUTS, SKIN_PROFILES, PROFILE_NAMES, LAYOUT_WEIGHTS, SKIN_COLOURS, SPRUCE, SNAG, CROWN_VALUE, crownsOf, crownRadius, pickLayout, skinMesh, skinAt, skinZone, clumpOf, CROWN_SHAPES, CROWN_SHADE, crownShape, crownTriangles , EMERGENT, BUSH, BUSH_HEIGHT } from "./forest.js";
import { hexToLinear } from "./glb.js";
import { COVER } from "./cover.js";

const cell = 20;
const TURNS = [0, 1, 2, 3].map((q) => (q * Math.PI) / 2);
/** The crowns' footprints ([x, z, r]) of a clump of layout (crowns, v) turned by yaw, at width 1 (the least), its node at (dx, dz). */
function footprints(profile, crowns, v, yaw, dx, dz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return crownsOf(SKIN_LAYOUTS[crowns][v]).map(([u, w], q) => {
    const x = u * cell, z = w * cell;
    return [dx + x * c - z * s, dz + x * s + z * c, crownRadius(profile, q, v)];
  });
}
/** The layouts a profile uses: its own crown count, else the place's 3 or 4. */
const layoutsOf = (p) => {
  const [lo, hi] = SKIN_PROFILES[p].crowns ?? [3, 4];
  const out = [];
  for (let c = lo; c <= hi; c++) for (let v = 0; v < SKIN_LAYOUTS[c].length; v++) out.push([c, v]);
  return out;
};

describe("the canopy is closed from above", () => {
  it("covers at least 90% of every cell with crowns, for every layout and quarter turn, among neighbours of any one layout and turn (every profile)", () => {
    for (const p of PROFILE_NAMES) {
      let worst = 1;
      for (const [c, v] of layoutsOf(p)) for (const yaw of TURNS) {
        const own = footprints(p, c, v, yaw, 0, 0);
        for (const [nc, nv] of layoutsOf(p)) for (const nyaw of TURNS) {
          const all = [...own];
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) all.push(...footprints(p, nc, nv, nyaw, di * cell, dj * cell));
          let inside = 0;
          for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) {
            const x = -cell / 2 + ((a + 0.5) * cell) / 20, z = -cell / 2 + ((b + 0.5) * cell) / 20;
            if (all.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 <= r * r)) inside++;
          }
          worst = Math.min(worst, inside / 400);
        }
      }
      expect(worst, p).toBeGreaterThanOrEqual(0.9);
    }
  });
  it("keeps every crown inside its own cell's reach of 0.3 of a cell (crowns interlock with the neighbours')", () => {
    for (const c of [3, 4]) for (const layout of SKIN_LAYOUTS[c]) for (const [u, v] of layout) {
      expect(Math.abs(u)).toBeLessThanOrEqual(0.3);
      expect(Math.abs(v)).toBeLessThanOrEqual(0.3);
    }
  });
});

describe("the coast's silhouettes: Sitka spruce and dead snags", () => {
  // the share of crowns a node's hash makes each, exactly, from the layouts' weights
  const shares = (c) => {
    const w = LAYOUT_WEIGHTS[c], total = w.reduce((a, b) => a + b, 0);
    let crowns = 0, spruce = 0, snags = 0;
    SKIN_LAYOUTS[c].forEach((l, v) => {
      crowns += (w[v] / total) * crownsOf(l).length;
      spruce += (w[v] / total) * l.filter((x) => x[3] === "spruce").length;
      snags += (w[v] / total) * l.filter((x) => x[3] === "snag").length;
    });
    return { spruce: spruce / crowns, snag: snags / crowns };
  };
  it("makes about one crown in ten a spruce and about one in thirty a snag (each crown count)", () => {
    for (const c of [3, 4]) {
      const s = shares(c);
      expect(s.spruce).toBeGreaterThanOrEqual(1 / 13);
      expect(s.spruce).toBeLessThanOrEqual(1 / 7.5);
      expect(s.snag).toBeGreaterThanOrEqual(1 / 45);
      expect(s.snag).toBeLessThanOrEqual(1 / 22);
    }
  });
  it("picks each layout over exactly its weight's share of the hash (every boundary)", () => {
    for (const c of [3, 4]) {
      const w = LAYOUT_WEIGHTS[c], total = w.reduce((a, b) => a + b, 0);
      let at = 0;
      w.forEach((x, v) => {
        expect(pickLayout(c, at / total + 1e-9)).toBe(v);
        at += x;
        expect(pickLayout(c, at / total - 1e-9)).toBe(v);
      });
      expect(pickLayout(c, 0.999999999)).toBe(w.length - 1);
    }
  });
  it("draws a spruce lighter and 15% taller, a snag a grey spike over the canopy, and every other crown within ±12% of its colour (every layout, every profile)", () => {
    const lin = SKIN_COLOURS.map((h) => hexToLinear(h).slice(0, 3));
    const spruce = hexToLinear(SPRUCE.colour).slice(0, 3);
    const snag = hexToLinear(SNAG.colour).slice(0, 3);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(spruce)).toBeGreaterThan(Math.max(...lin.map(lum)));
    for (const p of PROFILE_NAMES) for (const c of [3, 4]) SKIN_LAYOUTS[c].forEach((layout, v) => {
      const m = skinMesh(c, v, cell, SKIN_COLOURS, p);
      const plain = !!SKIN_PROFILES[p].plain;
      let off = 0;
      layout.forEach(([, , k, sign], e) => {
        if (sign === "snag") {
          if (plain) return;
          // a snag's 8 triangles: grey, ±20% shading, its top SNAG.top
          for (let t = 0; t < 8; t++) {
            const col = [m.colors[(off + t) * 9], m.colors[(off + t) * 9 + 1], m.colors[(off + t) * 9 + 2]];
            const f = col[0] / snag[0];
            expect(f).toBeGreaterThanOrEqual(0.8 - 1e-6);
            expect(f).toBeLessThanOrEqual(1.1 + 1e-6);
          }
          off += 8;
          return;
        }
        // a crown's triangles: its base colour ±12%, shaded from CROWN_SHADE[0] at its foot to CROWN_SHADE[1] at its tip, with the baked side shading (0.82 to 1.12)
        const base = !plain && sign === "spruce" ? [spruce] : lin;
        const n = crownTriangles(crownShape(plain, sign, c, v, e - layout.slice(0, e).filter((x) => x[3] === "snag").length), !plain && k >= EMERGENT.at);
        let top = -Infinity;
        for (let t = 0; t < n * 3; t++) {
          const col = [m.colors[off * 9 + t * 3], m.colors[off * 9 + t * 3 + 1], m.colors[off * 9 + t * 3 + 2]];
          expect(base.some((b) => { const f = col[1] / b[1]; return f >= CROWN_SHADE[0] * 0.82 * (1 - CROWN_VALUE) - 1e-6 && f <= CROWN_SHADE[1] * 1.12 * (1 + CROWN_VALUE) + 1e-6 && Math.abs(col[0] / b[0] - f) < 1e-4; })).toBe(true);
          top = Math.max(top, m.positions[off * 9 + t * 3 + 1]);
        }
        const tall = k * (!plain && sign === "spruce" ? SPRUCE.taller : 1);
        expect(top).toBeLessThanOrEqual(tall + 1e-6);
        expect(top).toBeGreaterThanOrEqual(tall * 0.95 - 1e-6);
        off += n;
      });
      expect(off * 9).toBe(m.positions.length);
    });
  });
});

describe("shore pine and salal where the canopy is 1 to 5 m", () => {
  // a 9 × 9 headland, all scrub cover, its canopy 0.5…8 m by node; the middle 3 × 3 built on
  const n = 9, N = n * n, grid = { n, cell, x0: 0, z0: 0 };
  const label = new Int8Array(N).fill(1), cover = new Uint8Array(N).fill(COVER.scrub), canopy = new Float32Array(N), dist = new Float32Array(N).fill(100), built = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    canopy[k] = 0.5 + (k % 16) * 0.5;
    const i = k % n, j = (k - i) / n;
    if (i >= 3 && i <= 5 && j >= 3 && j <= 5) built[k] = 1;
  }
  const zone = skinZone(grid, [{ x: 80, z: 80, radius: 1000 }]);
  const skin = { crowns: [3, 4], all: true, scrub: { min: 1 } };
  const clumps = skinAt({ grid, label, cover, canopy, dist, zone, skin, built });
  it("stands a clump of four bushes on every unbuilt node whose canopy is 1 to 5 m, and none elsewhere but the forest's (every node)", () => {
    const by = new Map(clumps.map((c) => [c.k, c]));
    for (let k = 0; k < N; k++) {
      const scrub = !built[k] && canopy[k] >= 1 && canopy[k] <= 5;
      expect(by.get(k)?.profile === "scrub", `node ${k}`).toBe(scrub);
      if (scrub) {
        expect(by.get(k).crowns).toBe(4);
        expect(clumpOf(k, { n, label, cover, canopy, dist, zone, skin, built })).toBe("scrub");
        // a bush 1 to 3 m over the ground, whatever the canopy (BUSH_HEIGHT, ±8%)
        expect(by.get(k).height).toBeGreaterThanOrEqual(BUSH_HEIGHT.min * 0.92 - 1e-9);
        expect(by.get(k).height).toBeLessThanOrEqual(3.2);
      }
    }
  });
});

describe("crowns that aren't cones: cedar, hemlock and spruce", () => {
  it("keeps every vertex of every crown inside its own radius and between its foot and its tip, its shape's triangle count fixed (every shape, profile and layout)", () => {
    const seen = new Set();
    for (const p of PROFILE_NAMES) for (const c of [3, 4]) SKIN_LAYOUTS[c].forEach((layout, v) => {
      const m = skinMesh(c, v, cell, SKIN_COLOURS, p);
      const pr = SKIN_PROFILES[p], plain = !!pr.plain;
      let off = 0, q = 0;
      for (const [u, w, k, sign] of layout) {
        if (sign === "snag") { if (!plain) off += 8; continue; }
        const shape = crownShape(plain, sign, c, v, q);
        seen.add(shape);
        const emergent = !plain && k >= EMERGENT.at;
        const n = crownTriangles(shape, emergent), r = crownRadius(p, q, v, k), tall = k * (!plain && sign === "spruce" ? SPRUCE.taller : 1);
        expect(n).toBe(shape ? CROWN_SHAPES[shape].tiers.length * 6 + (emergent && shape === "cedar" ? 12 : 0) : BUSH.sides * (2 * (BUSH.rings.length - 1) + 1));
        for (let t = 0; t < n * 3; t++) {
          const x = m.positions[off * 9 + t * 3], y = m.positions[off * 9 + t * 3 + 1], z = m.positions[off * 9 + t * 3 + 2];
          expect(Math.hypot(x - u * cell, z - w * cell)).toBeLessThanOrEqual(r + 1e-4);
          // an emergent's foot no higher than an ordinary crown's
          expect(y).toBeGreaterThanOrEqual(pr.foot * (plain ? tall : Math.min(tall, 1)) - 1e-6);
          expect(y).toBeLessThanOrEqual(tall + 1e-6);
        }
        off += n;
        q++;
      }
      expect(off * 9).toBe(m.positions.length);
    });
    // all three conifers and the plain bush are drawn somewhere
    expect([...seen].sort()).toEqual(["cedar", "hemlock", "spruce", null].sort());
  });
  it("shades every crown darker at its foot than at its tip: the gaps between crowns read as shadow", () => {
    const m = skinMesh(4, 0, cell, SKIN_COLOURS, "roof");
    // the lowest vertex's green against the highest's, within the first crown
    let lo = [Infinity, 0], hi = [-Infinity, 0];
    const n = crownTriangles(crownShape(false, undefined, 4, 0, 0));
    for (let t = 0; t < n * 3; t++) {
      const y = m.positions[t * 3 + 1], g = m.colors[t * 3 + 1];
      if (y < lo[0]) lo = [y, g];
      if (y > hi[0]) hi = [y, g];
    }
    expect(lo[1]).toBeLessThan(hi[1] * 0.75);
  });
});
