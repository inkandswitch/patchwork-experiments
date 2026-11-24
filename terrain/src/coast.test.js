import { describe, it, expect } from "vitest";
import { joinCoast, classify, openEnds, LAND, WATER } from "./coast.js";
import { burn, burnHeights, checkSigns, nodesInside, QUALITY } from "./burn.js";
import { ringArea2 } from "./shapes.js";

// A 33 × 33 grid, 8 m apart: x, z in 0…256.
const grid = { n: 33, cell: 8, x0: 0, z0: 0 };
const N = grid.n * grid.n;
const nodeXZ = (at) => [grid.x0 + (at % grid.n) * grid.cell, grid.z0 + Math.floor(at / grid.n) * grid.cell];

/** Even-odd point in polygon: the independent answer the classification is checked against. */
function inside([x, z], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** An island ring with the land on its left (counter-clockwise seen from above). */
const island = (ring) => (ringArea2(ring) > 0 ? ring : ring.slice().reverse());
/** Ways for a ring, cut at `cuts` (indices), joined by node ids `base`+k; given in a shuffled order. */
function ringWays(ring, cuts, base, id) {
  const ids = ring.map((_, k) => base + k);
  const ways = [];
  const at = [...cuts, ring.length];
  for (let w = 0; w < cuts.length; w++) {
    const from = at[w], to = at[w + 1];
    const idx = [];
    for (let k = from; k <= to; k++) idx.push(k % ring.length);
    ways.push({ id: `${id}/${w}`, a: ids[idx[0]], b: ids[idx.at(-1)], points: idx.map((k) => ring[k]) });
  }
  return ways.reverse();
}

// Shapes off the lattice (no node lies on a shore): a concave L, a sharp star, a thin spit.
const L = island([[40.3, 40.7], [120.2, 40.9], [119.7, 80.1], [80.4, 80.6], [80.9, 150.3], [40.6, 150.2]]);
const STAR = island(Array.from({ length: 14 }, (_, k) => {
  const r = k % 2 ? 14.3 : 46.1, a = (k * Math.PI) / 7 + 0.05;
  return [190.37 + r * Math.cos(a), 70.21 + r * Math.sin(a)];
}));
const SPIT = island([[150.13, 180.4], [235.7, 182.9], [236.2, 190.1], [150.4, 188.2]]);
// the mainland: an open chain right across the grid (ends 60 m beyond it), land to its south (+z)
const MAIN = [[320.4, 230.6], [200.2, 214.7], [130.7, 236.9], [60.1, 205.3], [-60.8, 225.2]];
const mainLand = [...MAIN, [-60.8, 400], [320.4, 400]];

const ways = [...ringWays(L, [0, 2, 4], 1000, "way/L"), ...ringWays(STAR, [0, 5], 2000, "way/star"), ...ringWays(SPIT, [0], 3000, "way/spit"), { id: "way/main1", a: 1, b: 2, points: MAIN.slice(0, 3) }, { id: "way/main2", a: 2, b: 3, points: MAIN.slice(2) }];

describe("joinCoast", () => {
  it("joins ways by their end nodes into closed rings and open chains, whatever order they come in", () => {
    const chains = joinCoast(ways);
    expect(chains.filter((c) => c.closed).length).toBe(3);
    expect(chains.filter((c) => !c.closed).length).toBe(1);
    const main = chains.find((c) => !c.closed);
    expect(main.points).toEqual(MAIN);
    const l = chains.find((c) => c.ids.some((i) => i.startsWith("way/L")));
    expect(l.points.length).toBe(L.length);
    expect(openEnds(chains).map((e) => e.point)).toEqual([MAIN[0], MAIN.at(-1)]);
  });
  it("refuses a coastline that forks", () => {
    expect(() => joinCoast([{ id: "w1", a: 1, b: 2, points: [[0, 0], [1, 1]] }, { id: "w2", a: 1, b: 3, points: [[0, 0], [2, 1]] }])).toThrow(/forks/);
  });
});

describe("classify: every node against an independent point-in-polygon", () => {
  const cls = classify(grid, joinCoast(ways));

  it("labels every node, with no problems", () => {
    expect(cls.problems).toEqual([]);
    expect(cls.stats.unknown).toBe(0);
    expect(cls.stats.conflicts).toBe(0);
  });

  it(`gets all ${N} nodes right: land inside an island or south of the mainland shore, water elsewhere`, () => {
    const wrong = [];
    for (let at = 0; at < N; at++) {
      const p = nodeXZ(at);
      const land = [L, STAR, SPIT, mainLand].some((r) => inside(p, r));
      if (cls.label[at] !== (land ? LAND : WATER)) wrong.push(p);
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the distance to the shore for nodes within the band, and only those", () => {
    for (let at = 0; at < N; at++) {
      if (Number.isFinite(cls.dist[at])) expect(cls.dist[at]).toBeLessThanOrEqual(cls.band);
    }
    expect(cls.stats.band).toBeGreaterThan(100);
  });

  it("says when the coastline stops inside the grid", () => {
    const cut = classify(grid, joinCoast([{ id: "way/short", a: 1, b: 2, points: [[100.3, 120.1], [-50, 120.1]] }]));
    expect(cut.problems.join(" ")).toMatch(/open end/);
  });

  it("says when an island runs the wrong way round (water inside, land out)", () => {
    const wrongWay = ways.filter((w) => !w.id.startsWith("way/spit")).concat(ringWays(SPIT.slice().reverse(), [0], 3000, "way/spit"));
    const bad = classify(grid, joinCoast(wrongWay));
    expect(bad.stats.conflicts).toBeGreaterThan(0);
    expect(bad.problems.join(" ")).toMatch(/both land and water/);
  });
});

describe("burnHeights: the shore where OSM draws it", () => {
  // a straight shore at an angle: land to its south-west
  const A = [-40.3, 300.6], B = [300.2, -20.9];
  const shore = [{ id: "way/s", a: 1, b: 2, points: [B, A] }];
  const cls = classify(grid, joinCoast(shore));
  // a DEM that disagrees with OSM everywhere near the shore (+3 m in the water, −3 m on land)
  const dem = new Int16Array(N);
  for (let at = 0; at < N; at++) dem[at] = cls.label[at] > 0 ? -150 : 150;
  const heights = burnHeights(grid, dem, { scale: 0.02 }, cls);

  it("puts every land node above the water and every water node below it", () => {
    expect(cls.problems).toEqual([]);
    expect(checkSigns(heights, cls.label)).toEqual([]);
  });

  it("crosses y = 0 within half a metre of the OSM shore on every grid edge that crosses it", () => {
    const dx = A[0] - B[0], dz = A[1] - B[1], len = Math.hypot(dx, dz);
    const off = ([x, z]) => Math.abs((x - B[0]) * dz - (z - B[1]) * dx) / len;
    let edges = 0, worst = 0;
    for (let at = 0; at < N; at++) {
      const [x, z] = nodeXZ(at);
      for (const nb of [x + grid.cell <= 256 ? at + 1 : -1, z + grid.cell <= 256 ? at + grid.n : -1]) {
        if (nb < 0 || cls.label[at] === cls.label[nb]) continue;
        const h1 = heights[at], h2 = heights[nb];
        const t = h1 / (h1 - h2);
        const [x2, z2] = nodeXZ(nb);
        worst = Math.max(worst, off([x + t * (x2 - x), z + t * (z2 - z)]));
        edges++;
      }
    }
    expect(edges).toBeGreaterThan(40);
    expect(worst).toBeLessThan(0.5);
  });

  it("follows the DEM away from the shore, held to its side of the water: land above the highest tide, water below the band's slope", () => {
    const far = (at) => cls.dist[at] === Infinity;
    const { quality } = burn(grid, dem, { scale: 0.02 }, cls);
    let n = 0;
    for (let at = 0; at < N; at++) {
      if (!far(at)) continue;
      n++;
      // the DEM is on the wrong side everywhere here, so the floor holds: land +1.5 m (default), water −slope·band; and says so
      if (cls.label[at] > 0) {
        expect(heights[at] * 0.02).toBeCloseTo(1.5, 9);
        expect(quality[at]).toBe(QUALITY.RAISED);
      } else {
        expect(heights[at] * 0.02).toBeCloseTo(-0.05 * cls.band, 1);
        expect(quality[at]).toBe(QUALITY.CLAMPED);
      }
    }
    expect(n).toBeGreaterThan(500);
  });

  it("keeps the DEM where it is on its side beyond the floors, and calls it measured", () => {
    const good = new Int16Array(N);
    for (let at = 0; at < N; at++) good[at] = cls.label[at] > 0 ? 400 : -400; // ±8 m
    const { heights: h, quality, agreement } = burn(grid, good, { scale: 0.02 }, cls);
    for (let at = 0; at < N; at++) {
      if (cls.dist[at] <= cls.band) expect(quality[at]).toBe(QUALITY.SHORE);
      else expect([h[at], quality[at]]).toEqual([cls.label[at] * 400, QUALITY.DEM]);
    }
    expect(agreement.share).toBe(1);
    expect(burn(grid, dem, { scale: 0.02 }, cls).agreement.share).toBe(0);
  });
});

describe("islets: every OSM ring with a node in it clears the highest tide; a ring with none is a rock", () => {
  // open water everywhere (a DEM of −5 m), and rings of every size from a single node's worth up
  const sea = new Int16Array(N).fill(-250);
  const square = (cx, cz, r) => island([[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]]);
  const rings = [
    ["way/one-node", square(40.5, 40.5, 4)], // holds node (40, 40) only
    ["way/four-nodes", square(124, 44, 7)], // 2 × 2 nodes, all within a cell of the shore
    ["way/narrow", island([[160.2, 100.3], [230.4, 100.6], [230.1, 110.2], [160.6, 109.9]])], // 9.6 m wide, 70 long: one row of nodes
    ["way/between", square(204, 36, 2.5)], // no node inside: a rock
    ["way/big", square(100, 190, 40)], // nodes beyond the band: the land floor holds it up
  ];
  const ways = rings.map(([id, r], k) => ({ id, a: 9000 + k, b: 9000 + k, points: [...r, r[0]] }));
  const chains = joinCoast(ways);
  const cls = classify(grid, chains);
  const out = burn(grid, sea, { scale: 0.02 }, cls, chains, { landFloor: 1.5 });

  it("classifies them with no problems", () => {
    expect(cls.problems).toEqual([]);
    expect(checkSigns(out.heights, cls.label)).toEqual([]);
  });

  it("gives every ring with a node inside a top at or above the land floor, checked at every inside node", () => {
    expect(out.islets.low).toEqual([]);
    for (const [id, r] of rings) {
      const inside = nodesInside(grid, r);
      // the scanline's inside is the independent point-in-polygon's, node for node
      const pip = [];
      for (let at = 0; at < N; at++) if (inside_(nodeXZ(at), r)) pip.push(at);
      expect(inside.sort((a, b) => a - b)).toEqual(pip);
      if (!inside.length) continue;
      expect(Math.max(...inside.map((at) => out.heights[at] * 0.02)), id).toBeGreaterThanOrEqual(1.5);
      for (const at of inside) expect(cls.label[at]).toBe(LAND);
    }
    expect(out.islets.raised.map((r) => r.id).sort()).toEqual(["way/four-nodes", "way/narrow", "way/one-node"]);
  });

  it("returns a ring with no node as a rock, its outline and a top above the land floor", () => {
    expect(out.islets.rocks.map((r) => r.id)).toEqual(["way/between"]);
    expect(out.islets.rocks[0].top).toBe(1.5);
    expect(out.islets.rocks[0].points.length).toBe(4);
  });
});

const inside_ = inside;
