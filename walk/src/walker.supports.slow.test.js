// A support over the ground, walked off each side (DESIGN.md, "Standing on
// supports", Verification, step 3): W3 generalised, the falling state and
// invariant I over two supports, checked every step against both supports'
// raw triangles. Finite and named: a failure names its row.
//
// The support is a 4 × 4 m floor with no rail (id "deck"), its spawn in the
// middle. Each row walks from the spawn straight at one side and lets go of
// the keys once off it, then runs until it settles. The ground (id null, the
// stage's frame) is a slab placed per row under that side's exit X (found by
// walking off with nothing about), its near edge 0.3 m back from X toward
// the support, so X is over a kept cell of it, and its top `under` below X.
//
// Rows: pose {still, moved 3 m, heeled 30°, turned 180°} × side {−X, +X, −Z,
// +Z} × under the exit {0, 0.3 m, 1 m (within DROP), 2.5 m (past it),
// nothing} × water {none, at the ground's top, 1 m under the exit} (no
// ground, no "at the ground"): 4 × 4 × (4 × 3 + 2) = 224. Each row's W3
// case and end are written in it:
//   ground within DROP, any water:           (1) onto the ground; ends walking on it
//   2.5 m, water 1 m under X:                (2) swimming; ends swimming
//   2.5 m, water at the ground's top:        (3) falling (a swimmer there would stand in the slab: (c)), then F2 onto the ground
//   2.5 m, none:                             (3) falling, then F2 onto the ground
//   nothing, water:                          (2) swimming
//   nothing, none:                           (3) falling, then F4: back at the spawn, walking on the support
// Then W3 (4): the same support beside a ground block standing from 1 m
// under X to 1 m over it, {still, turned 180°} × 4 sides: the move is cut,
// and the walker stays on its floor, at the side.
import { describe, it, expect } from "vitest";
import { spawnOn, step, assertWalker } from "./walker.js";
import { checkMesh } from "./navcheck.js";
import { matrixOf } from "./frames.js";
import { baked, box, floor, oracleAll, world } from "./test/arena.js";

const supportOf = (triangles) => ({ triangles, mesh: baked(triangles, [{ kind: "spawn", at: [0, 0, 0] }]) });
const DECK = supportOf(floor()); // 4 × 4, top at 0, 0.1 deep
const DEEP = supportOf(box([-2, -0.6, -2], [2, 0, 2])); // the same, 0.6 deep: heeled, its side stands out under the exit
const POSES = {
  still: matrixOf(null),
  "moved 3 m": matrixOf({ position: [3, 0, -3] }),
  "heeled 30°": matrixOf({ rotation: [0, 0, Math.PI / 6] }),
  "turned 180°": matrixOf({ rotation: [0, Math.PI, 0] }),
};
const SIDES = { "−X": [-1, 0], "+X": [1, 0], "−Z": [0, -1], "+Z": [0, 1] };
// yaw facing a local plan direction: forward is −Z at yaw 0 (walk.js wishVelocity)
const yawTo = ([dx, dz]) => Math.atan2(-dx, -dz);
const FWD = Object.freeze({ forward: 1, strafe: 0 });
const STILL = Object.freeze({ forward: 0, strafe: 0 });

/** Walk off `side` of the deck at `pose` in a world with `ground` and `water`; run until settled. */
function walkOff(M, side, { ground = null, water = null, frames = 900, deck = DECK } = {}) {
  const supports = { deck: { ...deck, M } };
  const env = world(supports, { water, ground });
  let st = spawnOn(env, "deck");
  assertWalker(st, env);
  let yaw = yawTo(SIDES[side]);
  let left = false;
  let first = null; // the first state off the deck
  const seen = new Set();
  let calm = 0;
  for (let i = 0; i < frames; i++) {
    const prev = st;
    ({ state: st, yaw } = step(st, left ? STILL : FWD, yaw, 1 / 60, env));
    assertWalker(st, env);
    const bad = oracleAll(env, st, prev);
    if (bad.length) throw new Error(`frame ${i} (${st.mode}): ${bad.join("; ")}`);
    if (!left && !(st.on === "deck" && st.mesh)) {
      left = true;
      first = st;
    }
    if (left) seen.add(st.mode);
    const still = (st.mode === "walking" || st.mode === "swimming") && Math.hypot(...st.vel) < 1e-9;
    calm = left && still ? calm + 1 : 0;
    if (calm >= 10) break;
  }
  return { st, first, seen, env };
}

