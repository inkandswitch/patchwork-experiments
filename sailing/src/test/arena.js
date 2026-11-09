// Fixtures for the walker's unit cases and its property test: a few boxes as
// triangles, baked, a world of ships to step in, and a driver that checks
// invariant I (and, given the triangles, the oracle) after every step.
import { bake, boxTriangles } from "../navmesh.js";
import { assertWalker, step } from "../walker.js";
import { indexTriangles, oracle } from "../navcheck.js";
import { DECK } from "../walk.js";
import { matrixOf } from "../frames.js";

export const I4 = matrixOf(null);
export const STILL = Object.freeze({ forward: 0, strafe: 0 });

/** A floor slab, top at y = 0: x and z from −half to half (or [x0, x1], [z0, z1]). */
export const floor = (x = [-2, 2], z = [-2, 2], top = 0) => boxTriangles([x[0], top - 0.1, z[0]], [x[1], top, z[1]]);
export const box = (min, max) => boxTriangles(min, max);

/** A slab tilted about the Z axis: rising `deg` from x0 along +X, `length` long, z from z0 to z1 (its top surface only). */
export function ramp(x0, length, z0, z1, deg) {
  const t = Math.tan((deg * Math.PI) / 180);
  const x1 = x0 + length;
  const y1 = length * t;
  return [x0, 0, z0, x1, y1, z1, x1, y1, z0, x0, 0, z0, x0, 0, z1, x1, y1, z1];
}

/** An open vertical tube (four sides, no top): a stanchion. */
export function post([x, z], half, y0, y1) {
  const c = [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
  const out = [];
  for (let k = 0; k < 4; k++) {
    const [a, b] = [c[k], c[(k + 1) % 4]];
    out.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
  }
  return out;
}

/** Bake triangles (with seeds, or none: every component kept). */
export const baked = (triangles, seeds = [], params = DECK) => bake({ triangles, seeds }, params);

/**
 * A world of ships: { id: { mesh, M, triangles? } }, M mutable. `surface` is
 * the sea's height (default far below: nothing's awash).
 */
export function world(ships, { surface = () => -100, blockers = null } = {}) {
  const env = {
    ships: () => Object.keys(ships),
    mesh: (id) => ships[id]?.mesh ?? null,
    frame: (id) => ships[id]?.M ?? null,
    surface: (x, z) => surface(x, z),
    blockers: blockers ? (id) => blockers(id) : undefined,
    ships_: ships,
  };
  env.index = (id) => (ships[id].index ??= ships[id].triangles ? indexTriangles(ships[id].triangles) : null);
  return env;
}

/**
 * Step `frames` times, asserting I after each (and the oracle where the
 * ship's triangles are known). `input` is an object or (i) => object.
 * @returns {{ st, yaw, trace: object[] }}
 */
export function drive(env, st, { input = STILL, yaw = 0, frames = 60, dt = 1 / 60, each = null, oracleOn = true } = {}) {
  const trace = [];
  for (let i = 0; i < frames; i++) {
    const r = step(st, typeof input === "function" ? input(i) : input, yaw, dt, env);
    st = r.state;
    yaw = r.yaw;
    assertWalker(st, env);
    if (oracleOn && st.mesh && st.ship && env.index(st.ship)) {
      const bad = oracle(env.index(st.ship), st.mesh, st);
      if (bad.length) throw new Error(`oracle at frame ${i}: ${bad.join("; ")}`);
    }
    trace.push(st);
    each?.(st, i);
  }
  return { st, yaw, trace };
}
