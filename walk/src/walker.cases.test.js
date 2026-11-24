// The walker over every arena feature and every kind of step (DESIGN.md,
// "The walker's enumerated cases"): a finite, named set of arenas, each
// walked by one fixed script, checked after every step against the raw
// triangles, not the mesh. Nothing here is random: a failure names its
// arena, its step and what broke, and runs the same every time.
//
// The arenas take each feature the walker meets alone, at the ends and the
// middle of its range, then all of them together: a 4 × 4 m floor; boxes on
// the floor (a 1 cm lip, a stair, a knee-high crate, a wall) and floating
// (a wire at shin height, a low ceiling, a table-high overhang, a box over
// the spawn point, which the bake's seed must step out of); ramps at 0, 30
// and 60° facing each of the four ways; thin rods (a post, a rail along x,
// one along z, at 1 and 3 cm). Then a second support rafted alongside on each
// side, touching and 1 m off, with and without its rail, the walker on it
// or in the water between them: a swimmer must be clear of both, and a
// walker who steps across is checked against its triangles.
//
// The script: a leg for every combination of forward, strafe, run and jump
// (3 × 3 × 2 × 2 = 36), each from the start (so the walker stays among the
// features rather than off the edge), 16 steps heading one of the eight ways,
// dt alternating between the shortest (1/240 s) and the longest (1/20 s)
// step, under every extreme pose of the support (moved ±3 m, heaved ±0.5 m,
// heeled ±30°, pitched ±20°, turned ±180°) in turn. Each
// step checks invariant I and the oracle: the feet within h + 2 mm above a
// triangle, and no triangle in the body's cylinder above the step (a
// swimmer: none within r of them in its plan). Every bake also passes
// B1, B3, B4 and B5.
import { describe, it, expect } from "vitest";
import { checkWalker, spawnOn, step, swimmingAt } from "./walker.js";
import { checkMesh, indexTriangles, oracle, swimmerClear } from "./navcheck.js";
import { apply, invert, matrixOf, multiply } from "./frames.js";
import { BODY } from "./walk.js";
import { baked, box, floor, world } from "./test/arena.js";

// The arenas bake at 10 cm, not the body's 5 cm: a quarter of the columns, so every case fits the
// budget. Nothing in the bake, the walker or the oracle depends on the cell size but through the
// mesh's own params; the unit cases and the whole support's static checks (structure.test.js) run at 5 cm.
const PARAMS = { ...BODY, cell: 0.1 };
const cm = (v) => v / 100;

// ─── the arenas (centimetres; the walker spawns at the middle) ──────────────

const BOXES = {
  lip: { x: 30, z: -50, w: 100, d: 100, base: 0, h: 1 },
  stair: { x: -130, z: -50, w: 60, d: 100, base: 0, h: 15 },
  crate: { x: -50, z: 40, w: 100, d: 60, base: 0, h: 45 },
  wall: { x: -200, z: -120, w: 400, d: 5, base: 0, h: 120 },
  wire: { x: -150, z: 20, w: 300, d: 1, base: 30, h: 1 },
  ceiling: { x: -100, z: -100, w: 200, d: 200, base: 175, h: 10 },
  overhang: { x: 40, z: 40, w: 120, d: 120, base: 75, h: 5 },
  overSpawn: { x: -20, z: -20, w: 40, d: 40, base: 0, h: 120 },
};
const RAMPS = [0, 30, 60].flatMap((deg) => [0, 1, 2, 3].map((dir) => ({ name: `ramp ${deg}° facing ${dir}`, ramp: { x: -50, z: -50, len: 150, wid: 100, deg, dir } })));
const RODS = [1, 3].flatMap((thick) => [
  { name: `post ${thick} cm`, rod: { kind: 0, x: 40, z: 0, y: 180, len: 0, thick } },
  { name: `rail along x ${thick} cm`, rod: { kind: 1, x: -150, z: 30, y: 90, len: 300, thick } },
  { name: `rail along z ${thick} cm`, rod: { kind: 2, x: 30, z: -150, y: 40, len: 300, thick } },
]);

const ARENAS = [
  { name: "floor alone", boxes: [], ramps: [], rods: [] },
  ...Object.entries(BOXES).map(([name, b]) => ({ name, boxes: [b], ramps: [], rods: [] })),
  ...RAMPS.map(({ name, ramp }) => ({ name, boxes: [], ramps: [ramp], rods: [] })),
  ...RODS.map(({ name, rod }) => ({ name, boxes: [], ramps: [], rods: [rod] })),
  // the most of each the arenas allow: 8 boxes, 2 ramps, 3 rods
  { name: "everything", boxes: Object.values(BOXES).filter((b) => b !== BOXES.overSpawn).concat([{ x: 120, z: -180, w: 60, d: 60, base: 0, h: 30 }]), ramps: [RAMPS[5].ramp, { ...RAMPS[10].ramp, x: 60, z: -190 }], rods: RODS.slice(3).map((r) => r.rod) },
];