/** Where walking off a side with nothing about leaves the deck: the first falling point X, and the side's way in the world plan. */
function exitOf(M, side, deck = DECK) {
  const { first } = walkOff(M, side, { frames: 400, deck });
  expect(first?.mode).toBe("falling");
  const way = [M[0] * SIDES[side][0] + M[8] * SIDES[side][1], M[2] * SIDES[side][0] + M[10] * SIDES[side][1]];
  const l = Math.hypot(...way);
  return { X: first.p, way: [Math.round(way[0] / l), Math.round(way[1] / l)] };
}

/** An axis-aligned box from X: `back` toward the support to `out` away from it along `way`, ±3 m across, y from y0 to y1. */
function slabFrom(X, way, back, out, y0, y1) {
  const a = [X[0] - way[0] * back, X[2] - way[1] * back];
  const b = [X[0] + way[0] * out, X[2] + way[1] * out];
  const across = [Math.abs(way[1]) * 3, Math.abs(way[0]) * 3];
  return box([Math.min(a[0], b[0]) - across[0], y0, Math.min(a[1], b[1]) - across[1]], [Math.max(a[0], b[0]) + across[0], y1, Math.max(a[1], b[1]) + across[1]]);
}

const groundOf = (triangles) => {
  const mesh = baked(triangles);
  expect(checkMesh(mesh)).toEqual([]);
  return { mesh, triangles };
};

const UNDER = [0, 0.3, 1, 2.5, null];
const WATERS = ["none", "at the ground", "1 m under X"];
const ROWS = [];
for (const pose of Object.keys(POSES))
  for (const side of Object.keys(SIDES))
    for (const under of UNDER)
      for (const water of WATERS) {
        if (under == null && water === "at the ground") continue;
        let w3;
        let ends;
        if (under != null && under <= 2) [w3, ends] = ["(1)", "walking on the ground"];
        else if (water === "1 m under X") [w3, ends] = ["(2)", "swimming"];
        else if (under != null) [w3, ends] = ["(3)", "walking on the ground"]; // F2
        else [w3, ends] = ["(3)", "walking on the support"]; // F4
        ROWS.push({ pose, side, under, water, w3, ends });
      }

const EXITS = new Map();
const exit = (pose, side, deck = DECK) => {
  const k = `${pose} ${side} ${deck === DEEP}`;
  if (!EXITS.has(k)) EXITS.set(k, exitOf(POSES[pose], side, deck));
  return EXITS.get(k);
};

const caseOf = (first) => (first.mode === "falling" ? "(3)" : first.mode === "swimming" ? "(2)" : first.on === null ? "(1)" : `on ${first.on}`);
const endOf = (st) => (st.mode === "swimming" ? "swimming" : st.mode === "walking" ? (st.on === null ? "walking on the ground" : "walking on the support") : st.mode);

