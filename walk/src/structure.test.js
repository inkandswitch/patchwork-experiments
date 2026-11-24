// A whole support, end to end: a hut on a railed porch (test/porch.js), a
// dozen boxes laid out as a scene doc lays them out, read through walk's own
// input adapter (the support, its stand spots, ladder and spawn as seeds, the
// swept fan, the open door left out) and baked: the static checks C1–C9 over
// it, the headroom C5 must read, each stand spot's height, and what the boxes
// say a right bake holds (floors at heights, the kind of each rise, a stand
// spot that stays put beside an added box), every expected number read off
// the same boxes the triangles are made from. walk bakes with `prune: false`
// until the pruning by passable sides lands (DESIGN.md, Decision 29), which
// keeps the floor inside the closed crate (C2 and C6 would fail on it); so the
// checks run on the seed-pruned bake of the same input, and walk's own bake is
// checked to hold every cell of it, the rest unreachable from every seed.

import { describe, it, expect, beforeAll } from "vitest";
import { STEP, WALL, OFF, bake, boxTriangles, columnAt, pointOf, surfaceAt } from "./navmesh.js";
import { checkAgainst, indexTriangles, rebaker, shuffleTriangles, staticChecks } from "./navcheck.js";
import { BODY } from "./walk.js";
import { bakeInput, bakedObjects, seedsOf, supportsOf } from "./supports.js";
import { stage } from "./test/stage.js";
import { PARTS, boxIn, objects as porchObjects, over, pointIn } from "./test/porch.js";

const SUPPORT = "porch";
let input, mesh, kept, report, objects;

beforeAll(() => {
  objects = porchObjects();
  const f = stage({ objects });
  const asWalkBakes = bakeInput(f.api, SUPPORT);
  kept = bake(asWalkBakes, BODY);
  input = { triangles: asWalkBakes.triangles, seeds: asWalkBakes.seeds };
  mesh = bake(input, BODY);
  report = staticChecks(mesh, input.triangles, { seeds: input.seeds, railed: true, rebake: rebaker(input), shuffled: () => bake({ ...input, triangles: shuffleTriangles(input.triangles, 7) }, BODY) });
}, 120_000);

const check = (name) => () => {
  const c = Object.entries(report.checks).find(([k]) => k.startsWith(name));
  expect(c, name).toBeTruthy();
  expect(c[1].ok, `${c[0]}: ${JSON.stringify(c[1].detail).slice(0, 800)}`).toBe(true);
};

// read off the boxes (the porch's frame)
const top = (id, i = 0) => boxIn(id, i)[1][1];
const bottom = (id, i = 0) => boxIn(id, i)[0][1];
const middle = (id, i = 0) => {
  const [lo, hi] = boxIn(id, i);
  return [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2];
};
const FLOOR = top("porch");
const ROOF = 0; // the hut's boxes: its roof, then its walls
const standOfPart = (id) => pointIn(id, PARTS[id].traits["walk.stand"].at);
const kindOf = (rise) => (rise <= BODY.step ? STEP : WALL);
/** A plan point [x, z] at height y. */
const at = ([x, z], y) => [x, y, z];

/** The kept cell over (x, z) whose surface there is nearest y, and how far: { a, d }, or null over none. */
const cellAt = (m, [x, y, z]) => {
  const col = columnAt(m, x, z);
  const [u, v] = [(x - m.origin[0]) / m.cell - Math.floor((x - m.origin[0]) / m.cell), (z - m.origin[1]) / m.cell - Math.floor((z - m.origin[1]) / m.cell)];
  let best = null;
  for (let a = 0; a < m.count; a++) {
    if (m.cells.k[a] * m.nx + m.cells.i[a] !== col) continue;
    const d = Math.abs(surfaceAt(m, a, u, v) - y);
    if (!best || d < best.d) best = { a, d };
  }
  return best;
};
const standOf = (m, id) => {
  const l = m.links.find((k) => k.kind === "stand" && k.id === id);
  return l ? pointOf(m, l.at.cell, l.at.u, l.at.v) : null;
};

