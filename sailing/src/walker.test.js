// The walker (walker.js) over baked fixtures, case by case (DESIGN.md,
// "Verification": the numbered list). Every step of every case runs
// assertWalker (invariant I) and, where the ship's triangles are known, the
// oracle on the raw triangles (navcheck.js): the feet on a triangle, the
// body's cylinder clear above the step. The bake's own cases are in
// navmesh.test.js.
import { describe, it, expect } from "vitest";
import { DIRS, OPEN, OVERBOARD, STEP, WALL, bake, inShadow, pointOf } from "./navmesh.js";
import { asserting, assertWalker, climb, leaveStation, localFeet, meetsCapsule, place, spawnOn, step, swimmingAt, takeStation, travel, worldPose } from "./walker.js";
import { DECK, easeEye } from "./walk.js";
import { apply, invert, matrixOf } from "./frames.js";
import { I4, STILL, baked, box, drive, floor, world } from "./test/arena.js";

const FWD = { forward: 1, strafe: 0 };
const BACK = { forward: -1, strafe: 0 };
const RIGHT = { forward: 0, strafe: 1 };
const LEFT = { forward: 0, strafe: -1 };
const JUMP = (k) => ({ ...k, jump: true });
const one = (tris, o = {}) => {
  const mesh = baked(tris, o.seeds ?? []);
  return world({ s: { mesh, M: o.M ?? I4, triangles: tris } }, o);
};
const at = (env, p) => {
  const st = place(env, "s", p);
  assertWalker(st, env);
  return st;
};
const feet = (st) => localFeet(st);
const M = (p = [0, 0, 0], r = [0, 0, 0]) => matrixOf({ position: p, rotation: r, scale: 1 });