// a second support rafted alongside: each side × touching or 1 m off × its rail or none × on it or in the water
const OTHERS = [0, 1, 2, 3].flatMap((side) => [0, 100].flatMap((gap) => [false, true].flatMap((rail) => [false, true].map((wet) => ({ side, gap, slide: 0, dy: 0, turn: 0, rail, wet, along: 0 })))));

// ─── the script ─────────────────────────────────────────────────────────────

const POSES = [
  { x: 0, y: 0, z: 0, heel: 0, pitch: 0, turn: 0 },
  ...["x", "z"].flatMap((k) => [300, -300].map((v) => ({ x: 0, y: 0, z: 0, heel: 0, pitch: 0, turn: 0, [k]: v }))),
  ...[50, -50].map((y) => ({ x: 0, y, z: 0, heel: 0, pitch: 0, turn: 0 })),
  ...[30, -30].map((heel) => ({ x: 0, y: 0, z: 0, heel, pitch: 0, turn: 0 })),
  ...[20, -20].map((pitch) => ({ x: 0, y: 0, z: 0, heel: 0, pitch, turn: 0 })),
  ...[180, -180].map((turn) => ({ x: 0, y: 0, z: 0, heel: 0, pitch: 0, turn })),
  { x: 300, y: 50, z: -300, heel: 30, pitch: -20, turn: 180 },
];
const YAWS = [0, 45, 90, 135, 180, -135, -90, -45];
const LEG = 16;
// one leg per combination of keys, each from the start, heading its own way (the yaw turns a
// quarter of an eighth each step), dt alternating, the support's pose going through every extreme
const LEGS = (() => {
  const out = [];
  for (const f of [1, 0, -1])
    for (const s of [0, 1, -1])
      for (const run of [false, true])
        for (const jump of [false, true]) {
          const n = out.length;
          out.push(Array.from({ length: LEG }, (_, k) => ({ f, s, run, jump: jump && k % 8 === 0, yaw: YAWS[n % YAWS.length] + (k % 4) * 11.25, dt: k % 2 ? 12 : 1, pose: POSES[(n + k) % POSES.length] })));
        }
  return out;
})();

/** The arena's triangles. */
function arena({ boxes, ramps, rods }) {
  const out = [...floor()];
  for (const b of boxes) out.push(...box([cm(b.x), cm(b.base), cm(b.z)], [cm(b.x + b.w), cm(b.base + b.h), cm(b.z + b.d)]));
  for (const r of ramps) {
    const t = Math.tan((r.deg * Math.PI) / 180);
    const L = cm(r.len);
    const W = cm(r.wid);
    const quad = [[0, 0, 0], [L, L * t, 0], [L, L * t, W], [0, 0, W]];
    const turn = (r.dir * Math.PI) / 2;
    const p = quad.map(([u, y, v]) => [cm(r.x) + u * Math.cos(turn) - v * Math.sin(turn), y, cm(r.z) + u * Math.sin(turn) + v * Math.cos(turn)]);
    out.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
  }
  for (const r of rods) {
    const th = cm(r.thick) / 2;
    const [x, y, z, L] = [cm(r.x), cm(r.y), cm(r.z), cm(r.len)];
    if (r.kind === 0) out.push(...box([x - th, 0, z - th], [x + th, y, z + th]));
    else if (r.kind === 1) out.push(...box([x, y - th, z - th], [x + L, y + th, z + th]));
    else out.push(...box([x - th, y - th, z], [x + th, y + th, z + L]));
  }
  return out;
}

/** The second support: a 4 × 4 m floor (a rail along its near side, or none), and where it lies in the first one's frame. */
const OTHER = {};
function otherOf(o) {
  const key = o.rail ? "rail" : "bare";
  if (!OTHER[key]) {
    const triangles = [...floor(), ...(o.rail ? box([-2, 0, -2], [-1.95, 0.62, 2]) : [])];
    OTHER[key] = { triangles, mesh: baked(triangles, [], PARAMS), index: indexTriangles(triangles) };
  }
  const off = 4 + cm(o.gap);
  const [dx, dz] = [[off, cm(o.slide)], [-off, cm(o.slide)], [cm(o.slide), off], [cm(o.slide), -off]][o.side];
  const turnTo = [0, Math.PI, -Math.PI / 2, Math.PI / 2][o.side]; // its railed side (−X) faces the first one
  const rel = matrixOf({ position: [dx, cm(o.dy), dz], rotation: [0, turnTo + (o.turn * Math.PI) / 180, 0], scale: 1 });
  const mid = 2 + cm(o.gap) / 2;
  const start = [[mid, cm(o.along)], [-mid, cm(o.along)], [cm(o.along), mid], [cm(o.along), -mid]][o.side];
  return { ...OTHER[key], rel, start: o.wet ? start : null };
}

const poseOf = (p) => matrixOf({ position: [cm(p.x), cm(p.y), cm(p.z)], rotation: [(p.pitch * Math.PI) / 180, (p.turn * Math.PI) / 180, (p.heel * Math.PI) / 180], scale: 1 });

