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

// Step 2's rule, case by case: a side lying on a line between columns is on the boundary of both
// squares, so it is an obstacle in both but a floor in neither but its own (DESIGN.md, "The bake").
// Each case against its twin moved 3 mm in off the line, where nothing of it reaches the column
// outside, and its twin moved 3 mm out over the line, where the column outside holds a floor by
// the same rule: the boundary pinned from both sides. At 10 cm cells, as the walker's cases bake.
describe("a side on a column line makes no floor outside it", { timeout: 60_000 }, () => {
  const P10 = { ...DECK, cell: 0.1 };
  const IN = 0.003;
  /** Bake at 10 cm, every component kept; B1 (each cell held up inside its open square), B3–B5, B2 and B7. */
  const sound10 = (triangles) => {
    const mesh = bake({ triangles, seeds: [] }, P10);
    expect(checkMesh(mesh)).toEqual([]);
    expect(checkAgainst(mesh, indexTriangles(triangles))).toEqual([]);
    return mesh;
  };
  /** Every kept cell as [i, k, centre height], split by whether its centre is in the plan footprint. */
  const split = (mesh, inside) => {
    const out = { in: [], out: [] };
    for (let a = 0; a < mesh.count; a++) {
      const p = pointOf(mesh, a, 0.5, 0.5);
      out[inside(p[0], p[2]) ? "in" : "out"].push([mesh.cells.i[a], mesh.cells.k[a], +p[1].toFixed(6)]);
    }
    return out;
  };
  /** Kept cells' centres above the ground, as [x, z, y] to the millimetre. */
  const raised = (mesh) => {
    const out = [];
    for (let a = 0; a < mesh.count; a++) {
      const p = pointOf(mesh, a, 0.5, 0.5);
      if (p[1] !== 0) out.push([+p[0].toFixed(3), +p[2].toFixed(3), +p[1].toFixed(3)]);
    }
    return out.sort((u, v) => u[0] - v[0] || u[1] - v[1] || u[2] - v[2]);
  };
  const HEIGHTS = { "1 cm lip": 0.01, "15 cm stair": 0.15, "45 cm crate": 0.45, "120 cm wall": 1.2 };
  const SIDES = { "−X": MX, "+X": PX, "−Z": MZ, "+Z": PZ };
  const AT = { "on the line": 0, "3 mm out over it": IN };
  /** A box on the floor over [−0.5, 0.5]², every side 3 mm in from its line but side `s`, `out` beyond it. */
  const boxOf = (h, s, out) => {
    const min = [-0.5 + IN, 0, -0.5 + IN];
    const max = [0.5 - IN, h, 0.5 - IN];
    if (out != null) [() => (min[0] = -0.5 - out), () => (max[0] = 0.5 + out), () => (min[2] = -0.5 - out), () => (max[2] = 0.5 + out)][s]();
    return { min, max, inside: (x, z) => x > min[0] && x < max[0] && z > min[2] && z < max[2] };
  };
  const BOXES = Object.entries(HEIGHTS).flatMap(([hn, h]) =>
    Object.entries(SIDES).flatMap(([sn, s]) => Object.entries(AT).map(([an, out]) => ({ name: `${hn}, side ${sn} ${an}`, h, s, out }))),
  );

  it("the table: 4 heights × 4 sides × on the line or 3 mm out over it", () => expect(BOXES.length).toBe(32));

  it.each(BOXES)("$name: its top as its in-twin's; outside, a floor only where it reaches past the line", ({ h, s, out }) => {
    const b = boxOf(h, s, out);
    const got = split(sound10([...floor(), ...box(b.min, b.max)]), b.inside);
    const twin = boxOf(h, s, null);
    const inner = split(bake({ triangles: [...floor(), ...box(twin.min, twin.max)], seeds: [] }, P10), twin.inside);
    // on the line, the in-twin's exactly; out over it, those and maybe more by the edge (the column
    // outside now holds a floor at the top, so erosion there finds a floor reached)
    if (out === 0) expect(got.in).toEqual(inner.in);
    else expect(got.in).toEqual(expect.arrayContaining(inner.in));
    expect(got.in.length).toBeGreaterThan(0);
    for (const [, , y] of got.in) expect(y).toBeCloseTo(h, 6);
    // outside: the ground, but for the row of columns the side reaches into, at its top when that's
    // a step (a wall's is eroded: no floor in its disc is reached)
    const row = [];
    if (out > 0 && h <= P10.step) {
      for (let v = -0.45; v < 0.5; v += 0.1) {
        const [x, z] = [[-0.55, v], [0.55, v], [v, -0.55], [v, 0.55]][s];
        row.push([+x.toFixed(3), +z.toFixed(3), h]);
      }
    }
    const up = got.out.filter(([, , y]) => y !== 0).length;
    expect(up).toBe(row.length);
    if (row.length) expect(raised(bake({ triangles: [...floor(), ...box(b.min, b.max)], seeds: [] }, P10)).filter(([x, z]) => !b.inside(x, z))).toEqual(row.sort((u, v) => u[0] - v[0] || u[1] - v[1]));
    // a side a step high or less, on the line: the ground beside it is exactly the in-twin's, edge and all
    if (out === 0 && h <= P10.step) expect(got.out).toEqual(inner.out);
  });

  // A 30° ramp 1.5 m long (its high end 0.87 up, above a step), rising toward each of the four
  // ways, its high end on the line 0.8 out or 3 mm past it; its long sides 3 mm in. Against its
  // twin 3 mm short of the line.
  const RAMPS = [0, 1, 2, 3].flatMap((dir) => Object.entries(AT).map(([an, out]) => ({ name: `30° ramp facing ${dir}, high end ${an}`, dir, out })));
  const rampOf = (dir, out) => {
    const t = Math.tan(Math.PI / 6);
    const [u0, u1, w] = [-0.7, 0.8 + out, 0.5 - IN];
    const [cs, sn] = [[1, 0], [0, 1], [-1, 0], [0, -1]][dir];
    const at = (u, v) => [u * cs - v * sn, (u - u0) * t, u * sn + v * cs];
    const [a, b, c, d] = [at(u0, -w), at(u1, -w), at(u1, w), at(u0, w)];
    return { triangles: [...a, ...b, ...c, ...a, ...c, ...d], inside: (x, z) => Math.abs(-x * sn + z * cs) < w && x * cs + z * sn > u0 && x * cs + z * sn < u1 };
  };

  it("the table: 4 facings × on the line or 3 mm out over it", () => expect(RAMPS.length).toBe(8));

  it.each(RAMPS)("$name: no kept floor above the ground outside it; its slope as its in-twin's", ({ dir, out }) => {
    const r = rampOf(dir, out);
    const got = split(sound10([...floor(), ...r.triangles]), r.inside);
    // (3 mm out, the column past the line holds a floor at the ramp's top, which erosion drops: a
    // drop of 0.87 in its disc. It is reached, though, so the high end inside may keep more.)
    for (const [i, k, y] of got.out) expect([i, k, y]).toEqual([i, k, 0]);
    const twin = rampOf(dir, -IN);
    const inner = split(bake({ triangles: [...floor(), ...twin.triangles], seeds: [] }, P10), twin.inside).in;
    if (out === 0) expect(got.in).toEqual(inner);
    else expect(got.in).toEqual(expect.arrayContaining(inner));
    expect(got.in.some(([, , y]) => y > P10.step)).toBe(true);
  });

  // A zero-thickness fence, z in [−0.5, 0.5], on the line x = 0.3 or 3 mm off it. On the line it
  // is all boundary: an obstacle in both columns, a floor in neither, and erosion measures a step
  // against it from both (the floor's `top` is its interval's, the fence's). Off it, its top is a
  // floor where it's a step, as any lip.
  const FENCES = Object.entries(HEIGHTS)
    .filter(([hn]) => hn !== "15 cm stair")
    .flatMap(([hn, h]) => [0.3, 0.3 + IN].map((x0) => ({ name: `${hn} fence ${x0 === 0.3 ? "on the line" : "3 mm off it"}`, h, x0 })));
  const fence = (x0, h, z0 = -0.5, z1 = 0.5) => {
    const [a, b, c, d] = [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]];
    return [...a, ...b, ...c, ...a, ...c, ...d];
  };

  it("the table: 3 heights × on the line or off it", () => expect(FENCES.length).toBe(6));

  it.each(FENCES)("$name: B1–B7 hold; a floor on its top only off the line and a step high", ({ h, x0 }) => {
    const mesh = sound10([...floor(), ...fence(x0, h)]);
    const row = [];
    if (x0 !== 0.3 && h <= P10.step) for (let v = -0.45; v < 0.5; v += 0.1) row.push([0.35, +v.toFixed(3), h]);
    expect(raised(mesh)).toEqual(row);
    // a wall: no cell within the body's radius of it, on the line as off it
    if (h > P10.step) for (let a = 0; a < mesh.count; a++) {
      const p = pointOf(mesh, a, 0.5, 0.5);
      if (Math.abs(p[2]) < 0.5) expect(Math.abs(p[0] - x0)).toBeGreaterThan(P10.radius);
    }
  });

  // A cage: 1.2 m fences on every line from −1.5 to 1.5 both ways, so every column inside is
  // walled on all four boundaries and holds nothing but the ground. Erosion's fast path must not
  // take those columns as plain: each floor's interval top is the fences', above its own.
  it("a cage of fences on every line: nothing kept inside it", () => {
    const t = [...floor([-3, 3], [-3, 3])];
    for (let n = -15; n <= 15; n++) {
      t.push(...fence(n / 10, 1.2, -1.5, 1.5));
      const [a, b, c, d] = [[-1.5, 0, n / 10], [1.5, 0, n / 10], [1.5, 1.2, n / 10], [-1.5, 1.2, n / 10]];
      t.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    const mesh = sound10(t);
    for (let a = 0; a < mesh.count; a++) {
      const p = pointOf(mesh, a, 0.5, 0.5);
      expect(Math.abs(p[0]) < 1.5 && Math.abs(p[2]) < 1.5).toBe(false);
    }
  });

  // A wall 30 cm high whose top edge is on the line x = 0.3 and whose foot at z = +0.45 leans d
  // into the column outside: a sliver of it meets that column's open square, below its top. A
  // floor there (rule b, a step) is at the sliver's top, never at the top only the line reaches:
  // B1 by construction, however thin the sliver (d at a float32 GLB vertex's offset, and above).
  it.each([1e-8, 1e-6])("a wall on a line leaning %s into the column outside: its floor at the sliver's top", (d) => {
    const t = [...floor(), 0.3, 0, -0.45, 0.3 + d, 0, 0.45, 0.3, 0.3, -0.45, 0.3, 0.3, -0.45, 0.3 + d, 0, 0.45, 0.3, 0.3, 0.45];
    const mesh = sound10(t);
    const up = raised(mesh);
    expect(up.length).toBeGreaterThan(0);
    // the wall's height where it's 1e-9 (the open square's margin) past the line (to rounding:
    // 0.3 + d is a double), well under the 0.3 the line reaches
    const top = 0.3 * (1 - 1e-9 / d);
    for (let a = 0; a < mesh.count; a++) {
      const p = pointOf(mesh, a, 0.5, 0.5);
      if (p[1] !== 0) expect(p[0] > 0.3 && p[1] < top + 1e-7).toBe(true);
    }
  });
});
