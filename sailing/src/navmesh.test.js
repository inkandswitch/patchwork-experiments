// The bake (navmesh.js), case by case: fixtures of a few boxes as triangles,
// baked, and their cells and sides read off. The numbers are the spec's
// (DESIGN.md, "Verification"); the walker's cases are in walker.test.js.
import { describe, it, expect } from "vitest";
import { NONE, OPEN, OVERBOARD, STEP, WALL, bake, boxTriangles, cellRange, columnAt, pointOf } from "./navmesh.js";
import { checkAgainst, checkMesh, indexTriangles, sameMesh, shuffleTriangles } from "./navcheck.js";
import { DECK } from "./walk.js";
import { baked, box, floor, post, ramp } from "./test/arena.js";

/** The kept cells in the column under a plan point, lowest first. */
const cellsAt = (mesh, x, z) => {
  const col = columnAt(mesh, x, z);
  const out = [];
  for (let a = mesh.column[col]; a < mesh.column[col + 1]; a++) out.push(a);
  return out;
};
const cellAt = (mesh, x, z) => cellsAt(mesh, x, z)[0] ?? -1;
const side = (mesh, a, s) => ({ kind: mesh.side.kind[a * 4 + s], to: mesh.side.to[a * 4 + s], rise: mesh.side.rise[a * 4 + s], gap: mesh.side.gap[a * 4 + s] });
const MX = 0;
const PX = 1;
const MZ = 2;
const PZ = 3;

/** Every bake here also passes B1, B3, B4, B5 and (from its triangles) B2 and B7. */
const sound = (triangles, seeds = []) => {
  const mesh = baked(triangles, seeds);
  expect(checkMesh(mesh)).toEqual([]);
  expect(checkAgainst(mesh, indexTriangles(triangles))).toEqual([]);
  return mesh;
};

