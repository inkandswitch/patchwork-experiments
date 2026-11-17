// Fixtures for the walker's unit cases and its enumerated cases: a few boxes as
// triangles, baked, a world of supports to step in, and a driver that checks
// invariant I (and, given the triangles, the oracle) after every step.
import { bake, boxTriangles } from "../navmesh.js";
import { assertWalker, localFeet, step } from "../walker.js";
import { bodyMeets, indexTriangles, meets, oracle, swimmerClear } from "../navcheck.js";
import { BODY, SWIM } from "../walk.js";
import { apply, invert, matrixOf, multiply } from "../frames.js";

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
export const baked = (triangles, seeds = [], params = BODY) => bake({ triangles, seeds }, params);

/** Triangles through a matrix. */
export function placed(triangles, M) {
  const out = new Array(triangles.length);
  for (let o = 0; o + 2 < triangles.length; o += 3) {
    const p = apply(M, [triangles[o], triangles[o + 1], triangles[o + 2]]);
    out[o] = p[0];
    out[o + 1] = p[1];
    out[o + 2] = p[2];
  }
  return out;
}

/**
 * A world of supports: { id: { mesh, M, triangles? } }, M mutable, and the
 * ground (`ground: { mesh, triangles? }`, id null, the identity frame).
 * `water(x, z)` is the surface's height, or null for none (the default is a
 * surface far below: walking off a support you swim, and nothing's awash).
 */
export function world(supports, { water = () => -100, ground = null, blockers = null } = {}) {
  const entry = (id) => (id == null ? ground : supports[id]);
  const env = {
    supports: () => [...Object.keys(supports), null],
    mesh: (id) => entry(id)?.mesh ?? null,
    frame: (id) => (id == null ? I4 : (supports[id]?.M ?? null)),
    water: (x, z) => (water ? water(x, z) : null),
    blockers: blockers ? (id) => blockers(id) : undefined,
    supports_: supports,
    ground_: ground,
  };
  env.index = (id) => {
    const e = entry(id);
    if (!e) return null;
    return (e.index ??= e.triangles ? indexTriangles(e.triangles) : null);
  };
  // a support's triangles through a matrix, indexed (the oracle against other supports), cached by the matrix
  const cache = new Map();
  env.indexThrough = (id, M) => {
    const e = entry(id);
    if (!e?.triangles) return null;
    const key = `${id}|${M.map((v) => v.toPrecision(12)).join(",")}`;
    let ix = cache.get(key);
    if (!ix) cache.set(key, (ix = indexTriangles(placed(e.triangles, M))));
    return ix;
  };
  return env;
}

/**
 * The oracle for any state against every support's raw triangles (where the
 * world knows them): on a support, its own oracle (feet over a triangle, the
 * body clear above the step) and, in its frame, the body clear of every other
 * support's triangles above the step; swimming, clear of every moving
 * support within r at any height and of the ground over the body's height;
 * falling, the body's cylinder clear of every support over its sweep since a
 * falling `prev` (x, then z, then y, as fall takes it; the plan legs as
 * cylinders under r/2 apart, so a triangle across the centre's path is
 * met). A support moving into a falling body lifts it: rows where that
 * happens while it keeps falling can't use this sweep. @returns {string[]} problems
 */
export function oracleAll(env, st, prev = null, P = BODY, S = SWIM) {
  const bad = [];
  const ids = env.supports();
  if (st.mesh) {
    const own = env.index(st.on);
    if (own) bad.push(...oracle(own, st.mesh, st));
    const Ms = env.frame(st.on);
    for (const id of ids) {
      if (id === st.on || !env.mesh(id)) continue;
      const ix = env.indexThrough(id, multiply(invert(Ms), env.frame(id)));
      if (!ix) continue;
      const t = bodyMeets(ix, st.mesh, st);
      if (t != null) bad.push(`body meets ${id ?? "the ground"}'s triangle ${t} at ${localFeet(st).map((v) => v.toFixed(3))}`);
    }
    return bad;
  }
  if (st.mode === "swimming") {
    const y = env.water(st.p[0], st.p[1]);
    for (const id of ids) {
      if (!env.mesh(id)) continue;
      if (id == null) {
        const ix = env.index(null);
        if (ix && meets(ix, st.p, y - S.depth, y - S.depth + P.height, P.radius) != null) bad.push(`a swimmer in the ground at ${st.p.map((v) => v.toFixed(3))}`);
        continue;
      }
      const ix = env.index(id);
      if (!ix) continue;
      const L = apply(invert(env.frame(id)), [st.p[0], y, st.p[1]]);
      if (!swimmerClear(ix, [L[0], L[2]], P.radius)) bad.push(`a swimmer within r of ${id} at ${L.map((v) => v.toFixed(3))}`);
    }
    return bad;
  }
  if (st.mode === "falling") {
    const from = prev?.mode === "falling" ? prev.p : st.p;
    // [x, z, y0, y1]: the plan legs at from's height, then the drop at st's plan point
    const cyl = [];
    let [x, z] = [from[0], from[2]];
    for (const axis of [0, 2]) {
      const d = st.p[axis] - (axis === 0 ? x : z);
      const n = Math.ceil(Math.abs(d) / (P.radius / 2));
      for (let k = 0; k <= n; k++) {
        const t = n ? (d * k) / n : 0;
        cyl.push(axis === 0 ? [x + t, z] : [x, z + t]);
      }
      if (axis === 0) x = st.p[0];
      else z = st.p[2];
    }
    const at = cyl.map(([a, b]) => [a, b, from[1], from[1] + P.height]);
    at.push([st.p[0], st.p[2], Math.min(from[1], st.p[1]), Math.max(from[1], st.p[1]) + P.height]);
    for (const id of ids) {
      if (!env.mesh(id)) continue;
      const ix = env.indexThrough(id, env.frame(id));
      if (!ix) continue;
      for (const [a, b, y0, y1] of at) {
        const t = meets(ix, [a, b], y0, y1, P.radius);
        if (t != null) {
          bad.push(`falling body meets ${id ?? "the ground"}'s triangle ${t} at ${[a, y0, b].map((v) => v.toFixed(3))}`);
          break;
        }
      }
    }
  }
  return bad;
}

/**
 * Step `frames` times, asserting I after each (and the oracle where the
 * support's triangles are known; `all`: against every support's, in every
 * state). `input` is an object or (i, st) => object.
 * @returns {{ st, yaw, trace: object[] }}
 */
export function drive(env, st, { input = STILL, yaw = 0, frames = 60, dt = 1 / 60, each = null, oracleOn = true, all = false } = {}) {
  const trace = [];
  for (let i = 0; i < frames; i++) {
    const prev = st;
    const r = step(st, typeof input === "function" ? input(i, st) : input, yaw, dt, env);
    st = r.state;
    yaw = r.yaw;
    assertWalker(st, env, prev);
    if (all) {
      const bad = oracleAll(env, st, prev);
      if (bad.length) throw new Error(`oracle at frame ${i} (${st.mode}): ${bad.join("; ")}`);
    } else if (oracleOn && st.mesh && env.index(st.on)) {
      const bad = oracle(env.index(st.on), st.mesh, st);
      if (bad.length) throw new Error(`oracle at frame ${i}: ${bad.join("; ")}`);
    }
    trace.push(st);
    each?.(st, i);
  }
  return { st, yaw, trace };
}
