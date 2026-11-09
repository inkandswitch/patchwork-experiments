// The stock sloop's navmesh, checked statically (DESIGN.md, "Static
// checks"): her triangles straight from ship.js, as the crew gathers them
// from her GLBs in play, baked once, then C1–C9 over every cell, side and
// link. No walking.
import { describe, it, expect, beforeAll } from "vitest";
import { bake, boxTriangles, pointOf } from "./navmesh.js";
import { checkAgainst, indexTriangles, rebaker, shuffleTriangles, staticChecks } from "./navcheck.js";
import { DECK } from "./walk.js";
import { FIT, deckAt, halfBreadthAt } from "./ship.js";
import { partTriangles, sloopSeeds, sloopTriangles } from "./test/sloop.js";

let triangles;
let seeds;
let mesh;
let bakeMs;
let report;

beforeAll(() => {
  triangles = sloopTriangles();
  seeds = sloopSeeds();
  bakeMs = Infinity;
  // CPU time, not wall time: the suite's files run side by side, and a bake that waits for a core isn't a slow bake
  for (let k = 0; k < 3; k++) {
    const t0 = process.cpuUsage();
    mesh = bake({ triangles, seeds }, DECK);
    const d = process.cpuUsage(t0);
    bakeMs = Math.min(bakeMs, (d.user + d.system) / 1000);
  }
  report = staticChecks(mesh, triangles, { rebake: rebaker({ triangles, seeds }), shuffled: () => bake({ triangles: shuffleTriangles(triangles, 7), seeds }, DECK) });
}, 120_000);

const check = (name) => () => {
  const c = Object.entries(report.checks).find(([k]) => k.startsWith(name));
  expect(c, name).toBeTruthy();
  expect(c[1].ok, `${c[0]}: ${JSON.stringify(c[1].detail).slice(0, 800)}`).toBe(true);
};