describe("a support over the ground, walked off each side", { timeout: 120_000 }, () => {
  it("the table: 4 poses × 4 sides × (4 grounds × 3 waters + nothing × 2 waters); (1), (2) and (3) each 32 rows or more", () => {
    expect(ROWS.length).toBe(224);
    for (const c of ["(1)", "(2)", "(3)"]) expect(ROWS.filter((r) => r.w3 === c).length).toBeGreaterThanOrEqual(32);
  });

  it("every row: W3's case, where it ends, and I and the oracle (both supports' triangles) at every step", () => {
    const failed = [];
    for (const r of ROWS) {
      const name = `${r.pose}, ${r.side}, ${r.under == null ? "nothing" : `ground ${r.under} m`} under, water ${r.water}`;
      try {
        const { X, way } = exit(r.pose, r.side);
        const top = X[1] - (r.under ?? 0);
        const ground = r.under == null ? null : groundOf(slabFrom(X, way, 0.3, 4, top - 0.1, top));
        const level = r.water === "none" ? null : r.water === "at the ground" ? top : X[1] - 1;
        const { st, first, seen } = walkOff(POSES[r.pose], r.side, { ground, water: level == null ? null : () => level });
        const got = { w3: caseOf(first), ends: endOf(st) };
        if (got.w3 !== r.w3 || got.ends !== r.ends) failed.push(`${name}: expected ${r.w3} → ${r.ends}, got ${got.w3} → ${got.ends} (through ${[...seen].join(", ")})`);
        if (r.w3 === "(3)" && !seen.has("falling")) failed.push(`${name}: never fell`);
      } catch (e) {
        failed.push(`${name}: ${e.message}`);
      }
    }
    expect(failed).toEqual([]);
  });

  it("a deep support heeled ±30°, walked off ±X onto ground 0.3 m and 1 m under the exit, and over nothing: (1), (1), (3) then F4, its side never in the body", () => {
    const failed = [];
    for (const heel of [30, -30])
      for (const side of ["−X", "+X"])
        for (const under of [0.3, 1, null]) {
          const name = `heeled ${heel}°, ${side}, ${under == null ? "nothing" : `ground ${under} m`} under`;
          POSES[`heeled ${heel}°`] ??= matrixOf({ rotation: [0, 0, (heel * Math.PI) / 180] });
          try {
            const { X, way } = exit(`heeled ${heel}°`, side, DEEP);
            const top = X[1] - (under ?? 0);
            const ground = under == null ? null : groundOf(slabFrom(X, way, 0.3, 4, top - 0.1, top));
            const { st, first } = walkOff(POSES[`heeled ${heel}°`], side, { ground, deck: DEEP });
            const want = under == null ? ["(3)", "walking on the support"] : ["(1)", "walking on the ground"];
            const got = [caseOf(first), endOf(st)];
            if (got.join() !== want.join()) failed.push(`${name}: expected ${want.join(" → ")}, got ${got.join(" → ")}`);
          } catch (e) {
            failed.push(`${name}: ${e.message}`);
          }
        }
    expect(failed).toEqual([]);
  });

  it("W3 (4): beside a ground block from 1 m under the exit to 1 m over it, the move is cut and the walker stays at the side", () => {
    const failed = [];
    for (const pose of ["still", "turned 180°"])
      for (const side of Object.keys(SIDES)) {
        const name = `${pose}, ${side}`;
        try {
          const { X, way } = exit(pose, side);
          const ground = groundOf(slabFrom(X, way, 0.2, 2, X[1] - 1, X[1] + 1));
          const { st, seen } = walkOff(POSES[pose], side, { ground, frames: 120 });
          if (seen.size || st.on !== "deck" || st.mode !== "walking") failed.push(`${name}: left the support (${st.mode} on ${st.on})`);
          // cut at the side, as a WALL: the feet on it, that axis's speed gone
          const [dx, dz] = SIDES[side];
          const at = dx ? st.u : st.v;
          const v = dx ? st.vel[0] : st.vel[1];
          if (at !== ((dx || dz) > 0 ? 1 : 0) || v !== 0) failed.push(`${name}: not cut at the side (u ${st.u}, v ${st.v}, vel ${st.vel})`);
        } catch (e) {
          failed.push(`${name}: ${e.message}`);
        }
      }
    expect(failed).toEqual([]);
  });
});
