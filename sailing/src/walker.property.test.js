// One property test (DESIGN.md, "One property test"): seeded random arenas
// and random play over them, checked after every step against the raw
// triangles, not the mesh. fast-check shrinks a failure to the fewest boxes
// and steps and prints its seed.
//
// Each case: a 4 × 4 m floor plus 0–8 boxes (some floating: wires,
// overhangs, low ceilings), 0–2 ramps (0–60°) and 0–3 thin rods; up to 200
// steps of keys, run, jump, yaw and dt (1/240 to 1/20 s), each under a
// pose of the ship (moved, heaved, heeled up to 30°, pitched, turned). Each
// step checks invariant I and the oracle: the feet within h + 2 mm above a
// triangle, and no triangle in the body's cylinder above the step (a
// swimmer: none within r of them in her plan). Every bake also passes B1,
// B3, B4 and B5. Two cases in three raft a second ship 0–1 m off the
// first (their D_r overlap under 2r): a swimmer must be clear of both, and
// a walker who steps across is checked against her triangles.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { checkWalker, spawnOn, step, swimmingAt } from "./walker.js";
import { checkMesh, indexTriangles, oracle, swimmerClear } from "./navcheck.js";
import { apply, invert, matrixOf, multiply } from "./frames.js";
import { DECK } from "./walk.js";
import { baked, box, floor, world } from "./test/arena.js";

const SEED = 20251109;
// The arenas bake at 10 cm, not the deck's 5 cm: a quarter of the columns, so a hundred cases fit
// the budget. Nothing in the bake, the walker or the oracle depends on the cell size but through the
// mesh's own params; the unit cases and the sloop's static checks run at 5 cm.
const PARAMS = { ...DECK, cell: 0.1 };
const cm = (v) => v / 100;

const boxArb = fc.record({
  x: fc.integer({ min: -200, max: 200 }),
  z: fc.integer({ min: -200, max: 200 }),
  w: fc.integer({ min: 5, max: 150 }),
  d: fc.integer({ min: 5, max: 150 }),
  base: fc.oneof(fc.constant(0), fc.integer({ min: 20, max: 220 })),
  h: fc.integer({ min: 1, max: 120 }),
});
const rampArb = fc.record({
  x: fc.integer({ min: -200, max: 150 }),
  z: fc.integer({ min: -200, max: 150 }),
  len: fc.integer({ min: 50, max: 200 }),
  wid: fc.integer({ min: 30, max: 150 }),
  deg: fc.integer({ min: 0, max: 60 }),
  dir: fc.integer({ min: 0, max: 3 }),
});
const rodArb = fc.record({
  kind: fc.integer({ min: 0, max: 2 }), // a post, or a rail along x or z
  x: fc.integer({ min: -200, max: 200 }),
  z: fc.integer({ min: -200, max: 200 }),
  y: fc.integer({ min: 10, max: 180 }),
  len: fc.integer({ min: 30, max: 300 }),
  thick: fc.integer({ min: 1, max: 3 }),
});
const stepArb = fc.record({
  f: fc.integer({ min: -1, max: 1 }),
  s: fc.integer({ min: -1, max: 1 }),
  run: fc.boolean(),
  jump: fc.boolean(),
  yaw: fc.integer({ min: -180, max: 180 }),
  dt: fc.integer({ min: 1, max: 12 }), // × 1/240 s
  pose: fc.record({
    x: fc.integer({ min: -300, max: 300 }),
    y: fc.integer({ min: -50, max: 50 }),
    z: fc.integer({ min: -300, max: 300 }),
    heel: fc.integer({ min: -30, max: 30 }),
    pitch: fc.integer({ min: -20, max: 20 }),
    turn: fc.integer({ min: -180, max: 180 }),
  }),
});
const caseArb = fc.record({
  boxes: fc.array(boxArb, { maxLength: 8 }),
  ramps: fc.array(rampArb, { maxLength: 2 }),
  rods: fc.array(rodArb, { maxLength: 3 }),
  steps: fc.array(stepArb, { maxLength: 200 }),
  // sometimes a second ship rafted alongside, her hull 0–1 m off, riding with the first: their D_r overlap below 2r
  other: fc.option(
    fc.record({
      side: fc.integer({ min: 0, max: 3 }),
      gap: fc.integer({ min: 0, max: 100 }),
      slide: fc.integer({ min: -150, max: 150 }),
      dy: fc.integer({ min: -40, max: 40 }),
      turn: fc.integer({ min: -10, max: 10 }),
      rail: fc.boolean(),
      wet: fc.boolean(), // start in the water between them, at `along` on the gap's line
      along: fc.integer({ min: -300, max: 300 }),
    }),
    { freq: 3 },
  ),
});

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