describe("the bake", { timeout: 60_000 }, () => {
  it("1 (bake): a flat floor is cells all over but for a radius in from its edges, which are OPEN", () => {
    const mesh = sound(floor());
    const a = cellAt(mesh, 0.01, 0.01);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(pointOf(mesh, a, 0.5, 0.5)[1]).toBeCloseTo(0, 6);
    // the edge at x = 2 is a radius and a bit away: no cell beyond 2 − r
    for (let a2 = 0; a2 < mesh.count; a2++) expect(Math.abs(pointOf(mesh, a2, 0.5, 0.5)[0])).toBeLessThan(2 - DECK.radius);
    let open = 0;
    for (let e = 0; e < mesh.count * 4; e++) if (mesh.side.kind[e] === OPEN) open++;
    expect(open).toBeGreaterThan(0);
  });

  it("2 (bake): a step up of 0.3 is a STEP both ways (B4), its rise the difference", () => {
    const mesh = sound([...floor(), ...box([-2, 0, -2], [2, 0.3, -0.52])]);
    const low = cellAt(mesh, 0.01, -0.47);
    const high = cellAt(mesh, 0.01, -0.53);
    expect(side(mesh, low, MZ)).toMatchObject({ kind: STEP, to: high });
    expect(side(mesh, low, MZ).rise).toBeCloseTo(0.3, 5);
    expect(side(mesh, high, PZ)).toMatchObject({ kind: STEP, to: low });
    expect(side(mesh, high, PZ).rise).toBeCloseTo(-0.3, 5);
  });

  it("3: a rise of exactly `step` is a STEP; step + 1 mm a WALL; a drop of step + 1 mm a WALL (a ledge) with a rise of about 0", () => {
    const at = (h) => sound([...floor(), ...box([-2, 0, -2], [2, h, -0.52])]);
    const exact = at(DECK.step);
    expect(side(exact, cellAt(exact, 0.01, -0.47), MZ).kind).toBe(STEP);
    const over = at(DECK.step + 0.001);
    // the floor is eroded a radius back from it; the last cell's side toward it is a WALL to its top
    let a = cellAt(over, 0.01, 0.5);
    while (side(over, a, MZ).kind === STEP) a = side(over, a, MZ).to;
    const up = side(over, a, MZ);
    expect(up.kind).toBe(WALL);
    expect(pointOf(over, up.to, 0.5, 0.5)[1]).toBeCloseTo(DECK.step + 0.001, 5);
    expect(up.rise).toBeCloseTo(DECK.step + 0.001, 4);
    let b = cellAt(over, 0.01, -1.5);
    while (side(over, b, PZ).kind === STEP) b = side(over, b, PZ).to;
    const down = side(over, b, PZ);
    expect(down.kind).toBe(WALL);
    expect(down.to).toBeGreaterThanOrEqual(0);
    expect(pointOf(over, down.to, 0.5, 0.5)[1]).toBeCloseTo(0, 5);
    expect(down.rise).toBeLessThan(0.01);
  });

  it("10 (bake): a floor under a ceiling lower than H isn't a cell", () => {
    const mesh = sound([...floor(), ...box([-0.6, 1.6, -0.6], [0.6, 1.7, 0.6])]);
    for (let a = 0; a < mesh.count; a++) {
      const p = pointOf(mesh, a, 0.5, 0.5);
      if (Math.abs(p[0]) < 0.6 && Math.abs(p[2]) < 0.6) expect(p[1]).toBeGreaterThan(1.6);
    }
  });

  it("11 (bake): a wire pair over a floor (0.34 and 0.62, 6 mm): no cell under it or on it; the floor beside it eroded by r", () => {
    const wires = [...box([-0.006, 0.334, -2], [0.006, 0.346, 2]), ...box([-0.006, 0.614, -2], [0.006, 0.626, 2])];
    const mesh = sound([...floor(), ...wires]);
    for (let a = 0; a < mesh.count; a++) {
      const p = pointOf(mesh, a, 0.5, 0.5);
      expect(Math.abs(p[0]) - mesh.cell / 2).toBeGreaterThanOrEqual(DECK.radius);
    }
    // across it: a WALL to the other side, low enough to jump (0.626 < apex 0.661)
    let a = cellAt(mesh, -1, 0.01);
    while (side(mesh, a, PX).kind === STEP) a = side(mesh, a, PX).to;
    const s = side(mesh, a, PX);
    expect(s.kind).toBe(WALL);
    expect(pointOf(mesh, s.to, 0.5, 0.5)[0]).toBeGreaterThan(0);
    expect(s.rise).toBeCloseTo(0.626, 3);
  });

  it("15 (bake): a rail at the edge is a WALL to OVERBOARD at its height; an unrailed edge is OPEN", () => {
    const mesh = sound([...floor(), ...box([1.9, 0, -2], [1.95, 0.62, 2])]);
    let a = cellAt(mesh, 0, 0.01);
    while (side(mesh, a, PX).kind === STEP) a = side(mesh, a, PX).to;
    expect(side(mesh, a, PX)).toMatchObject({ kind: WALL, to: OVERBOARD });
    expect(side(mesh, a, PX).rise).toBeCloseTo(0.62, 3);
    let b = cellAt(mesh, 0, 0.01);
    while (side(mesh, b, MX).kind === STEP) b = side(mesh, b, MX).to;
    expect(side(mesh, b, MX)).toMatchObject({ kind: OPEN, to: OVERBOARD });
  });

  it("16 (bake): a 20° ramp is STEP sides all the way up; a 50° one only as high as a step", () => {
    const gentle = sound([...floor([-2, 4]), ...ramp(0.5, 2.5, -1, 1, 20)]);
    let a = cellAt(gentle, -0.49, 0.01);
    let top = 0;
    while (pointOf(gentle, a, 0.5, 0.5)[0] < 2.5) {
      expect(side(gentle, a, PX).kind).toBe(STEP);
      a = side(gentle, a, PX).to;
      top = pointOf(gentle, a, 0.5, 0.5)[1];
    }
    expect(top).toBeGreaterThan(0.7);
    const steep = sound([...floor([-2, 4]), ...ramp(0.5, 2, -1, 1, 50)]);
    for (let b = 0; b < steep.count; b++) expect(cellRange(steep.cells, b, steep.cell)[1]).toBeLessThanOrEqual(DECK.step + 0.07);
  });

  it("17: rule (b): a riser leaning 4.7 cm to a roof 0.45 up is STEP all the way, inside one column or straddling two; a 0.62 stanchion is no floor", () => {
    for (const x0 of [0, 0.025]) {
      const riser = [x0, 0, -2, x0 + 0.047, 0.45, -2, x0 + 0.047, 0.45, 2, x0, 0, -2, x0 + 0.047, 0.45, 2, x0, 0, 2];
      const mesh = sound([...floor([-2, x0]), ...riser, ...box([x0 + 0.047, 0.4, -2], [2, 0.45, 2])]);
      let a = cellAt(mesh, -0.5, 0.01);
      while (pointOf(mesh, a, 0.5, 0.5)[0] < 0.5) {
        expect(side(mesh, a, PX).kind).toBe(STEP);
        a = side(mesh, a, PX).to;
      }
      expect(pointOf(mesh, a, 0.5, 0.5)[1]).toBeCloseTo(0.45, 5);
    }
    const mesh = sound([...floor(), ...post([-1, 0.01], 0.007, 0, 0.62)]);
    for (const a of cellsAt(mesh, -1, 0.01)) expect(pointOf(mesh, a, 0.5, 0.5)[1]).toBeLessThan(0.3);
    expect(cellsAt(mesh, -1, 0.01)).toEqual([]); // and the floor round it is eroded too
  });

  it("the swept wheel and the seeds: links project onto kept cells; a WALL's `to` is a kept cell, OVERBOARD or NONE", () => {
    const tris = [...floor(), ...box([-0.1, 0, -0.1], [0.1, 2.5, 0.1])];
    const mesh = sound(tris, [
      { kind: "spawn", at: [0.8, 0.3, 0.8] },
      { kind: "station", id: "mast", at: [0, 2, 0.6] },
      { kind: "ladder", id: "l", at: [1.5, 0, 0], hook: [2, 0, 0], yaw: Math.PI / 2 },
    ]);
    expect(mesh.links.map((l) => l.kind)).toEqual(["spawn", "station", "ladder"]);
    const ladder = mesh.links[2];
    expect(ladder.foot[0]).toBeGreaterThan(2 + DECK.radius);
    for (let e = 0; e < mesh.count * 4; e++) if (mesh.side.kind[e] === WALL) expect(mesh.side.to[e] >= 0 || mesh.side.to[e] === OVERBOARD || mesh.side.to[e] === NONE).toBe(true);
  });

  it("9 (C9): the same input bakes byte-identical, whatever order its triangles come in", () => {
    const tris = [...floor(), ...box([-2, 0, -2], [2, 0.3, -0.52]), ...ramp(0.5, 1, 0, 1, 20), ...post([1, 1], 0.01, 0, 0.7)];
    const seeds = [{ kind: "spawn", at: [0, 0, 1] }];
    const a = bake({ triangles: tris, seeds }, DECK);
    expect(sameMesh(a, bake({ triangles: tris, seeds }, DECK))).toBe(true);
    for (const seed of [1, 2, 3]) expect(sameMesh(a, bake({ triangles: shuffleTriangles(tris, seed), seeds }, DECK))).toBe(true);
  });

  it("an empty input bakes an empty mesh: no cells, everything outside", () => {
    const mesh = bake({ triangles: [] }, DECK);
    expect(mesh.count).toBe(0);
    expect(mesh.outside.every((v) => v === 1)).toBe(true);
  });

  it("box triangles are a closed box", () => {
    expect(boxTriangles([0, 0, 0], [1, 1, 1]).length).toBe(12 * 9);
  });
});
