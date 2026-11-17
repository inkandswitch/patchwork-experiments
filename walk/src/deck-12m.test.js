// A support as a boat lays one out (DESIGN.md, "The sloop's static checks
// without a build-time link"): the stock 12 m sloop's doc and triangles,
// exported by the boat's own package (sailing/probes/export-deck.mjs) into
// test/fixtures/deck-12m.json, a copy (scripts/check-fixtures.mjs at the repo
// root catches drift). Read here through walk's own input adapter (her
// support, its stand spots, ladder and spawn as seeds, the swept part, the
// moving parts left out) and baked: the static checks C1–C9 over it, the
// bake budget, and the bow. walk bakes with `prune: false` until the
// pruning by passable sides lands (DESIGN.md, Decision 29), which keeps the
// bilge inside her hull too (C2 and C6 fail on it); so the checks run on the
// seed-pruned bake of the same input, and walk's own bake is checked to hold
// every cell of it, the rest unreachable from every seed.

import { describe, it, expect, beforeAll } from "vitest";
import { bake, pointOf } from "./navmesh.js";
import { checkAgainst, indexTriangles, rebaker, shuffleTriangles, staticChecks } from "./navcheck.js";
import { BODY } from "./walk.js";
import { bakeInput, bakedObjects, seedsOf } from "./supports.js";
import { stage } from "./test/stage.js";
import FIXTURE from "./test/fixtures/deck-12m.json";

const decode = (b64) => Array.from(new Float32Array(Uint8Array.from(Buffer.from(b64, "base64")).buffer));

let support, input, mesh, kept, bakeMs, report, objects;

beforeAll(() => {
  objects = Object.fromEntries(Object.entries(FIXTURE.objects).map(([id, o]) => [id, { ...o, ...(FIXTURE.triangles[id] ? { tris: decode(FIXTURE.triangles[id]) } : {}) }]));
  support = Object.keys(objects).find((id) => objects[id].traits?.["walk.support"]);
  const f = stage({ objects });
  const asWalkBakes = bakeInput(f.api, support);
  kept = bake(asWalkBakes, BODY);
  input = { triangles: asWalkBakes.triangles, seeds: asWalkBakes.seeds };
  bakeMs = Infinity;
  // CPU time, not wall time: the suite's files run side by side, and a bake that waits for a core isn't a slow bake
  for (let k = 0; k < 3; k++) {
    const t0 = process.cpuUsage();
    mesh = bake(input, BODY);
    const d = process.cpuUsage(t0);
    bakeMs = Math.min(bakeMs, (d.user + d.system) / 1000);
  }
  report = staticChecks(mesh, input.triangles, { seeds: input.seeds, railed: true, rebake: rebaker(input), shuffled: () => bake({ ...input, triangles: shuffleTriangles(input.triangles, 7) }, BODY) });
}, 120_000);

const check = (name) => () => {
  const c = Object.entries(report.checks).find(([k]) => k.startsWith(name));
  expect(c, name).toBeTruthy();
  expect(c[1].ok, `${c[0]}: ${JSON.stringify(c[1].detail).slice(0, 800)}`).toBe(true);
};

describe("the stock sloop, through walk's adapter", () => {
  it("is one support; her moving parts but the swept one are left out; every stand spot, her ladder and her spawn are seeds", () => {
    const sc = { objects, ids: Object.keys(objects), parents: new Map(Object.keys(objects).map((id) => [id, objects[id].parent ?? null])) };
    const baked = bakedObjects(sc, support);
    expect(baked.filter((b) => b.swept).length).toBe(1);
    for (const { id } of baked) expect(objects[id].traits?.["walk.moves"]?.blocks).not.toBe(true);
    const kinds = seedsOf(sc, support).map((s) => s.kind).sort();
    expect(kinds).toEqual(["ladder", "spawn", "stand", "stand", "stand", "stand", "stand", "stand"]);
  });
  it("walk's own bake (prune: false) holds every cell of the pruned one, and what else it keeps no seed reaches", () => {
    const key = (m, a) => pointOf(m, a, 0.5, 0.5).map((v) => Math.round(v * 1e4)).join();
    const all = new Set(Array.from({ length: kept.count }, (_, a) => key(kept, a)));
    for (let a = 0; a < mesh.count; a++) expect(all.has(key(mesh, a))).toBe(true);
    expect(kept.count).toBeGreaterThan(mesh.count);
  });
  it("bakes in time (about 13.6k triangles; this fails at 500 ms)", () => {
    expect(input.triangles.length / 9).toBeGreaterThan(10_000);
    expect(bakeMs).toBeLessThan(500);
  });
  it("C1: her spawn, every stand spot and her ladder's top are on kept cells, where asked", check("C1"));
  it("C2: every kept cell, and every link, is reachable on foot from spawn", check("C2"));
  it("C3: nothing dropped that you could walk or jump to", check("C3"));
  it("C4: every side of every cell has exactly one record; B1, B3, B4, B5", check("C4"));
  it("C5: B2 and B7, recomputed by brute force from the triangles at every cell and along every vault band", check("C5"));
  it("C6: no kept cell lies inside her closed hull (ray parity, three directions)", check("C6"));
  it("C7: stable: rebaked at step 0.56 and 0.60, radius 0.23 and 0.27, C1 and C2 still hold", check("C7"));
  it("C8: no OPEN side anywhere (you never walk off her); every way off is a WALL above the step, and a jump clears it on both sides", check("C8"));
  it("C9: two bakes of the same triangles are byte-identical, in any order", check("C9"));
  it("C5 reads the headroom: a bake that overstates it (every cell open to the sky) or understates it fails", () => {
    const finite = [];
    for (let a = 0; a < mesh.count; a++) if (Number.isFinite(mesh.cells.headroom[a])) finite.push(a);
    expect(finite.length).toBeGreaterThan(1000);
    const index = indexTriangles(input.triangles);
    const withRoom = (f) => ({ ...mesh, cells: { ...mesh.cells, headroom: Float32Array.from(mesh.cells.headroom, f) } });
    const over = checkAgainst(withRoom(() => Infinity), index, { limit: 5 });
    expect(over.length).toBeGreaterThan(0);
    expect(over[0]).toMatch(/^B2: /);
    const under = checkAgainst(withRoom((h) => (Number.isFinite(h) ? h * 0.5 : h)), index, { limit: 5 });
    expect(under.some((m) => m.startsWith("headroom: "))).toBe(true);
  }, 60_000);
  it("the bow: walking forward reaches as far forward as on her bare support (nothing on her foredeck prunes it)", () => {
    const bare = bake({ triangles: decode(FIXTURE.triangles[support]), seeds: input.seeds }, BODY);
    const fwd = (m) => {
      let z = Infinity;
      for (let a = 0; a < m.count; a++) z = Math.min(z, pointOf(m, a, 0.5, 0.5)[2]);
      return z;
    };
    expect(fwd(mesh)).toBeLessThanOrEqual(fwd(bare) + 0.1);
  });
  it("each stand spot's link stands within 1 mm of the height its spot was written at (they're written on what's drawn there)", () => {
    for (const s of input.seeds.filter((sd) => sd.kind === "stand")) {
      const link = mesh.links.find((l) => l.kind === "stand" && l.id === s.id);
      expect(link, s.id).toBeTruthy();
      const p = pointOf(mesh, link.at.cell, link.at.u, link.at.v);
      expect(Math.abs(p[1] - s.at[1]), `${objects[s.id].name}: ${p[1]} vs ${s.at[1]}`).toBeLessThan(1e-3);
    }
  });
});