describe("a hut on a railed porch, through walk's adapter", () => {
  it("is one support; its moving parts but the swept fan are left out; every stand spot, the ladder and the spawn are seeds, where their parts put them", () => {
    const sc = { objects, ids: Object.keys(objects), parents: new Map(Object.keys(objects).map((id) => [id, objects[id].parent ?? null])) };
    expect(supportsOf(sc)).toEqual([SUPPORT]);
    const baked = bakedObjects(sc, SUPPORT);
    expect(baked.filter((b) => b.swept).map((b) => b.id)).toEqual(["fan"]);
    const moves = (id) => PARTS[id].traits?.["walk.moves"];
    expect(baked.map((b) => b.id).sort()).toEqual(Object.keys(PARTS).filter((id) => !moves(id) || moves(id).swept).sort());
    const seeds = seedsOf(sc, SUPPORT);
    const want = Object.keys(PARTS).flatMap((id) => ["walk.spawn", "walk.stand", "walk.ladder"].filter((t) => PARTS[id].traits?.[t]).map((t) => t.slice(5)));
    expect(seeds.map((s) => s.kind).sort()).toEqual(want.sort());
    for (const s of seeds.filter((sd) => sd.kind === "stand")) for (let k = 0; k < 3; k++) expect(s.at[k]).toBeCloseTo(standOfPart(s.id)[k], 9);
    const ladder = seeds.find((s) => s.kind === "ladder");
    for (let k = 0; k < 3; k++) expect(ladder.at[k]).toBeCloseTo(pointIn("ladder", PARTS.ladder.traits["walk.ladder"].top)[k], 9);
  });
  it("walk's own bake (prune: false) holds every cell of the pruned one, and what else it keeps (no seed reaches it) is over the crate or the roof", () => {
    const key = (m, a) => pointOf(m, a, 0.5, 0.5).map((v) => Math.round(v * 1e4)).join();
    const pruned = new Set(Array.from({ length: mesh.count }, (_, a) => key(mesh, a)));
    const all = new Set(Array.from({ length: kept.count }, (_, a) => key(kept, a)));
    for (const k of pruned) expect(all.has(k)).toBe(true);
    expect(kept.count).toBeGreaterThan(mesh.count);
    for (let a = 0; a < kept.count; a++) {
      if (pruned.has(key(kept, a))) continue;
      const [x, , z] = pointOf(kept, a, 0.5, 0.5);
      expect(over(boxIn("crate"), x, z) || over(boxIn("hut", ROOF), x, z), `${x}, ${z}`).toBe(true);
    }
  });
  it("C1: the spawn, every stand spot and the ladder's top are on kept cells, where asked", check("C1"));
  it("C2: every kept cell, and every link, is reachable on foot from spawn", check("C2"));
  it("C3: nothing dropped that you could walk or jump to", check("C3"));
  it("C4: every side of every cell has exactly one record; B1, B3, B4, B5", check("C4"));
  it("C5: B2 and B7, recomputed by brute force from the triangles at every cell and along every vault band", check("C5"));
  it("C6: no kept cell lies inside the closed crate (ray parity, three directions)", check("C6"));
  it("C7: stable: rebaked at step 0.56 and 0.60, radius 0.23 and 0.27, C1 and C2 still hold", check("C7"));
  it("C8: no OPEN side anywhere (you never walk off it); every way off is a WALL above the step, and a jump clears it on both sides", check("C8"));
  it("C9: two bakes of the same triangles are byte-identical, in any order", check("C9"));

  it("the headroom is finite in the hut and nowhere out of the roof's reach: under the roof, and lower under the fan's sweep, as their boxes say", () => {
    const roof = boxIn("hut", ROOF);
    const inside = [[roof[0][0] + 0.1, 0, roof[0][2] + 0.1], [roof[1][0] - 0.1, 0, roof[1][2] - 0.1]]; // in from the walls
    let finite = 0;
    for (let a = 0; a < mesh.count; a++) {
      const [x, , z] = pointOf(mesh, a, 0.5, 0.5);
      const room = mesh.cells.headroom[a];
      if (Number.isFinite(room)) finite++;
      if (over(inside, x, z)) expect(Number.isFinite(room), `${x}, ${z}`).toBe(true);
      if (Number.isFinite(room)) expect(over(roof, x, z, BODY.radius + 2 * BODY.cell), `${x}, ${z}`).toBe(true);
    }
    expect(finite).toBeGreaterThan(0);
    const roomAt = (p) => mesh.cells.headroom[cellAt(mesh, p).a];
    expect(roomAt(at(middle("fan"), FLOOR))).toBeCloseTo(bottom("fan") - FLOOR - BODY.height, 4);
    expect(roomAt(standOfPart("door"))).toBeCloseTo(bottom("hut", ROOF) - FLOOR - BODY.height, 4);
  });
  it("C5 reads the headroom: a bake that overstates it (every cell open to the sky) or understates it fails", () => {
    const index = indexTriangles(input.triangles);
    const withRoom = (f) => ({ ...mesh, cells: { ...mesh.cells, headroom: Float32Array.from(mesh.cells.headroom, f) } });
    const over_ = checkAgainst(withRoom(() => Infinity), index, { limit: 5 });
    expect(over_.length).toBeGreaterThan(0);
    expect(over_[0]).toMatch(/^B2: /);
    const under = checkAgainst(withRoom((h) => (Number.isFinite(h) ? h * 0.5 : h)), index, { limit: 5 });
    expect(under.some((m) => m.startsWith("headroom: "))).toBe(true);
  }, 60_000);
  it("each stand spot's link stands within 1 mm of the height its spot was written at (they're written on what's drawn there)", () => {
    for (const s of input.seeds.filter((sd) => sd.kind === "stand")) {
      const link = mesh.links.find((l) => l.kind === "stand" && l.id === s.id);
      expect(link, s.id).toBeTruthy();
      const p = pointOf(mesh, link.at.cell, link.at.u, link.at.v);
      expect(Math.abs(p[1] - s.at[1]), `${objects[s.id].name}: ${p[1]} vs ${s.at[1]}`).toBeLessThan(1e-3);
    }
  });

  // what the boxes say a right bake holds
  it("its floors: over each named point, a kept cell within 1 mm of the top it stands on", () => {
    const floors = [
      ["the porch, at the doormat", pointIn("doormat", [0, 0, 0])],
      ["the dais, at its middle", at(middle("dais"), top("dais"))],
      ["the hut, at its middle (under the fan)", at(middle("hut", ROOF), FLOOR)],
      ["the porch, where the open door is drawn (a moving part: not baked)", at(middle("door"), FLOOR)],
    ];
    for (const [what, p] of floors) expect(cellAt(mesh, p)?.d ?? Infinity, what).toBeLessThan(1e-3);
  });
  it("and where no floor is: inside the crate, on its top and on the roof walk's own bake keeps one at that height, and the pruned bake none within a step", () => {
    const none = [
      ["inside the crate", at(middle("crate"), bottom("crate"))],
      ["on the crate", at(middle("crate"), top("crate"))],
      ["on the roof", at(middle("hut", ROOF), top("hut", ROOF))],
    ];
    for (const [what, p] of none) {
      expect(cellAt(kept, p)?.d ?? Infinity, what).toBeLessThan(1e-3);
      expect(cellAt(mesh, p)?.d ?? Infinity, what).toBeGreaterThan(BODY.step);
    }
  });
  it("its rises: going each way from each named point, the first side that isn't level is a STEP if its box's rise is within a step, else a WALL, rising as its box does", () => {
    const DIR = { "-x": 0, "+x": 1, "-z": 2, "+z": 3 };
    const bench = standOfPart("bench");
    const rises = [
      { what: "the porch up onto the dais", from: at([middle("dais")[0], boxIn("dais")[0][2] - 0.5], FLOOR), dir: "+z", rise: top("dais") - FLOOR },
      { what: "the porch over the bench", from: bench, dir: "-x", rise: top("bench") - FLOOR },
      { what: "the porch to the front rail", from: bench, dir: "+z", rise: top("railing", 2) - FLOOR, off: true },
      { what: "the hut's floor to its back wall, up to the roof", from: standOfPart("hut"), dir: "-z", rise: top("hut", ROOF) - FLOOR, off: true },
    ];
    expect(rises.map((r) => kindOf(r.rise))).toEqual([STEP, WALL, WALL, WALL]);
    for (const r of rises) {
      const c = cellAt(mesh, r.from);
      expect(c?.d ?? Infinity, r.what).toBeLessThan(0.005);
      const s = DIR[r.dir];
      let a = c.a;
      for (let n = 0; n < 1000 && mesh.side.kind[a * 4 + s] === STEP && Math.abs(mesh.side.rise[a * 4 + s]) < 0.005; n++) a = mesh.side.to[a * 4 + s];
      const e = a * 4 + s;
      expect([mesh.side.kind[e], mesh.side.rise[e]], r.what).toEqual([kindOf(r.rise), expect.closeTo(r.rise, 3)]);
      if (r.off) expect(mesh.side.to[e], r.what).toBe(OFF);
    }
  });
  it("what it keeps: a box added a body's radius and a bit beside a stand spot leaves it where it was; one added over it moves it", () => {
    const spot = standOfPart("bench");
    const g = BODY.radius + 3 * BODY.cell;
    const add = (lo, hi) => standOf(bake({ triangles: [...input.triangles, ...boxTriangles(lo, hi)], seeds: input.seeds }, BODY), "bench");
    const q = standOf(mesh, "bench");
    const plan = (p) => Math.hypot(p[0] - q[0], p[2] - q[2]);
    expect(plan(spot)).toBeLessThanOrEqual(BODY.cell);
    expect(plan(add([spot[0] - 0.15, spot[1], spot[2] + g], [spot[0] + 0.15, spot[1] + 1, spot[2] + g + 0.3]))).toBeLessThanOrEqual(BODY.cell);
    expect(plan(add([spot[0] - 0.15, spot[1], spot[2] - 0.15], [spot[0] + 0.15, spot[1] + 1, spot[2] + 0.15]))).toBeGreaterThan(BODY.radius);
  });
});