describe("the sloop's navmesh", () => {
  it("bakes in time (DESIGN.md: about 13.6k triangles under 50 ms on a quiet machine; this fails at 500)", () => {
    expect(triangles.length / 9).toBeGreaterThan(10_000);
    expect(bakeMs).toBeLessThan(500);
  });
  it("C1: spawn, the helm's, the mainsheet's, the mast's and the windlass's stand spots and the ladder's top are on kept cells, where asked", check("C1"));
  it("C2: every kept cell, and every link, is reachable on foot from spawn", check("C2"));
  it("C3: nothing dropped that you could walk or jump to", check("C3"));
  it("C4: every side of every cell has exactly one record; B1, B3, B4, B5", check("C4"));
  it("C5: B2 and B7, recomputed by brute force from the triangles at every cell and along every vault band", check("C5"));
  it("C6: no kept cell lies inside her closed hull (ray parity, three directions)", check("C6"));
  it("C7: stable: rebaked at step 0.56 and 0.60, radius 0.23 and 0.27, C1 and C2 still hold", check("C7"));
  it("C8: no OPEN side anywhere (you never walk off her); every way overboard is a WALL above the step, and a jump clears it on both sides", check("C8"));
  it("C5 reads the headroom: a bake that overstates it (every cell open to the sky) or understates it fails", () => {
    const finite = [];
    for (let a = 0; a < mesh.count; a++) if (Number.isFinite(mesh.cells.headroom[a])) finite.push(a);
    expect(finite.length).toBeGreaterThan(1000);
    const index = indexTriangles(triangles);
    const withRoom = (f) => ({ ...mesh, cells: { ...mesh.cells, headroom: Float32Array.from(mesh.cells.headroom, f) } });
    const over = checkAgainst(withRoom(() => Infinity), index, { limit: 5 });
    expect(over.length).toBeGreaterThan(0);
    expect(over[0]).toMatch(/^B2: /);
    const under = checkAgainst(withRoom((h) => (Number.isFinite(h) ? h * 0.5 : h)), index, { limit: 5 });
    expect(under.some((m) => m.startsWith("headroom: "))).toBe(true);
  }, 60_000);
  it("C9: two bakes of the same triangles are byte-identical, in any order", check("C9"));

  it("spawn is on the cockpit sole aft of the wheel; the cockpit's rise to the deck is a STEP there", () => {
    const spawn = mesh.links.find((l) => l.kind === "spawn");
    const p = pointOf(mesh, spawn.at.cell, spawn.at.u, spawn.at.v);
    expect(p[1]).toBeCloseTo(0.72, 3);
    expect(p[2]).toBeGreaterThan(4.25);
    // the sole aft of the wheel steps straight up to the deck to port, to starboard and aft (0.52–0.55 up)
    const up = { 0: [], 1: [], 3: [] };
    for (let a = 0; a < mesh.count; a++) {
      const [, y, z] = pointOf(mesh, a, 0.5, 0.5);
      if (Math.abs(y - 0.72) > 0.005 || z < 4.4) continue;
      for (const s of [0, 1, 3]) {
        if (mesh.side.kind[a * 4 + s] !== 0) continue;
        const q = pointOf(mesh, mesh.side.to[a * 4 + s], 0.5, 0.5);
        if (q[1] > 1.2) up[s].push(mesh.side.rise[a * 4 + s]);
      }
    }
    for (const s of [0, 1, 3]) {
      expect(up[s].length).toBeGreaterThan(0);
      for (const r of up[s]) expect(r).toBeGreaterThan(0.5), expect(r).toBeLessThanOrEqual(DECK.step);
    }
  });

  it("cells on her plain deck lie within 2 cm of ship.js's analytic deck; on the sole (but over the mainsheet's traveller) and the benches, within 2 mm", () => {
    const n = { deck: 0, sole: 0, bench: 0 };
    for (let a = 0; a < mesh.count; a++) {
      const [x, y, z] = pointOf(mesh, a, 0.5, 0.5);
      const ax = Math.abs(x);
      const inWell = ax < 0.8 && z > 1.95 && z < 5.15;
      if (inWell && y < 1.2) {
        // the traveller across the sole, and its block: a low rise you step over (below)
        if (Math.abs(z - FIT.mainsheet.position[2]) < 0.35) continue;
        if (ax < 0.36) (n.sole++, expect(Math.abs(y - 0.72)).toBeLessThan(0.002));
        else if (ax > 0.4 && z < 3.7) (n.bench++, expect(Math.abs(y - 1.08)).toBeLessThan(0.002));
        continue;
      }
      // plain deck: clear of the cabin and its hatches, the well and its coamings, and the toe rail
      const cabin = ax < 1.0 && z > -1.4 && z < 2.05;
      const coaming = ax > 0.74 && ax < 0.9 && z > 1.9 && z < 4.2;
      if (cabin || inWell || coaming || ax > halfBreadthAt(z) - 0.12) continue;
      n.deck++;
      expect(Math.abs(y - deckAt(x, z)), `${x.toFixed(2)}, ${z.toFixed(2)}`).toBeLessThan(0.02);
    }
    expect(n.deck).toBeGreaterThan(1000);
    expect(n.sole).toBeGreaterThan(50);
    expect(n.bench).toBeGreaterThan(50);
  });

  it("the bow: walking forward past the windlass reaches as far forward as on her bare hull (no foredeck pruned behind it)", () => {
    const bare = bake({ triangles: partTriangles("hull"), seeds }, DECK);
    const fwd = (m) => {
      let z = Infinity;
      for (let a = 0; a < m.count; a++) z = Math.min(z, pointOf(m, a, 0.5, 0.5)[2]);
      return z;
    };
    expect(fwd(mesh)).toBeLessThan(FIT.windlass.position[2] - 1);
    expect(fwd(mesh)).toBeLessThanOrEqual(fwd(bare) + 0.1);
    // and nothing forward of the windlass was dropped
    for (const d of mesh.dropped) expect(d.centroid[2] < FIT.windlass.position[2] - 0.3 && d.centroid[1] > 1.2 && d.area > 0.05, JSON.stringify(d)).toBe(false);
  });

  it("the mainsheet with a card table between the benches (tabletop's, as the aboard setup puts it): its stand spot stays put, and the look from it to the block clears the table", () => {
    const [x0, x1, z0, z1, top] = [-0.6, 0.6, 2.47, 3.23, 0.72 + 0.7];
    const table = [...boxTriangles([x0, top - 0.06, z0], [x1, top, z1]), ...[[x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x0 + 0.08, z1 - 0.08], [x1 - 0.08, z1 - 0.08]].flatMap(([x, z]) => boxTriangles([x - 0.03, 0.72, z - 0.03], [x + 0.03, top - 0.06, z + 0.03]))];
    const withTable = bake({ triangles: [...triangles, ...table], seeds }, DECK);
    const at = (m) => {
      const l = m.links.find((k) => k.kind === "station" && k.id === "mainsheet");
      return pointOf(m, l.at.cell, l.at.u, l.at.v);
    };
    const p = at(withTable);
    expect(Math.hypot(p[0] - at(mesh)[0], p[2] - at(mesh)[2])).toBeLessThan(0.051);
    // the eye there, to the block's top: a segment that misses the table's box
    const eye = [p[0], p[1] + DECK.eye, p[2]];
    const block = [FIT.mainsheet.position[0], FIT.mainsheet.position[1] + 0.21, FIT.mainsheet.position[2]];
    let t0 = 0;
    let t1 = 1;
    for (const [k, lo, hi] of [[0, x0, x1], [1, 0.72, top], [2, z0, z1]]) {
      const d = block[k] - eye[k];
      if (Math.abs(d) < 1e-12) {
        if (eye[k] < lo || eye[k] > hi) t1 = -1;
        continue;
      }
      let a = (lo - eye[k]) / d;
      let b = (hi - eye[k]) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    expect(t0 > t1, "the look to the block passes through the table").toBe(true);
    expect(Math.hypot(...eye.map((v, k) => v - block[k]))).toBeLessThan(2.5); // in reach
  });

  it("the mainsheet: its stand spot is on the sole just aft of the traveller, and the traveller is a STEP you cross, not a WALL", () => {
    const link = mesh.links.find((l) => l.kind === "station" && l.id === "mainsheet");
    expect(link).toBeTruthy();
    const p = pointOf(mesh, link.at.cell, link.at.u, link.at.v);
    expect(p[1]).toBeCloseTo(0.72, 3);
    expect(p[2]).toBeGreaterThan(FIT.mainsheet.position[2] + 0.15);
    expect(p[2]).toBeLessThan(FIT.wheel.position[2]);
    // every side of a cell over the traveller is crossable (STEP) or leads on down to the sole: nowhere there walls you in
    let over = 0;
    for (let a = 0; a < mesh.count; a++) {
      const [x, y, z] = pointOf(mesh, a, 0.5, 0.5);
      if (Math.abs(x) > 0.3 || Math.abs(z - FIT.mainsheet.position[2]) > 0.3 || y > 1.2) continue;
      over++;
      expect(y - 0.72).toBeLessThan(DECK.step);
      for (let s = 0; s < 4; s++) if (mesh.side.kind[a * 4 + s] === 1) expect(mesh.side.rise[a * 4 + s]).toBeGreaterThan(DECK.step);
    }
    expect(over).toBeGreaterThan(0);
  });
});