/** One case: the problems found ([] if none), and how many checks found the walker on a support. */
function play(c) {
  const triangles = arena(c);
  const mesh = baked(triangles, [{ kind: "spawn", at: [0, 3, 0] }], PARAMS);
  const bad = checkMesh(mesh).map((m) => `bake: ${m}`);
  if (bad.length) return { problems: bad, onIt: 0 };
  const index = indexTriangles(triangles);
  const supports = { s: { mesh, M: matrixOf(null), triangles, index } };
  const other = c.other ? otherOf(c.other) : null;
  if (other) supports.t = { mesh: other.mesh, M: other.rel, triangles: other.triangles, index: other.index };
  let onIt = 0;
  for (const [n, leg] of LEGS.entries()) {
    supports.s.M = matrixOf(null);
    if (other) supports.t.M = other.rel;
    const env = world(supports);
    let st = other?.start ? swimmingAt(env, other.start) : spawnOn(env, "s");
    for (let i = 0; i <= leg.length; i++) {
      const problems = checkWalker(st, env);
      if (st.mode === "swimming") {
        for (const id of Object.keys(supports)) {
          const L = apply(invert(env.frame(id)), [st.p[0], env.water(st.p[0], st.p[1]), st.p[1]]);
          if (!swimmerClear(supports[id].index, [L[0], L[2]], BODY.radius)) problems.push(`a swimmer within r of ${id} at ${L.map((v) => v.toFixed(3))}`);
        }
      } else if (st.mesh) {
        onIt++;
        problems.push(...oracle(supports[st.on].index, st.mesh, st));
      }
      if (problems.length) return { problems: problems.map((m) => `leg ${n} step ${i} (${st.mode}): ${m}`), onIt };
      if (i === leg.length) break;
      const k = leg[i];
      env.supports_.s.M = poseOf(k.pose);
      if (other) env.supports_.t.M = multiply(env.supports_.s.M, other.rel);
      st = step(st, { forward: k.f, strafe: k.s, run: k.run, jump: k.jump }, (k.yaw * Math.PI) / 180, k.dt / 240, env).state;
    }
  }
  return { problems: [], onIt };
}

// Every arena twice: its edges where they're written, on the 10 cm cells' lines (where a side lies
// on the boundary of two columns, and makes a floor in neither but its own: the bake's step 2), and
// moved 3 mm off them, where a feature usually is.
const OFF = 0.3;
const offGrid = (a) => ({
  ...a,
  name: `${a.name}, off the grid`,
  boxes: a.boxes.map((b) => ({ ...b, x: b.x + OFF, z: b.z + OFF })),
  ramps: a.ramps.map((r) => ({ ...r, x: r.x + OFF, z: r.z + OFF })),
  rods: a.rods.map((r) => ({ ...r, x: r.x + OFF, z: r.z + OFF })),
});

const CASES = [
  ...ARENAS.map((a) => ({ ...a, other: null })),
  ...ARENAS.map((a) => ({ ...offGrid(a), other: null })),
  ...OTHERS.map((o) => ({ name: `rafted: side ${o.side}, ${o.gap} cm off, ${o.rail ? "its rail" : "no rail"}, ${o.wet ? "in the water" : "on deck"}`, boxes: [], ramps: [], rods: [], other: o })),
  // the most crowded floor with a support alongside, the walker starting in the water between them
  { ...ARENAS.at(-1), name: "everything, rafted touching, in the water", other: OTHERS.find((o) => o.side === 0 && o.gap === 0 && o.rail && o.wet) },
];

describe("the walker, over every arena feature and every kind of step", () => {
  it("the legs cover every key combination, every heading, both ends of dt and every pose", () => {
    const steps = LEGS.flat();
    expect([LEGS.length, steps.length]).toEqual([36, 36 * LEG]);
    expect(new Set(steps.map((k) => `${k.f}${k.s}${k.run}${k.jump}`)).size).toBe(36);
    expect(new Set(LEGS.map((leg) => leg[0].yaw))).toEqual(new Set(YAWS));
    expect(new Set(steps.map((k) => k.dt))).toEqual(new Set([1, 12]));
    expect(new Set(steps.map((k) => k.pose)).size).toBe(POSES.length);
    expect(CASES.length).toBe(2 * (1 + 8 + 12 + 6 + 1) + 32 + 1);
  });

  it(
    "keeps I, keeps the body out of the triangles and on them, and every bake is sound",
    () => {
      const t0 = performance.now();
      const failed = [];
      const ashore = [];
      for (const c of CASES) {
        const { problems: bad, onIt } = play(c);
        if (bad.length) failed.push(`${c.name}: ${bad.slice(0, 3).join("; ")}`);
        // a case that starts on a support spends most of its checks on it, among the features
        else if (!c.other?.wet && onIt < 0.75 * LEGS.length * (LEG + 1)) ashore.push(`${c.name}: onIt ${onIt}`);
      }
      expect(ashore).toEqual([]);
      expect(failed).toEqual([]);
      // a quiet machine runs these in a few seconds; this only catches something pathological
      expect(performance.now() - t0).toBeLessThan(60_000);
    },
    120_000,
  );
});