describe("the walker, case by case", { timeout: 60_000 }, () => {
  it("1: a flat floor: walks within a cell and across cells; u, v stay in range", () => {
    const env = one(floor());
    const st0 = at(env, [0.01, 0, 0.5]);
    expect(st0.mode).toBe("walking");
    const { st, trace } = drive(env, st0, { input: FWD, frames: 30 });
    expect(st.cell).not.toBe(st0.cell);
    expect(feet(st)[1]).toBeCloseTo(0, 6);
    expect(feet(st)[2]).toBeLessThan(0.5 - 1.2);
    for (const s of trace) expect(s.u >= 0 && s.u <= 1 && s.v >= 0 && s.v <= 1).toBe(true);
  });

  it("2: a STEP up (0.3) and down: the cell changes, the feet follow the new plane, and the side back is a STEP", () => {
    const env = one([...floor(), ...box([-2, 0, -2], [2, 0.3, -0.52])]);
    let { st, trace } = drive(env, at(env, [0.01, 0, 1]), { input: FWD, frames: 36 });
    expect(feet(st)[1]).toBeCloseTo(0.3, 6);
    // the first cell up: its side back (+Z) is a STEP down to a cell on the floor, whose −Z side is a STEP back to it
    const b = trace.find((s) => feet(s)[1] > 0.15);
    const mesh = env.mesh("s");
    let up = b.cell;
    while (mesh.side.kind[up * 4 + 3] === STEP && mesh.side.rise[up * 4 + 3] > -0.15) up = mesh.side.to[up * 4 + 3];
    const down = mesh.side.to[up * 4 + 3];
    expect(mesh.side.kind[up * 4 + 3]).toBe(STEP);
    expect(mesh.side.rise[up * 4 + 3]).toBeCloseTo(-0.3, 5);
    expect(pointOf(mesh, down, 0.5, 0.5)[1]).toBeCloseTo(0, 6);
    expect(mesh.side.kind[down * 4 + 2]).toBe(STEP);
    expect(mesh.side.to[down * 4 + 2]).toBe(up);
    ({ st } = drive(env, st, { input: BACK, frames: 36 }));
    expect(feet(st)[1]).toBeCloseTo(0, 6);
  });

  it("4: a WALL (1.0): you stop with your centre at least r from its face, and within 2c of r", () => {
    const env = one([...floor(), ...box([-2, 0, -1.5], [2, 1.0, -1.02])]);
    const { st } = drive(env, at(env, [0.01, 0, 0.5]), { input: FWD, frames: 90 });
    const d = feet(st)[2] - -1.02;
    expect(d).toBeGreaterThanOrEqual(DECK.radius);
    expect(d).toBeLessThanOrEqual(DECK.radius + 2 * 0.05);
    expect(st.vel[1]).toBe(0);
  });

  it("5: sliding: walking at 30° into the wall keeps the along-wall part; head on, you stop", () => {
    const env = one([...floor(), ...box([-2, 0, -1.5], [2, 1.0, -1.02])]);
    // yaw −60°: forward is (0.866, −0.5): 30° off the wall's line
    const { st } = drive(env, at(env, [-1, 0, -0.5]), { input: FWD, yaw: -Math.PI / 3, frames: 40 });
    expect(feet(st)[0]).toBeGreaterThan(-1 + 1.4);
    expect(feet(st)[2] - -1.02).toBeGreaterThanOrEqual(DECK.radius);
    expect(st.vel[0]).toBeGreaterThan(0.8 * 0.866 * DECK.walk);
    const head = drive(env, at(env, [0.01, 0, -0.4]), { input: FWD, frames: 60 });
    const last = head.trace.slice(-20).map(feet);
    for (const p of last) expect(p).toEqual(last[0]);
  });

  it("6: a concave corner: a diagonal move into it stops there, both axes zeroed", () => {
    const env = one([...floor(), ...box([-2, 0, -1.5], [2, 1, -1.02]), ...box([1.02, 0, -1.5], [1.5, 1, 2])]);
    const { st, trace } = drive(env, at(env, [0.01, 0, 0.01]), { input: { forward: 1, strafe: 1 }, frames: 90 });
    expect(Math.abs(st.vel[0]) + Math.abs(st.vel[1])).toBeLessThan(1e-6);
    const p = feet(st);
    expect(p[0]).toBeGreaterThan(1.02 - DECK.radius - 0.1);
    expect(p[2]).toBeLessThan(-1.02 + DECK.radius + 0.1);
    expect(feet(trace.at(-10))).toEqual(p);
  });

  it("7: a convex corner: along one wall you carry on past it; a diagonal across its cell goes through an orthogonal neighbour, never cutting it", () => {
    const env = one([...floor(), ...box([0.02, 0, -2], [2, 1, -0.02])]);
    const { st } = drive(env, at(env, [-0.5, 0, 1.5]), { input: FWD, frames: 50 });
    expect(feet(st)[2]).toBeLessThan(-0.6);
    expect(feet(st)[0]).toBeCloseTo(-0.5, 6);
    // a cell at the corner: one side across a WALL, the other a STEP whose cell has a STEP across
    const mesh = env.mesh("s");
    let found = 0;
    for (let a = 0; a < mesh.count; a++) {
      for (const [sx, sz] of [[1, 2], [1, 3], [0, 2], [0, 3]]) {
        if (mesh.side.kind[a * 4 + sx] !== WALL || mesh.side.kind[a * 4 + sz] !== STEP) continue;
        const b = mesh.side.to[a * 4 + sz];
        if (mesh.side.kind[b * 4 + sx] !== STEP) continue;
        const c = mesh.side.to[b * 4 + sx];
        const dx = DIRS[sx][0] * 0.75 * mesh.cell;
        const dz = DIRS[sz][1] * 0.75 * mesh.cell;
        const r = travel(mesh, { cell: a, u: 0.5, v: 0.5 }, dx, dz, [dx, dz], false, DECK);
        expect(r.cell).toBe(b);
        expect(r.cell).not.toBe(c);
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("8: exactly through a vertex: both orthogonal sides WALL blocks it; with one a STEP, it goes through that one (X first, both ways round)", () => {
    // a hand-made 2 × 2 mesh: A (0,1), B (1,1) its +X, C (0,0) its −Z, D (1,0) the diagonal
    const grid = (wallAB, wallAC) => {
      const cells = { i: Int32Array.from([0, 1, 0, 1]), k: Int32Array.from([0, 0, 1, 1]), y: new Float32Array(4), gx: new Float32Array(4), gz: new Float32Array(4), lo: new Float32Array(4), hi: new Float32Array(4), ceil: new Float32Array(4).fill(Infinity), headroom: new Float32Array(4).fill(Infinity), region: new Int32Array(4) };
      const kind = new Uint8Array(16).fill(WALL);
      const to = new Int32Array(16).fill(-2);
      const link = (a, s, b) => {
        kind[a * 4 + s] = STEP;
        to[a * 4 + s] = b;
        kind[b * 4 + (s ^ 1)] = STEP;
        to[b * 4 + (s ^ 1)] = a;
      };
      const [C, D, A, B] = [0, 1, 2, 3];
      if (!wallAB) link(A, 1, B);
      if (!wallAC) link(A, 2, C);
      link(B, 2, D);
      link(C, 1, D);
      const normal = new Float32Array(32);
      for (let e = 0; e < 16; e++) (normal[e * 2] = -DIRS[e % 4][0]), (normal[e * 2 + 1] = -DIRS[e % 4][1]);
      return { cell: 0.05, origin: [0, 0], nx: 2, nz: 2, count: 4, cells, side: { kind, to, rise: new Float32Array(16), gap: new Float32Array(16), top: new Float32Array(16).fill(Infinity), exit: new Float32Array(32), normal } };
    };
    const go = (mesh) => travel(mesh, { cell: 2, u: 0.5, v: 0.5 }, 0.05, -0.05, [1, -1], false, DECK);
    const blocked = go(grid(true, true));
    expect([blocked.cell, blocked.u, blocked.v]).toEqual([2, 1, 0]);
    expect(blocked.vel).toEqual([0, 0]);
    expect(go(grid(false, true)).cell).toBe(1); // X open: through B to D
    expect(go(grid(true, false)).cell).toBe(0); // Z open: into C, and X stopped
  });

  it("9: a corner between a STEP (+X) and a WALL (+Z): a diagonal crosses the STEP and slides along the WALL", () => {
    const env = one([...floor(), ...box([0.52, 0, -2], [2, 0.3, 2]), ...box([-2, 0, 1.02], [2, 1.5, 1.5])]);
    const { st } = drive(env, at(env, [0.01, 0, 0.5]), { input: { forward: -1, strafe: 1 }, frames: 45 });
    const p = feet(st);
    expect(p[1]).toBeCloseTo(0.3, 6);
    expect(p[0]).toBeGreaterThan(0.6);
    expect(1.02 - p[2]).toBeGreaterThanOrEqual(DECK.radius);
  });

  it("10: a jump under a ceiling H + 0.3 up caps h at 0.3 and zeroes vy", () => {
    const env = one([...floor(), ...box([-1, 2.05, -1], [1, 2.15, 1])]);
    let peak = 0;
    let bumped = false;
    drive(env, at(env, [0.01, 0, 0.01]), {
      input: (i) => (i === 0 ? JUMP(STILL) : STILL),
      frames: 40,
      each: (s) => {
        if (s.mode !== "airborne") return;
        peak = Math.max(peak, s.h);
        if (Math.abs(s.h - 0.3) < 1e-6 && s.vy === 0) bumped = true;
      },
    });
    expect(peak).toBeCloseTo(0.3, 5);
    expect(bumped).toBe(true);
  });

  it("11: a wire pair: jumping over it works", () => {
    const wires = [...box([-0.006, 0.334, -2], [0.006, 0.346, 2]), ...box([-0.006, 0.614, -2], [0.006, 0.626, 2])];
    const env = one([...floor(), ...wires]);
    const walked = drive(env, at(env, [-0.6, 0, 0.01]), { input: RIGHT, frames: 60 });
    expect(feet(walked.st)[0]).toBeLessThan(-DECK.radius);
    const { st } = drive(env, walked.st, { input: JUMP(RIGHT), frames: 60 });
    expect(feet(st)[0]).toBeGreaterThan(DECK.radius);
  });

  it("12: over a low wall (0.62 < apex 0.661): walking is blocked, a jump vaults it and lands beyond; at 0.7 the jump is blocked too", () => {
    const low = one([...floor(), ...box([-2, 0, -0.6], [2, 0.62, -0.5])]);
    const walked = drive(low, at(low, [0.01, 0, 0.5]), { input: FWD, frames: 60 });
    expect(feet(walked.st)[2]).toBeGreaterThan(-0.5);
    let vaulted = false;
    const { st } = drive(low, walked.st, { input: JUMP(FWD), frames: 50, each: (s) => (vaulted ||= s.mode === "vaulting") });
    expect(vaulted).toBe(true);
    expect(feet(st)[2]).toBeLessThan(-0.6);
    const high = one([...floor(), ...box([-2, 0, -0.6], [2, 0.7, -0.5])]);
    const tried = drive(high, at(high, [0.01, 0, 0.5]), { input: JUMP(FWD), frames: 120 });
    expect(feet(tried.st)[2]).toBeGreaterThan(-0.5);
  });

  it("13: off a ledge (a cabin top 1 m over the sole): walking is blocked; a jump vaults down and lands", () => {
    const env = one([...floor(), ...box([-2, 0, -2], [2, 1.0, 0.02])]);
    const walked = drive(env, at(env, [0.01, 1, -1]), { input: BACK, frames: 60 });
    expect(feet(walked.st)[1]).toBeCloseTo(1, 6);
    let vaulted = false;
    const { st } = drive(env, walked.st, { input: JUMP(BACK), frames: 30, each: (s) => (vaulted ||= s.mode === "vaulting") });
    expect(vaulted).toBe(true);
    expect(st.mode === "walking" || st.mode === "airborne").toBe(true);
    expect(feet(st)[2]).toBeGreaterThan(0.3);
    const down = drive(env, st, { input: STILL, frames: 30 });
    expect(feet(down.st)[1]).toBeCloseTo(0, 6);
  });

  it("14: OPEN: walking off an unrailed edge, you swim at its exit, outside D_r", () => {
    const env = one(floor(), { surface: () => -1 });
    const { st } = drive(env, at(env, [1, 0, 0.01]), { input: RIGHT, frames: 60 });
    expect(st.mode).toBe("swimming");
    expect(inShadow(env.mesh("s"), st.p[0], st.p[1])).toBe(false);
    expect(st.p[0]).toBeGreaterThan(2 + DECK.radius);
  });

  it("15: a rail (a WALL to OVERBOARD at 0.62): walking is held; a jump puts you in the water", () => {
    const env = one([...floor(), ...box([1.9, 0, -2], [1.95, 0.62, 2])], { surface: () => -1 });
    const walked = drive(env, at(env, [1, 0, 0.01]), { input: RIGHT, frames: 60 });
    expect(walked.st.mode).toBe("walking");
    expect(feet(walked.st)[0]).toBeLessThan(1.9 - DECK.radius);
    const { st } = drive(env, walked.st, { input: JUMP(RIGHT), frames: 60 });
    expect(st.mode).toBe("swimming");
  });

  it("18: swimming: pushed out of D_r; a ship moved onto a swimmer puts them out", () => {
    const env = one(floor(), { surface: () => -0.5 });
    const st0 = swimmingAt(env, [1.9, 0]);
    assertWalker(st0, env);
    expect(st0.p[0]).toBeGreaterThan(2);
    env.ships_.s.M = M([st0.p[0] + 1, 0, 0]); // she sails onto them
    const { st } = drive(env, st0, { input: STILL, frames: 1 });
    const local = st.p[0] - (st0.p[0] + 1);
    expect(Math.abs(local)).toBeGreaterThan(2);
  });

  it("18b: two ships rafted 0.1, 0.3 and 0.6 m apart (their D_r overlap): walking off, jumping a rail, or her moving onto you puts you clear of both", () => {
    const hull = floor([-1, 1], [-2, 2]);
    const railed = [...hull, ...box([0.95, 0, -2], [1, 0.62, 2])];
    const clearOfAll = (env, st) => {
      expect(st.mode).toBe("swimming");
      for (const id of ["a", "b"]) {
        const Mi = env.frame(id);
        const L = apply(invert(Mi), [st.p[0], env.surface(st.p[0], st.p[1]), st.p[1]]);
        expect(inShadow(env.mesh(id), L[0], L[2]), `in ${id}'s D_r at ${L[0].toFixed(3)}, ${L[2].toFixed(3)}`).toBe(false);
        // her hull spans |x| ≤ 1, |z| ≤ 2: a swimmer is at least r clear of it
        expect(Math.max(Math.abs(L[0]) - 1, Math.abs(L[2]) - 2)).toBeGreaterThanOrEqual(DECK.radius - 1e-6);
      }
    };
    for (const gap of [0.1, 0.3, 0.6]) {
      const two = (tris) => world({ a: { mesh: baked(tris), M: I4, triangles: tris }, b: { mesh: baked(tris), M: M([2 + gap, 0, 0]), triangles: tris } }, { surface: () => -0.5 });
      // walk off a's +X OPEN edge (W3 → SW1): the step across finds no deck of b's within a step under the exit
      const env = two(hull);
      let st = place(env, "a", [0.5, 0, 0.01]);
      let yaw = 0;
      for (let i = 0; i < 60 && st.mode !== "swimming"; i++) {
        ({ state: st, yaw } = step(st, RIGHT, yaw, 1 / 60, env));
        if (st.mode !== "walking" || st.ship !== "a") break;
      }
      if (st.mode === "swimming") clearOfAll(env, st);
      else expect(st.ship).toBe("b"); // a gap a step bridges: onto her deck
      // jump the rail (A4 → V2 → OVERBOARD → SW1)
      const envR = two(railed);
      const r = drive(envR, place(envR, "a", [0.5, 0, 0.01]), { input: (i) => (i < 20 ? RIGHT : JUMP(RIGHT)), frames: 80, oracleOn: false });
      clearOfAll(envR, r.st);
      // a swimmer between them, then b closes up on them
      const envS = two(hull);
      const s0 = swimmingAt(envS, [1 + gap / 2, 0]);
      assertWalker(s0, envS);
      clearOfAll(envS, s0);
      envS.ships_.b.M = M([2 + gap - 0.3, 0, 0.2]);
      clearOfAll(envS, drive(envS, s0, { frames: 1 }).st);
    }
  });

  it("19: the ladder: from its foot, F has you walking at its top, facing inboard", () => {
    const seeds = [{ kind: "spawn", at: [0, 0, 0] }, { kind: "ladder", id: "l", at: [1.5, 0, 0], hook: [2, 0, 0], yaw: Math.PI / 2 }];
    const env = one(floor(), { seeds, surface: () => -1 });
    const up = climb(env, "s");
    assertWalker(up, env);
    const r = step(up, STILL, 0, 1 / 60, env);
    assertWalker(r.state, env);
    expect(r.state.mode).toBe("walking");
    expect(feet(r.state)[0]).toBeCloseTo(1.5, 1);
    expect(r.yaw).toBeCloseTo(Math.PI / 2);
  });

  it("20: a station: taking it puts you at its link; WASD don't move you; leaving, you walk from the same cell", () => {
    const env = one(floor(), { seeds: [{ kind: "spawn", at: [0, 0, 0] }, { kind: "station", id: "helm", at: [0.5, 0, 0.5] }] });
    const took = takeStation(env, "s", "helm");
    assertWalker(took.state, env);
    const link = env.mesh("s").links.find((l) => l.id === "helm");
    expect(took.state.cell).toBe(link.at.cell);
    const { st } = drive(env, took.state, { input: FWD, frames: 30 });
    expect(feet(st)).toEqual(feet(took.state));
    const left = leaveStation(st);
    assertWalker(left, env);
    expect([left.mode, left.cell, left.u, left.v]).toEqual(["walking", st.cell, st.u, st.v]);
  });

  it("21: her motion under a standing walker: the local state is bit-identical, the world feet M · local", () => {
    const env = one(floor());
    const st0 = at(env, [0.3, 0, -0.2]);
    let st = st0;
    for (let i = 0; i < 300; i++) {
      const t = i / 60;
      env.ships_.s.M = M([3 * t, 0.4 * Math.sin(1.3 * t), -t], [0.35 * Math.sin(0.9 * t), 0.5 * t, 0.52 * Math.sin(1.7 * t)]);
      st = step(st, STILL, 0, 1 / 60, env).state;
      assertWalker(st, env);
      expect([st.cell, st.u, st.v]).toEqual([st0.cell, st0.u, st0.v]);
      const w = worldPose(st, env);
      expect(w.feet).toEqual(apply(env.ships_.s.M, feet(st0)));
    }
  });

  it("22: her motion under a walking walker: the same keys give the same path on her deck, whatever she does", () => {
    const tris = [...floor(), ...box([-2, 0, -2], [2, 0.3, -0.52]), ...box([0.8, 0, -0.4], [1.2, 1, 0.4])];
    const keys = (i) => (i < 40 ? FWD : i < 80 ? RIGHT : i < 100 ? JUMP(BACK) : LEFT);
    const path = (mOf) => {
      const env = one(tris);
      const out = [];
      let st = at(env, [0.01, 0, 1]);
      for (let i = 0; i < 150; i++) {
        env.ships_.s.M = mOf(i / 60);
        st = step(st, keys(i), 0, 1 / 60, env).state;
        assertWalker(st, env);
        out.push(feet(st));
      }
      return out;
    };
    const a = path(() => I4);
    const b = path((t) => M([5 * t, 0.5 * Math.sin(2 * t), 0], [0.5 * Math.sin(t), 2 * t, 0.3]));
    expect(b).toEqual(a);
  });

  it("23: a rebake under a walker: the floor under you gone, you're projected to the nearest cell; an empty mesh, you swim", () => {
    const env = one(floor());
    let st = at(env, [0.01, 0, 0.01]);
    env.ships_.s.mesh = baked([...floor(), ...box([-0.5, 0, -0.5], [0.5, 1.5, 0.5])]);
    env.ships_.s.triangles = null;
    st = step(st, STILL, 0, 1 / 60, env).state;
    assertWalker(st, env);
    expect(st.mode).toBe("walking");
    expect(st.mesh).toBe(env.ships_.s.mesh);
    const p = feet(st);
    expect(Math.max(Math.abs(p[0]), Math.abs(p[2]))).toBeGreaterThan(0.5 + DECK.radius);
    env.ships_.s.mesh = bake({ triangles: [] }, DECK);
    st = step(st, STILL, 0, 1 / 60, env).state;
    assertWalker(st, env);
    expect(st.mode).toBe("swimming");
    // heading 90°: aboard, yaw is to her bow; in the water, the world's. The look doesn't turn across the rebake
    const turned = one(floor(), { M: M([0, 0, 0], [0, Math.PI / 2, 0]) });
    const aboard = place(turned, "s", [0.01, 0, 0.01]);
    const look = 0.4 + worldPose(aboard, turned).heading;
    turned.ships_.s.mesh = bake({ triangles: [] }, DECK);
    const r = step(aboard, STILL, 0.4, 1 / 60, turned);
    assertWalker(r.state, turned);
    expect(r.state.mode).toBe("swimming");
    expect(r.yaw).toBeCloseTo(look, 9);
  });

  it("B1/G1 while boarding: her mesh lands (onto her, or, empty, into the water facing the same way); she's removed, or her model never comes: you swim", () => {
    const heading = Math.PI / 2;
    // her first mesh lands
    const env = world({ s: { mesh: null, M: M([3, 0, 0], [0, heading, 0]) } }, { surface: () => -1 });
    const b = spawnOn(env, "s");
    expect(b.mode).toBe("boarding");
    assertWalker(b, env);
    expect(step(b, STILL, 0, 1 / 60, env).state.mode).toBe("boarding");
    env.ships_.s.mesh = baked(floor(), [{ kind: "spawn", at: [0, 0, 0] }]);
    expect(step(b, STILL, 0, 1 / 60, env).state.mode).toBe("walking");
    // an empty first mesh: into the water, the look unturned
    env.ships_.s.mesh = bake({ triangles: [] }, DECK);
    const wet = step(b, STILL, 0.2, 1 / 60, env);
    assertWalker(wet.state, env);
    expect(wet.state.mode).toBe("swimming");
    expect(wet.yaw).toBeCloseTo(0.2 + heading, 9);
    // she's removed while you wait: you swim, at `from` (the camera) if given, else where you'd have boarded
    const gone = world({ s: { mesh: null, M: M([3, 0, 0], [0, heading, 0]) } }, { surface: () => -1 });
    let st = { ...spawnOn(gone, "s"), from: [10, 2, -4] };
    st = step(st, STILL, 0, 1 / 60, gone).state;
    expect(st.mode).toBe("boarding");
    gone.ships_.s.M = null;
    const r = step(st, STILL, 0.2, 1 / 60, gone);
    assertWalker(r.state, gone);
    expect(r.state.mode).toBe("swimming");
    expect(r.state.p).toEqual([10, -4]);
    expect(r.yaw).toBeCloseTo(0.2 + heading, 9);
    // her model never comes: after WALKER.boardWait you swim, beside where she is
    const never = world({ s: { mesh: null, M: M([3, 0, 0]) } }, { surface: () => -1 });
    let n = spawnOn(never, "s");
    for (let i = 0; i < 15 * 10 + 2 && n.mode === "boarding"; i++) n = step(n, STILL, 0, 0.1, never).state;
    assertWalker(n, never);
    expect(n.mode).toBe("swimming");
    expect(n.p[0]).toBeCloseTo(3, 6);
  });

  it("24: place: a point over the water means swimming; one by the deck is projected onto a cell", () => {
    const env = one(floor(), { surface: () => -1 });
    expect(place(env, "s", [5, 0, 0]).mode).toBe("swimming");
    const st = place(env, "s", [0.2, 0.4, 0.3]);
    expect(st.mode).toBe("walking");
    expect(feet(st)[1]).toBeCloseTo(0, 6);
    expect(Math.hypot(feet(st)[0] - 0.2, feet(st)[2] - 0.3)).toBeLessThan(0.05);
    // over the deck but far above it: still on her (the nearest cell), not in the water
    expect(place(env, "s", [0.2, 3, 0.3]).mode).toBe("walking");
    // a point in the air drops onto what's under it, not onto a higher deck far off that's within a step of it
    const sheer = one([...floor([-2, 2], [-2, 0.5]), ...box([-2, 0.4, 0.5], [2, 0.5, 6])]);
    const dropped = place(sheer, "s", [0, 0.9, -1]);
    expect(feet(dropped)[1]).toBeCloseTo(0, 6);
    expect(feet(dropped)[2]).toBeCloseTo(-1, 1);
    // no mesh yet: boarding, which lands when it comes
    const later = world({ s: { mesh: null, M: I4 } });
    const b = place(later, "s", [0, 0, 0]);
    expect(b.mode).toBe("boarding");
    later.ships_.s.mesh = baked(floor());
    expect(step(b, STILL, 0, 1 / 60, later).state.mode).toBe("walking");
  });

  it("26: stepping across: an OPEN side over another ship's kept cell puts you on her deck, in her frame", () => {
    const a = floor([-2, 0]);
    const b = floor([-2, 2], [-2, 2], -0.3);
    for (const turn of [0, Math.PI / 2]) {
      const env = world({ a: { mesh: baked(a), M: I4, triangles: a }, b: { mesh: baked(b), M: M([0, 0, 0], [0, turn, 0]), triangles: b } });
      let st = place(env, "a", [-1, 0, 0.01]);
      let yaw = 0;
      for (let i = 0; i < 60 && st.ship === "a"; i++) ({ state: st, yaw } = step(st, RIGHT, yaw, 1 / 60, env));
      assertWalker(st, env);
      expect(st.ship).toBe("b");
      expect(st.mode).toBe("walking");
      expect(yaw).toBeCloseTo(-turn, 6);
      expect(worldPose(st, env).feet[1]).toBeCloseTo(-0.3, 5);
    }
  });

  it("27: a huge dt or speed: the move is capped, and I holds", () => {
    const env = one([...floor(), ...box([-2, 0, -1.5], [2, 1.0, -1.02])]);
    let st = at(env, [0.01, 0, 0.5]);
    for (const dt of [5, 50, 1e6]) {
      const before = feet(st);
      st = step(st, FWD, 0, dt, env).state;
      assertWalker(st, env);
      const p = feet(st);
      expect(Math.hypot(p[0] - before[0], p[2] - before[2])).toBeLessThanOrEqual(1 + 1e-9);
    }
    st = step({ ...st, vel: [1e9, -1e9] }, FWD, 0, 1, env).state;
    assertWalker(st, env);
    const air = step(st, JUMP(FWD), 0, 1e3, env).state;
    assertWalker(air, env);
  });

  it("28: the boom: walking into its capsule stops you; a jump under it is capped", () => {
    let caps = [{ a: [-2, 1.2, -1], b: [2, 1.2, -1], r: 0.07 }];
    const env = one(floor(), { blockers: () => caps });
    const { st } = drive(env, at(env, [0.01, 0, 0.5]), { input: FWD, frames: 60 });
    const z = feet(st)[2];
    expect(z - -1).toBeGreaterThanOrEqual(DECK.radius + 0.07);
    expect(z - -1).toBeLessThan(DECK.radius + 0.07 + 0.1);
    caps = [{ a: [-2, 2.02, 0.5], b: [2, 2.02, 0.5], r: 0.07 }];
    let peak = 0;
    drive(env, at(env, [0.01, 0, 0.5]), { input: (i) => (i === 0 ? JUMP(STILL) : STILL), frames: 40, each: (s) => (peak = Math.max(peak, s.h ?? 0)) });
    expect(peak).toBeGreaterThan(0.15);
    expect(peak).toBeLessThanOrEqual(0.2 + 1e-3);
    expect(meetsCapsule([0, 0.5], 0, DECK.height, DECK.radius, caps[0])).toBe(false);
  });

  it("29: the cockpit's STEP (0.52 up, then down): the feet jump in one frame and step() says by how much; the drawn eye (easeEye) moves under 0.1 m a frame and catches up within 0.15 s", () => {
    const env = one([...floor(), ...box([-2, 0, -2], [2, 0.52, -0.52])]);
    for (const [from, keys] of [[[0.01, 0, 0.6], FWD], [[0.01, 0.52, -1.2], BACK]]) {
      let st = at(env, from);
      let lag = 0;
      let prevEye = feet(st)[1] + DECK.eye;
      let worst = 0;
      let jumped = 0;
      let lifted = 0;
      let stepAt = -1;
      let settledAt = -1;
      for (let i = 0; i < 40; i++) {
        const y0 = feet(st)[1];
        const r = step(st, keys, 0, 1 / 60, env);
        st = r.state;
        assertWalker(st, env);
        jumped = Math.max(jumped, Math.abs(feet(st)[1] - y0));
        if (r.lift) (lifted += r.lift), (stepAt = i);
        lag = easeEye(lag, r.lift, 1 / 60);
        if (stepAt >= 0 && settledAt < 0 && lag === 0) settledAt = i;
        const drawn = feet(st)[1] + DECK.eye + lag;
        worst = Math.max(worst, Math.abs(drawn - prevEye));
        prevEye = drawn;
      }
      expect(jumped).toBeGreaterThan(0.5); // the state is exact: the feet do jump
      expect(Math.abs(lifted)).toBeCloseTo(0.52, 6);
      expect(worst).toBeLessThan(0.1);
      expect(stepAt).toBeGreaterThanOrEqual(0);
      expect((settledAt - stepAt) / 60).toBeLessThanOrEqual(0.15 + 1e-9);
    }
  });

  it("W5: awash (her deck sunk 1.5 m under the sea), you swim, put out of her D_r; G1: she's gone, you swim where you were", () => {
    let level = -1;
    const env = one(floor(), { surface: () => level });
    let st = at(env, [0.01, 0, 0.01]);
    level = 1.6;
    st = drive(env, st, { frames: 1 }).st;
    expect(st.mode).toBe("swimming");
    const env2 = one(floor());
    let st2 = at(env2, [0.5, 0, 0.5]);
    st2 = drive(env2, st2, { frames: 2 }).st;
    env2.ships_.s.M = null;
    const r = step(st2, STILL, 0.3, 1 / 60, env2);
    expect(r.state.mode).toBe("swimming");
    expect(r.state.p[0]).toBeCloseTo(0.5, 6);
    expect(r.yaw).toBeCloseTo(0.3, 6);
  });

  it("the invariant is asserted here: a breach throws (vitest is a dev build)", () => {
    expect(globalThis.__SAILING_ASSERT__).toBeUndefined();
    expect(asserting()).toBe(true);
  });

  it("spawn: her spawn link, projected", () => {
    const env = one(floor(), { seeds: [{ kind: "spawn", at: [0.5, 0.2, 0.5] }] });
    const st = spawnOn(env, "s");
    assertWalker(st, env);
    expect(feet(st)[0]).toBeCloseTo(0.5, 1);
  });
});