/** The second ship: a 4 × 4 m deck (a rail along her near side, or none), and where she lies in the first one's frame. */
const OTHER = {};
function otherOf(o) {
  const key = o.rail ? "rail" : "bare";
  if (!OTHER[key]) {
    const triangles = [...floor(), ...(o.rail ? box([-2, 0, -2], [-1.95, 0.62, 2]) : [])];
    OTHER[key] = { triangles, mesh: baked(triangles, [], PARAMS), index: indexTriangles(triangles) };
  }
  const off = 4 + cm(o.gap);
  const [dx, dz] = [[off, cm(o.slide)], [-off, cm(o.slide)], [cm(o.slide), off], [cm(o.slide), -off]][o.side];
  const turnTo = [0, Math.PI, -Math.PI / 2, Math.PI / 2][o.side]; // her railed side (−X) faces the first ship
  const rel = matrixOf({ position: [dx, cm(o.dy), dz], rotation: [0, turnTo + (o.turn * Math.PI) / 180, 0], scale: 1 });
  const mid = 2 + cm(o.gap) / 2;
  const start = [[mid, cm(o.along)], [-mid, cm(o.along)], [cm(o.along), mid], [cm(o.along), -mid]][o.side];
  return { ...OTHER[key], rel, start: o.wet ? start : null };
}

const poseOf = (p) => matrixOf({ position: [cm(p.x), cm(p.y), cm(p.z)], rotation: [(p.pitch * Math.PI) / 180, (p.turn * Math.PI) / 180, (p.heel * Math.PI) / 180], scale: 1 });

/** One case: the problems found, [] if none. */
function play(c) {
  const triangles = arena(c);
  const mesh = baked(triangles, [{ kind: "spawn", at: [0, 3, 0] }], PARAMS);
  const bad = checkMesh(mesh).map((m) => `bake: ${m}`);
  if (bad.length) return bad;
  const index = indexTriangles(triangles);
  const ships = { s: { mesh, M: matrixOf(null), triangles, index } };
  const other = c.other ? otherOf(c.other) : null;
  if (other) ships.t = { mesh: other.mesh, M: other.rel, triangles: other.triangles, index: other.index };
  const env = world(ships);
  let st = other?.start ? swimmingAt(env, other.start) : spawnOn(env, "s");
  for (let i = 0; i <= c.steps.length; i++) {
    const problems = checkWalker(st, env);
    if (st.mode === "swimming") {
      for (const id of Object.keys(ships)) {
        const L = apply(invert(env.frame(id)), [st.p[0], env.surface(st.p[0], st.p[1]), st.p[1]]);
        if (!swimmerClear(ships[id].index, [L[0], L[2]], DECK.radius)) problems.push(`a swimmer within r of ${id} at ${L.map((v) => v.toFixed(3))}`);
      }
    } else if (st.mesh) problems.push(...oracle(ships[st.ship].index, st.mesh, st));
    if (problems.length) return problems.map((m) => `step ${i} (${st.mode}): ${m}`);
    if (i === c.steps.length) break;
    const k = c.steps[i];
    env.ships_.s.M = poseOf(k.pose);
    if (other) env.ships_.t.M = multiply(env.ships_.s.M, other.rel);
    st = step(st, { forward: k.f, strafe: k.s, run: k.run, jump: k.jump }, (k.yaw * Math.PI) / 180, k.dt / 240, env).state;
  }
  return [];
}

describe("the walker, over random arenas and random play", () => {
  it(
    "keeps I, keeps the body out of the triangles and on them, and every bake is sound (seeded; shrinks a failure)",
    () => {
      const t0 = performance.now();
      fc.assert(
        fc.property(caseArb, (c) => {
          const bad = play(c);
          if (bad.length) throw new Error(bad.slice(0, 3).join("\n"));
        }),
        { seed: SEED, numRuns: 100, verbose: 1 },
      );
      // DESIGN.md's budget is 2 s on a quiet machine; this only catches something pathological
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(30_000);
    },
    60_000,
  );
});
