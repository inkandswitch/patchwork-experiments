// The walker: a small state machine over the navmeshes of the supports a
// person stands in (DESIGN.md, "Standing on supports"). Pure: no THREE, no
// rays, no scene. Its state can't name a place that isn't one: on a
// support, a position is (support, cell, u, v) and a height over it, in
// that support's frame; in the water, a plan point in the ground's frame;
// in the air, a point in the ground's frame that is clear of everything.
// The world pose is derived from the support's frame each frame and never
// fed back, so nothing that moves a support moves the walker through
// anything.
//
// A support is a frame you stand in. The ground, the stage's own frame, is
// one, with id null; every other one moves (a deck, a lift).
//
// States (those on a support also carry `mesh`, the mesh their cell numbers
// refer to, and `last`, where it was in the world: derived, for when the
// support goes):
//   waiting   { on, at, last }                    on's mesh isn't here yet: no position (at: where to stand, on's frame; null: its spawn)
//   walking   { on, cell, u, v, vel }             vel: plan, on's frame
//   airborne  { on, cell, u, v, h, vy, vel }      h: feet over the surface
//   vaulting  { on, cell, side, d, h, vy, vel, w } across a WALL's checked band
//   swimming  { p: [x, z], vel: [vx, vz] }        the ground's frame; feet at the water's surface less SWIM.depth
//   falling   { p: [x, y, z], vel: [vx, vy, vz], rest }  the ground's frame, the feet; rest: s held by a surface that is no cell
//
// The environment it's stepped in:
//   env.supports() → ids, the ground (null) among them    env.frame(id) → 4×4 | null (asked of moving supports only)
//   env.mesh(id) → NavMesh | null                          env.water(x, z) → the surface's height there | null (no water)
//   env.blockers?(id) → [{ o, A, h }] oriented boxes in that support's frame: moving obstacles that only block

import { DIRS, NONE, OFF, OPEN, STEP, WALL, columnAt, inShadow, isEmpty, planOf, pointOf, projectPoint, putOutAt, sideBase, surfaceAt } from "./navmesh.js";
import { apply, headingOf, invert, rotateM, scaleOf, unrotateM } from "./frames.js";
import { BODY, SWIM, wishVelocity } from "./walk.js";

const TOL = 1e-6;
const I4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * Is invariant I asserted (a breach throws)? In tests (vitest: import.meta.env.DEV),
 * in the probe pages (they set the flag) and wherever globalThis.__WALK_ASSERT__
 * is set; a production build (DEV replaced by false) logs once and projects.
 */
export const asserting = () => Boolean(globalThis.__WALK_ASSERT__ ?? import.meta.env?.DEV ?? false);

/** The walker's own constants on top of BODY. */
export const WALKER = Object.freeze({
  vault: 1.5, // the least speed across a vault's band (m/s)
  maxMove: 1, // the most a move goes in one step (m), whatever dt
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ON = new Set(["walking", "airborne", "vaulting"]);

/** Move `v` toward `target` by at most `max` (2D). */
function approach(v, target, max) {
  const dx = target[0] - v[0];
  const dz = target[1] - v[1];
  const d = Math.hypot(dx, dz);
  if (d <= max || d === 0) return [target[0], target[1]];
  return [v[0] + (dx / d) * max, v[1] + (dz / d) * max];
}

// ─── the supports ───────────────────────────────────────────────────────────

/** A support's frame: the ground's is the stage's own, the identity. */
const frameOf = (env, id) => (id == null ? I4 : env.frame(id));

/** The water's height at a plan point of the ground, or null. */
const waterAt = (env, x, z) => {
  const y = env.water?.(x, z);
  return Number.isFinite(y) ? y : null;
};

/** The frame a state's yaw is measured in: its support's, or the ground's. */
const frameOfState = (env, st) => (st && (ON.has(st.mode) || st.mode === "waiting") ? frameOf(env, st.on) : I4) ?? I4;

/** A yaw measured in frame M, measured in the frame of `next` instead. */
const yawInto = (env, yaw, M, next) => yaw + headingOf(M) - headingOf(frameOfState(env, next));

/**
 * Every support with a frame and a mesh, in order: by id, the ground last (so
 * a tie goes to the lowest id, and to the ground only when nothing else ties).
 */
function supportList(env) {
  const ids = [...(env.supports?.() ?? [])];
  ids.sort((a, b) => (a == null ? 1 : b == null ? -1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  const out = [];
  for (const id of ids) {
    const M = frameOf(env, id);
    const mesh = env.mesh(id);
    if (M && mesh) out.push({ id, M, inv: invert(M), mesh });
  }
  return out;
}

// ─── clear: the body against every support's raster ─────────────────────────

const unit = (M, i) => {
  const l = Math.hypot(M[i * 4], M[i * 4 + 1], M[i * 4 + 2]) || 1;
  return [M[i * 4] / l, M[i * 4 + 1] / l, M[i * 4 + 2] / l];
};
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Do two boxes meet, by more than TOL along every axis? An axis-aligned one
 * (centre c, half extents e) and an oriented one (centre o, unit axes A,
 * half extents h). Separating axes: the six face normals and their nine
 * cross products.
 */
function boxesMeet(c, e, o, A, h) {
  const T = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const E = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const axes = [...E, ...A];
  for (const a of E) for (const b of A) axes.push([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
  for (const L of axes) {
    const l = Math.hypot(L[0], L[1], L[2]);
    if (l < 1e-9) continue;
    const n = [L[0] / l, L[1] / l, L[2] / l];
    const ra = e[0] * Math.abs(n[0]) + e[1] * Math.abs(n[1]) + e[2] * Math.abs(n[2]);
    const rb = h[0] * Math.abs(dot3(A[0], n)) + h[1] * Math.abs(dot3(A[1], n)) + h[2] * Math.abs(dot3(A[2], n));
    if (Math.abs(dot3(T, n)) >= ra + rb - TOL) return false;
  }
  return true;
}

/**
 * The first box of support s's raster (a column's square × one of its
 * intervals: everything its triangles hold there, B-conservative) that the
 * world box [lo, hi] meets, as the world height of that box's top; null if
 * none: the box is clear of s. Open by TOL, so feet resting on a surface are
 * clear of it.
 */
function meetsRaster(s, lo, hi) {
  const { mesh, M, inv } = s;
  const iv = mesh.intervals;
  if (!iv || !iv.lo.length) return null;
  let l0 = [Infinity, Infinity, Infinity];
  let l1 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const p = apply(inv, [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]]);
    for (let j = 0; j < 3; j++) {
      if (p[j] < l0[j]) l0[j] = p[j];
      if (p[j] > l1[j]) l1[j] = p[j];
    }
  }
  const c = mesh.cell;
  const i0 = Math.max(0, Math.floor((l0[0] - mesh.origin[0]) / c));
  const i1 = Math.min(mesh.nx - 1, Math.floor((l1[0] - mesh.origin[0]) / c));
  const k0 = Math.max(0, Math.floor((l0[2] - mesh.origin[1]) / c));
  const k1 = Math.min(mesh.nz - 1, Math.floor((l1[2] - mesh.origin[1]) / c));
  if (i0 > i1 || k0 > k1) return null;
  const sc = scaleOf(M);
  const A = [unit(M, 0), unit(M, 1), unit(M, 2)];
  const bc = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const be = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2];
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      const col = k * mesh.nx + i;
      for (let b = iv.start[col]; b < iv.start[col + 1]; b++) {
        const ylo = iv.lo[b];
        const yhi = iv.hi[b];
        if (yhi <= l0[1] + TOL || ylo >= l1[1] - TOL) continue;
        const o = apply(M, [mesh.origin[0] + (i + 0.5) * c, (ylo + yhi) / 2, mesh.origin[1] + (k + 0.5) * c]);
        const h = [(c / 2) * sc, ((yhi - ylo) / 2) * sc, (c / 2) * sc];
        if (boxesMeet(bc, be, o, A, h)) return o[1] + h[0] * Math.abs(A[0][1]) + h[1] * Math.abs(A[1][1]) + h[2] * Math.abs(A[2][1]);
      }
    }
  }
  return null;
}

/** The body's box (radius r, feet to feet + H) at world feet p. */
const bodyBox = (p, P) => [[p[0] - P.radius, p[1], p[2] - P.radius], [p[0] + P.radius, p[1] + P.height, p[2] + P.radius]];

/** Is the body clear at world feet p: its box meets no support's raster (open in height)? */
export function isClear(env, p, P = BODY, list = supportList(env)) {
  const [lo, hi] = bodyBox(p, P);
  return list.every((s) => meetsRaster(s, lo, hi) == null);
}

/**
 * The lowest clear point straight above p (P1's lift): the feet raised to
 * the top of each raster box met until none is. Total: every raster is
 * bounded above.
 */
function lift(env, p, P, list) {
  let y = p[1];
  for (let n = 0; n < 1e4; n++) {
    let top = null;
    const [lo, hi] = bodyBox([p[0], y, p[2]], P);
    for (const s of list) {
      const t = meetsRaster(s, lo, hi);
      if (t != null && (top == null || t > top)) top = t;
    }
    if (top == null) return [p[0], y, p[2]];
    y = Math.max(y + TOL, top + 2 * TOL);
  }
  return [p[0], y, p[2]];
}

// ─── where a state is ───────────────────────────────────────────────────────

/** A side's edge point at cross coordinate w, and d further along its axis: plan, the support's frame. */
function vaultPlan(mesh, st) {
  const [dx, dz] = DIRS[st.side];
  const u = dx ? (dx > 0 ? 1 : 0) : st.w;
  const v = dz ? (dz > 0 ? 1 : 0) : st.w;
  const [x, z] = planOf(mesh, st.cell, u, v);
  return [x + dx * st.d, z + dz * st.d];
}

/** The feet of a state on a support, in its frame; null otherwise. */
export function localFeet(st) {
  const mesh = st?.mesh;
  if (!mesh) return null;
  switch (st.mode) {
    case "walking":
      return pointOf(mesh, st.cell, st.u, st.v);
    case "airborne": {
      const p = pointOf(mesh, st.cell, st.u, st.v);
      return [p[0], p[1] + st.h, p[2]];
    }
    case "vaulting": {
      const [x, z] = vaultPlan(mesh, st);
      return [x, sideBase(mesh, st.cell, st.side) + st.h, z];
    }
    default:
      return null;
  }
}

/**
 * The world pose of a state: feet, eye and the heading of the frame its yaw
 * is in. On a support: feet = M · local, eye = M · (local + eye up its Y).
 * Swimming: `depth` under the surface. Falling: at its point. Both upright.
 * @returns {{ on: string | null, feet: number[], eye: number[], heading: number } | null}
 */
export function worldPose(st, env, P = BODY, S = SWIM) {
  if (!st) return null;
  if (st.mode === "swimming") {
    const y = (waterAt(env, st.p[0], st.p[1]) ?? 0) - S.depth;
    const feet = [st.p[0], y, st.p[1]];
    return { on: null, feet, eye: [feet[0], feet[1] + P.eye, feet[2]], heading: 0 };
  }
  if (st.mode === "falling") return { on: null, feet: [...st.p], eye: [st.p[0], st.p[1] + P.eye, st.p[2]], heading: 0 };
  const local = localFeet(st);
  const M = ON.has(st.mode) ? frameOf(env, st.on) : null;
  if (!local || !M) return null;
  return { on: st.on, feet: apply(M, local), eye: apply(M, [local[0], local[1] + P.eye, local[2]]), heading: headingOf(M) };
}

// ─── making states ──────────────────────────────────────────────────────────

const lastOf = (env, on, local) => {
  const M = frameOf(env, on);
  return M && local ? { feet: apply(M, local), heading: headingOf(M) } : null;
};

/** Walking at a mesh position. */
export function walkingAt(env, on, mesh, at, vel = [0, 0]) {
  const st = { mode: "walking", on, mesh, cell: at.cell, u: clamp01(at.u), v: clamp01(at.v), vel: [vel[0], vel[1]] };
  st.last = lastOf(env, on, localFeet(st));
  return st;
}

/** In the water at a plan point of the ground, pushed clear (SW1's push); null where no push lands. */
export function swimmingAt(env, p, vel = [0, 0], P = BODY, S = SWIM) {
  const q = pushOut(env, [p[0], p[1]], P, S);
  return q ? { mode: "swimming", p: q, vel: [vel[0], vel[1]] } : null;
}

/** Falling at a world point (the feet). The caller makes sure it is clear. */
const fallingAt = (p, vel = [0, 0, 0], rest = 0) => ({ mode: "falling", p: [p[0], p[1], p[2]], vel: [vel[0], vel[1], vel[2]], rest });

/** Waiting for on's mesh: no position yet; `at`, where on it to stand (null: its spawn); `last`, where in the world it was asked for. */
export const waitingOn = (on, at = null, last = null) => ({ mode: "waiting", on, at: at ? [...at] : null, last });

/**
 * P1 over every support: put someone at the world point p. Total.
 * - Of the supports whose D_r holds p, each's projection (the kept cell
 *   nearest p in plan at most a step above it and at most DROP below, a drop
 *   deeper than a step costing metre for metre): the best of them, ties to
 *   the lowest id, the ground last. Walking.
 * - Else, where water answers and the push lands: swimming.
 * - Else (unless `air` is false: then null) falling at the lowest clear point
 *   at or straight above p.
 */
export function placeAt(env, p, P = BODY, S = SWIM, { air = true } = {}) {
  const list = supportList(env);
  let best = null;
  for (const s of list) {
    if (isEmpty(s.mesh)) continue;
    const L = apply(s.inv, p);
    if (!inShadow(s.mesh, L[0], L[2])) continue;
    const at = projectPoint(s.mesh, L, P.step, { fallback: false });
    if (!at) continue;
    const q = pointOf(s.mesh, at.cell, at.u, at.v);
    const d = Math.hypot(q[0] - L[0], q[2] - L[2]) + Math.max(0, L[1] - q[1] - P.step);
    if (!best || d < best.d - TOL) best = { s, at, d }; // within TOL a tie: heights are float32
  }
  if (best) return walkingAt(env, best.s.id, best.s.mesh, best.at);
  if (waterAt(env, p[0], p[2]) != null) {
    const sw = swimmingAt(env, [p[0], p[2]], [0, 0], P, S);
    if (sw) return sw;
  }
  if (!air) return null;
  return fallingAt(lift(env, p, P, list));
}

/**
 * Projection onto one support (R1, WT1, entering at it): `p` local to `on`.
 * In its D_r, its nearest kept cell (sailing's projection, with its 3D
 * fallback); outside it, or on an empty mesh, P1 over every support of the
 * world point. A support with no mesh yet gives `waiting`.
 * @returns {object} a state
 */
export function place(env, on, p, P = BODY, S = SWIM) {
  const M = frameOf(env, on);
  if (!M) return placeAt(env, p, P, S);
  const mesh = env.mesh(on);
  if (!mesh) return waitingOn(on, p, lastOf(env, on, p));
  if (isEmpty(mesh) || !inShadow(mesh, p[0], p[2])) return placeAt(env, apply(M, p), P, S);
  return walkingAt(env, on, mesh, projectPoint(mesh, p, P.step));
}

/** A support's spawn link (or its first link), projected: where someone entering at it stands. */
export function spawnOn(env, on, offset = [0, 0, 0], P = BODY, S = SWIM) {
  const mesh = env.mesh(on);
  if (!mesh) return waitingOn(on, null, lastOf(env, on, [offset[0], offset[1], offset[2]]));
  const link = mesh.links.find((l) => l.kind === "spawn") ?? mesh.links[0];
  if (!link || isEmpty(mesh)) return place(env, on, [offset[0], 0, offset[2]], P, S);
  const at = pointOf(mesh, link.at.cell, link.at.u, link.at.v);
  return place(env, on, [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]], P, S);
}

/**
 * F4: start again. The first support (by id, the ground last) with a spawn
 * link; else the ground's kept cell nearest the middle of its top; else
 * falling, clear, over the stage's origin.
 */
export function respawn(env, P = BODY, S = SWIM) {
  const list = supportList(env);
  for (const s of list) if (!isEmpty(s.mesh) && s.mesh.links.some((l) => l.kind === "spawn")) return spawnOn(env, s.id, [0, 0, 0], P, S);
  const g = list.find((s) => s.id == null && !isEmpty(s.mesh));
  if (g) {
    const m = g.mesh;
    let top = -Infinity;
    for (let a = 0; a < m.count; a++) top = Math.max(top, m.cells.hi[a]);
    const mid = [m.origin[0] + (m.nx * m.cell) / 2, top, m.origin[1] + (m.nz * m.cell) / 2];
    return walkingAt(env, null, m, projectPoint(m, mid, P.step));
  }
  return fallingAt(lift(env, [0, 0, 0], P, list));
}

/** L1: onto a support's ladder (`id`, else its first) from the water: walking at its top, facing the way its link says. null with no mesh or no such ladder. */
export function climb(env, on, id = null) {
  const mesh = env.mesh(on);
  if (!mesh || isEmpty(mesh)) return null;
  const link = mesh.links.find((l) => l.kind === "ladder" && (id == null || l.id === id));
  if (!link) return null;
  return { state: walkingAt(env, on, mesh, link.at), yaw: link.yaw };
}

// ─── the swimmer: in the water, clear of everything ─────────────────────────

/** The moving supports (every one but the ground) a swimmer must be outside the D_r of. */
const moving = (list) => list.filter((s) => s.id != null);

/**
 * What is wrong with swimming at plan point q (invariant I, swimming): (a)
 * water answers there; (b) outside every moving support's D_r, at the
 * surface; (c) the body, feet at the surface less `depth`, clear of the
 * ground's raster. null when nothing is.
 */
function swimProblem(env, list, q, P, S) {
  const y = waterAt(env, q[0], q[1]);
  if (y == null) return "no water there";
  for (const s of moving(list)) {
    const L = apply(s.inv, [q[0], y, q[1]]);
    if (inShadow(s.mesh, L[0], L[2])) return `in ${s.id}'s D_r at ${L[0].toFixed(3)}, ${L[2].toFixed(3)}`;
  }
  const g = list.find((s) => s.id == null);
  if (g) {
    const [lo, hi] = bodyBox([q[0], y - S.depth, q[1]], P);
    if (meetsRaster(g, lo, hi) != null) return `in the ground at ${q.map((v) => v.toFixed(3))}`;
  }
  return null;
}

/** Waves and heave: how far the surface may stand from a support's origin height, for the ring search's bound (m). */
const WATER_SPAN = 10;

/**
 * How far from p a ring must reach to lie wholly outside one support's grid
 * (so outside its D_r), in the world plan. Its grid reaches E from its
 * origin in its plan; at a horizontal distance D from its origin, a point
 * at the surface is at least √((D − D·sinθ − Y)(D + D·sinθ + Y)) from it in
 * its plan (θ its tilt, Y the surface's height off its origin), which is > E
 * once D(1 − sinθ) − Y > E. Infinite for a support on its side.
 */
function clearReach(s, p, env) {
  const { M, mesh } = s;
  const k = scaleOf(M);
  const c = mesh.params?.cell ?? 0.05;
  const [x0, z0] = mesh.origin ?? [0, 0];
  const x1 = x0 + (mesh.nx ?? 0) * c;
  const z1 = z0 + (mesh.nz ?? 0) * c;
  const E = k * Math.max(Math.hypot(x0, z0), Math.hypot(x1, z0), Math.hypot(x0, z1), Math.hypot(x1, z1));
  const sin = Math.hypot(M[4], M[6]) / k;
  const Y = Math.abs((waterAt(env, p[0], p[1]) ?? M[13]) - M[13]) + WATER_SPAN;
  if (sin >= 0.999) return Infinity;
  return Math.hypot(M[12] - p[0], M[14] - p[1]) + (E + Y) / (1 - sin) + c;
}

/** The first moving support whose D_r holds the plan point q (at the surface there), or null. */
function shadowAt(list, env, q) {
  const y = waterAt(env, q[0], q[1]) ?? 0;
  for (const s of list) {
    const L = apply(s.inv, [q[0], y, q[1]]);
    if (inShadow(s.mesh, L[0], L[2])) return s;
  }
  return null;
}

/**
 * SW1's push: the plan point nearest p outside every moving support's D_r
 * (to within a cell), if swimming is valid there; else null.
 * 1. A few passes, each moving the point to the putOut of the moving support
 *    it's in (B5: outside its own D_r).
 * 2. Else (supports rafted so close their D_r overlap, and each one's putOut
 *    lies in the other's): rings about p, a cell apart, sampled a cell apart
 *    round, out to where no moving support's grid reaches (clearReach); the
 *    first sample outside every D_r.
 * The point found is then asked the whole of I for swimming (swimProblem:
 * water there, and the body clear of the ground's raster), so a swimmer is
 * never put where I fails; and the search never goes further than the
 * moving supports make it, so where the ground or the lack of water rules
 * the point out there is no swimming near (null: W3 goes on to falling).
 */
export function pushOut(env, p, P = BODY, S = SWIM) {
  const all = supportList(env);
  const list = moving(all);
  const valid = (q) => (q && swimProblem(env, all, q, P, S) == null ? q : null);
  let q = [p[0], p[1]];
  for (let pass = 0; pass < 4; pass++) {
    const s = shadowAt(list, env, q);
    if (!s) return valid(q);
    const y = waterAt(env, q[0], q[1]) ?? 0;
    const L = apply(s.inv, [q[0], y, q[1]]);
    const [x, z] = putOutAt(s.mesh, L[0], L[2]);
    const w = apply(s.M, [x, L[1], z]);
    q = [w[0], w[2]];
  }
  if (!shadowAt(list, env, q)) return valid(q);
  const c = Math.min(...list.map((s) => (s.mesh.params?.cell ?? 0.05) * scaleOf(s.M)));
  const far = Math.max(...list.map((s) => clearReach(s, p, env)));
  const reach = Number.isFinite(far) ? far : 200;
  for (let rho = c; rho <= reach + c; rho += c) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * rho) / c));
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n;
      const w = [p[0] + rho * Math.cos(a), p[1] + rho * Math.sin(a)];
      if (!shadowAt(list, env, w)) return valid(w);
    }
  }
  return null;
}

// ─── a kept cell under a point ──────────────────────────────────────────────

/**
 * The kept cell W3 (1) steps onto and F2 lands on: of every support but
 * `except`, the cells in the column under world point X whose surface, in
 * that support's frame, lies in [X − down, max(X, from) + up]; the highest
 * in the world, within TOL a tie (heights are float32), ties to the lowest
 * id, the ground last (supportList's order). `L` is X in that support's
 * frame. null if none.
 */
function cellUnder(list, X, down, up, except, from = X) {
  let best = null;
  for (const s of list) {
    if (s.id === except || isEmpty(s.mesh)) continue;
    const m = s.mesh;
    const L = apply(s.inv, X);
    const col = columnAt(m, L[0], L[2]);
    if (col < 0) continue;
    const top = Math.max(L[1], apply(s.inv, from)[1]) + up;
    const i = col % m.nx;
    const k = (col - i) / m.nx;
    const u = clamp01((L[0] - m.origin[0]) / m.cell - i);
    const v = clamp01((L[2] - m.origin[1]) / m.cell - k);
    for (let a = m.column[col]; a < m.column[col + 1]; a++) {
      const sy = surfaceAt(m, a, u, v);
      if (sy < L[1] - down - TOL || sy > top + TOL) continue;
      const wy = apply(s.M, [L[0], sy, L[2]])[1];
      if (!best || wy > best.wy + TOL) best = { s, a, u, v, wy, sy, L }; // within TOL a tie: heights are float32
    }
  }
  return best;
}

// ─── W3: off an OPEN side ───────────────────────────────────────────────────

/**
 * W3: across an OPEN side of `on` (frame M), at `exit` (on's plan) with the
 * feet at height y (on's frame), moving at vel (on's plan) and vy.
 * Its world point is X = M · (exit, y). Then, in order:
 * (1) onto another support with a kept cell in X's column within
 *     [y − drop, y + step], the highest, ties to the lowest id, the ground
 *     last: airborne with h = min(y − surface, headroom), or walking at 0;
 * (2) else, where water answers and the push lands: swimming;
 * (3) else, where the body is clear: falling at X;
 * (4) else null: the caller cuts the move at the side, as a WALL.
 * @returns {{ state, yaw } | null}
 */
function offSide(env, on, M, mesh, cell, side, y, vel, vy, yaw, P, S) {
  const list = supportList(env);
  const e = (cell * 4 + side) * 2;
  const exit = [mesh.side.exit[e], mesh.side.exit[e + 1]];
  const X = apply(M, [exit[0], y, exit[1]]);
  const v3 = rotateM(M, [vel[0], 0, vel[1]]);
  // (1)
  const best = cellUnder(list, X, P.drop, P.step, on);
  if (best) {
    const { s, a, u, v, sy, L } = best;
    const h = Math.min(L[1] - sy, s.mesh.cells.headroom[a]);
    const lv = unrotateM(s.M, v3);
    const next = h > TOL ? { mode: "airborne", on: s.id, mesh: s.mesh, cell: a, u, v, h, vy: vy ?? 0, vel: [lv[0], lv[2]] } : walkingAt(env, s.id, s.mesh, { cell: a, u, v }, [lv[0], lv[2]]);
    if (next.mode === "airborne") next.last = lastOf(env, s.id, localFeet(next));
    return { state: next, yaw: yaw + headingOf(M) - headingOf(s.M) };
  }
  // (2)
  if (waterAt(env, X[0], X[2]) != null) {
    const sw = swimmingAt(env, [X[0], X[2]], [v3[0] * 0.3, v3[2] * 0.3], P, S);
    if (sw) return { state: sw, yaw: yaw + headingOf(M) };
  }
  // (3)
  if (isClear(env, X, P, list)) return { state: fallingAt(X, [v3[0], vy ?? 0, v3[2]]), yaw: yaw + headingOf(M) };
  return null;
}

// ─── one move over the mesh ─────────────────────────────────────────────────

/**
 * Does a body (plan point q, feet y0 to head y1, radius r) meet a blocker,
 * an oriented box { o, A, h } (centre, three unit axes, half extents) in the
 * same frame? The body as its square box (the cylinder's, grown at the
 * corners), so the box is met grown by r, conservatively; separating axes.
 */
export function meetsBlock(q, y0, y1, r, box) {
  return boxesMeet([q[0], (y0 + y1) / 2, q[1]], [r, (y1 - y0) / 2, r], box.o, box.A, box.h);
}

function blocked(env, on, mesh, cell, u, v, h, P) {
  const boxes = env.blockers?.(on);
  if (!boxes?.length) return false;
  const [x, z] = planOf(mesh, cell, u, v);
  const y = surfaceAt(mesh, cell, u, v) + h;
  return boxes.some((b) => meetsBlock([x, z], y, y + P.height, P.radius, b));
}

/**
 * The plan displacement (dx, dz) walked side by side over the cells (a DDA).
 * Within a cell: move. At a side, by its record: STEP crosses (in the air,
 * only if the height fits the cell beyond); WALL blocks that axis (in the
 * air, high enough and to somewhere: a vault); OPEN stops at the side and
 * says so (`exit`: W3 asks what is beyond). Exactly through a corner, X goes first.
 * `lift`: how far the feet jumped up (or, negative, down) at the STEPs crossed
 * on the ground, and on landing up one in the air: what the camera eases (presentation only).
 * @returns {{ cell, u, v, h, air, vel, lift, vault?: { side, h, w }, exit?: number }}
 */
export function travel(mesh, pos, dx, dz, vel, air, P = BODY) {
  const c = mesh.cell;
  const len = Math.hypot(dx, dz);
  const cap = P.maxMove ?? WALKER.maxMove;
  if (len > cap) {
    dx *= cap / len;
    dz *= cap / len;
  }
  let du = dx / c;
  let dv = dz / c;
  let { cell, u, v } = pos;
  let h = pos.h ?? 0;
  let vx = vel[0];
  let vz = vel[1];
  let lift = 0;
  const S = mesh.side;
  const out = () => ({ cell, u, v, h: air ? h : 0, air, vel: [vx, vz], lift });
  for (let n = 0; n < 1e5; n++) {
    if (du === 0 && dv === 0) break;
    const tx = du > 0 ? (1 - u) / du : du < 0 ? u / -du : Infinity;
    const tz = dv > 0 ? (1 - v) / dv : dv < 0 ? v / -dv : Infinity;
    if (tx >= 1 && tz >= 1) {
      u = clamp01(u + du);
      v = clamp01(v + dv);
      break;
    }
    const xFirst = tx <= tz;
    const t = Math.max(0, xFirst ? tx : tz);
    u = clamp01(u + du * t);
    v = clamp01(v + dv * t);
    du *= 1 - t;
    dv *= 1 - t;
    const s = xFirst ? (du > 0 ? 1 : 0) : dv > 0 ? 3 : 2;
    if (xFirst) u = s === 1 ? 1 : 0;
    else v = s === 3 ? 1 : 0;
    const e = cell * 4 + s;
    const kind = S.kind[e];
    const to = S.to[e];
    const before = surfaceAt(mesh, cell, u, v) + h; // the feet at the side, for `lift`
    let cross = false;
    if (kind === STEP) {
      if (!air) cross = true;
      else {
        const h2 = h - S.rise[e];
        if (h2 < 0) {
          air = false;
          h = 0;
          cross = true;
        } else if (h2 <= mesh.cells.headroom[to]) {
          h = h2;
          cross = true;
        }
      }
    } else if (kind === WALL) {
      if (air && to !== NONE) {
        const hv = surfaceAt(mesh, cell, u, v) + h - sideBase(mesh, cell, s);
        if (hv >= S.rise[e]) return { ...out(), vault: { side: s, h: Math.min(hv, S.top[e]), w: xFirst ? v : u } };
      }
    } else if (kind === OPEN) {
      return { ...out(), exit: s };
    }
    if (cross) {
      cell = to;
      if (xFirst) u = s === 1 ? 0 : 1;
      else v = s === 3 ? 0 : 1;
      if (!air) lift += surfaceAt(mesh, cell, u, v) + h - before;
      continue;
    }
    // blocked: the velocity slides along the wall's smoothed normal (feel), then that axis stops
    const nx = S.normal[e * 2];
    const nz = S.normal[e * 2 + 1];
    const into = vx * nx + vz * nz;
    if (into < 0) {
      vx -= into * nx;
      vz -= into * nz;
    }
    if (xFirst) {
      du = 0;
      vx = 0;
    } else {
      dv = 0;
      vz = 0;
    }
  }
  return out();
}

/** W3 (4): the move cut at an OPEN side, as at a WALL: where travel stopped, that axis's speed gone. */
const cutAt = (r) => {
  const vel = [...r.vel];
  vel[DIRS[r.exit][0] ? 0 : 1] = 0;
  return vel;
};

// ─── one step ───────────────────────────────────────────────────────────────

/**
 * One step of the walker.
 * @param {object} st  a state
 * @param {{ forward, strafe, run?, jump? }} input
 * @param {number} yaw  to the heading of the frame the state is in (its support's; the ground's in the water or the air)
 * @param {number} dt
 * @param {object} env
 * @returns {{ state: object, yaw: number, lift?: number }}  yaw changes only when the frame does; lift: how far the
 *   feet jumped at a STEP this step (the support's up), for the camera to ease
 */
export function step(st, input, yaw, dt, env, P = BODY, S = SWIM) {
  const W = { ...WALKER, ...P };
  if (!st) return { state: st, yaw };
  if (st.mode === "waiting") {
    const M = frameOf(env, st.on);
    const mesh = M ? env.mesh(st.on) : null;
    if (mesh) {
      // WT1: on's mesh landed
      const next = st.at ? place(env, st.on, st.at, P, S) : spawnOn(env, st.on, [0, 0, 0], P, S);
      return { state: next, yaw: yawInto(env, yaw, M, next) };
    }
    if (!M) {
      // WT2: on is gone: P1 of where it was asked for
      const next = placeAt(env, st.last?.feet ?? [0, 0, 0], P, S);
      return { state: next, yaw: yawInto(env, yaw + (st.last?.heading ?? 0), I4, next) };
    }
    return { state: { ...st, last: lastOf(env, st.on, st.at ?? [0, 0, 0]) ?? st.last }, yaw };
  }
  if (st.mode === "swimming") return swim(st, input, yaw, dt, env, P, S);
  if (st.mode === "falling") return fall(st, input, yaw, dt, env, W, S);
  if (!ON.has(st.mode)) return { state: st, yaw };

  const M = frameOf(env, st.on);
  if (!M) {
    // G1: the support is gone: P1 of where you last were
    const next = placeAt(env, st.last?.feet ?? [0, 0, 0], P, S);
    return { state: next, yaw: yawInto(env, yaw + (st.last?.heading ?? 0), I4, next) };
  }
  const mesh = env.mesh(st.on);
  if (!mesh) return { state: { ...st, last: lastOf(env, st.on, localFeet(st)) }, yaw };
  if (mesh !== st.mesh) {
    // R1: rebaked under you: projected onto the new mesh
    const next = place(env, st.on, localFeet(st), P, S);
    return { state: next, yaw: yawInto(env, yaw, M, next) };
  }

  // W5: awash (the support is going down): into the water, out of its D_r
  {
    const local = localFeet(st);
    const w = apply(M, local);
    const wy = waterAt(env, w[0], w[2]);
    if (wy != null && w[1] < wy - W.sunk) {
      const [x, z] = putOutAt(mesh, local[0], local[2]);
      const at = apply(M, [x, local[1], z]);
      const sw = swimmingAt(env, [at[0], at[2]], [0, 0], P, S);
      if (sw) return { state: sw, yaw: yaw + headingOf(M) };
    }
  }

  let s = st;
  if (s.mode === "vaulting") return vault(s, yaw, dt, env, M, mesh, W, S);

  const want = wishVelocity(input, yaw, P);
  if (s.mode === "walking") {
    const vel = approach(s.vel, want, P.accelGround * dt);
    if (input.jump && P.jump > 0) {
      s = { mode: "airborne", on: s.on, mesh, cell: s.cell, u: s.u, v: s.v, h: 0, vy: P.jump, vel }; // W4
    } else {
      const r = travel(mesh, s, vel[0] * dt, vel[1] * dt, vel, false, W);
      if (r.exit != null) {
        const off = offSide(env, s.on, M, mesh, r.cell, r.exit, localFeet(s)[1], r.vel, 0, yaw, W, S); // W3
        if (off) return off;
        r.vel = cutAt(r);
      }
      let next = { mode: "walking", on: s.on, mesh, cell: r.cell, u: r.u, v: r.v, vel: r.vel };
      let lift = r.lift;
      if (blocked(env, s.on, mesh, r.cell, r.u, r.v, 0, P) && !blocked(env, s.on, mesh, s.cell, s.u, s.v, 0, P)) (next = { ...s, vel: [0, 0] }), (lift = 0);
      next.last = lastOf(env, s.on, localFeet(next));
      return { state: next, yaw, lift };
    }
  } else {
    s = { ...s, vel: approach(s.vel, want, P.accelAir * dt) };
  }

  // airborne: across first, at the height you're at; then up and down
  const r = travel(mesh, s, s.vel[0] * dt, s.vel[1] * dt, s.vel, true, W);
  if (r.exit != null) {
    const off = offSide(env, s.on, M, mesh, r.cell, r.exit, localFeet(s)[1], r.vel, s.vy, yaw, W, S); // W3
    if (off) return off;
    r.vel = cutAt(r);
  }
  if (r.vault) {
    // A4: into a WALL high enough, to somewhere: across its band
    const v = { mode: "vaulting", on: s.on, mesh, cell: r.cell, side: r.vault.side, d: 0, h: r.vault.h, vy: s.vy, vel: r.vel, w: r.vault.w };
    v.last = lastOf(env, s.on, localFeet(v));
    return { state: v, yaw };
  }
  let next;
  let lift = r.lift;
  if (!r.air) next = { mode: "walking", on: s.on, mesh, cell: r.cell, u: r.u, v: r.v, vel: r.vel };
  else next = { mode: "airborne", on: s.on, mesh, cell: r.cell, u: r.u, v: r.v, h: r.h, vy: s.vy, vel: r.vel };
  if (blocked(env, s.on, mesh, next.cell, next.u, next.v, next.h ?? 0, P) && !blocked(env, s.on, mesh, s.cell, s.u, s.v, s.h, P)) {
    next = { ...s, vel: [0, 0] };
    lift = 0;
  }
  if (next.mode === "airborne") next = rise(next, dt, env, mesh, P);
  next.last = lastOf(env, next.on, localFeet(next));
  return { state: next, yaw, lift };
}

/** A1/A2: up and down under gravity (the support's −Y), under its headroom and any blocker; landing walks. */
function rise(s, dt, env, mesh, P) {
  const vy0 = s.vy;
  let vy = vy0 - P.gravity * dt;
  let h = s.h + ((vy0 + vy) / 2) * dt;
  const room = mesh.cells.headroom[s.cell];
  if (h >= room) {
    h = room;
    if (vy > 0) vy = 0; // a head bump
  }
  if (h > s.h && blocked(env, s.on, mesh, s.cell, s.u, s.v, h, P) && !blocked(env, s.on, mesh, s.cell, s.u, s.v, s.h, P)) {
    let lo = s.h;
    let hi = h;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (blocked(env, s.on, mesh, s.cell, s.u, s.v, mid, P)) hi = mid;
      else lo = mid;
    }
    h = lo;
    vy = Math.min(vy, 0);
  }
  if (h <= 0 && vy <= 0) return { mode: "walking", on: s.on, mesh, cell: s.cell, u: s.u, v: s.v, vel: s.vel };
  return { ...s, h: Math.max(0, h), vy };
}

/** V1/V2: across a WALL's band; down on the far side (a cell, or off the support: W3). */
function vault(s, yaw, dt, env, M, mesh, P, S) {
  const e = s.cell * 4 + s.side;
  const SD = mesh.side;
  const [ax, az] = DIRS[s.side];
  const along = s.vel[0] * ax + s.vel[1] * az;
  const d = Math.min(SD.gap[e], s.d + Math.max(along, P.vault) * dt);
  const vy0 = s.vy;
  let vy = vy0 - P.gravity * dt;
  let h = s.h + ((vy0 + vy) / 2) * dt;
  if (h < SD.rise[e]) {
    h = SD.rise[e];
    vy = Math.max(vy, 0);
  }
  if (h > SD.top[e]) {
    h = SD.top[e];
    vy = Math.min(vy, 0);
  }
  if (d < SD.gap[e]) {
    const next = { ...s, d, h, vy };
    next.last = lastOf(env, s.on, localFeet(next));
    return { state: next, yaw };
  }
  // V2: d reached the gap
  const base = sideBase(mesh, s.cell, s.side);
  const to = SD.to[e];
  const u = ax ? (ax > 0 ? 0 : 1) : s.w;
  const v = az ? (az > 0 ? 0 : 1) : s.w;
  if (to === OFF) {
    const off = offSide(env, s.on, M, mesh, s.cell, s.side, base + h, s.vel, vy, yaw, P, S);
    if (off) return off;
    // W3 (4): back over the cell it left, in the air, that axis's speed gone
    const bu = ax ? (ax > 0 ? 1 : 0) : s.w;
    const bv = az ? (az > 0 ? 1 : 0) : s.w;
    const hb = Math.max(0, Math.min(base + h - surfaceAt(mesh, s.cell, bu, bv), mesh.cells.headroom[s.cell]));
    const vel = [ax ? 0 : s.vel[0], az ? 0 : s.vel[1]];
    const next = { mode: "airborne", on: s.on, mesh, cell: s.cell, u: bu, v: bv, h: hb, vy: Math.min(vy, 0), vel };
    next.last = lastOf(env, s.on, localFeet(next));
    return { state: next, yaw };
  }
  const h2 = Math.max(0, Math.min(base + h - surfaceAt(mesh, to, u, v), mesh.cells.headroom[to]));
  let next;
  if (h2 <= TOL && vy <= 0) next = { mode: "walking", on: s.on, mesh, cell: to, u, v, vel: s.vel };
  else next = { mode: "airborne", on: s.on, mesh, cell: to, u, v, h: h2, vy, vel: s.vel };
  next.last = lastOf(env, s.on, localFeet(next));
  return { state: next, yaw };
}

/** SW1: a stroke in the ground's plan at the surface, then pushed clear. Where no push lands, that move is not taken. */
function swim(st, input, yaw, dt, env, P, S) {
  const want = wishVelocity({ ...input, jump: false }, yaw, S);
  let vel = approach(st.vel, want, S.accelGround * dt);
  let dx = vel[0] * dt;
  let dz = vel[1] * dt;
  const l = Math.hypot(dx, dz);
  if (l > WALKER.maxMove) {
    dx *= WALKER.maxMove / l;
    dz *= WALKER.maxMove / l;
  }
  const q = pushOut(env, [st.p[0] + dx, st.p[1] + dz], P, S) ?? pushOut(env, st.p, P, S);
  if (q) return { state: { mode: "swimming", p: q, vel }, yaw };
  // nowhere in the water near: P1 of the feet
  vel = [0, 0];
  const feet = [st.p[0], (waterAt(env, st.p[0], st.p[1]) ?? 0) - S.depth, st.p[1]];
  const next = placeAt(env, feet, P, S);
  return { state: next, yaw: yawInto(env, yaw, I4, next) };
}

// ─── falling ────────────────────────────────────────────────────────────────

/**
 * The plan move along one axis (0: x, 2: z) from p, in pieces no longer than
 * r, each taken only if the body is clear at its end. Pieces under 2r apart
 * have boxes whose union is the box swept between them, so the sweep is
 * clear, whatever dt: no wall is passed through. @returns {{ p, all }} where
 * it got to, and whether that is the whole move.
 */
function slide(env, p, axis, d, P, list) {
  const n = Math.ceil(Math.abs(d) / P.radius);
  for (let k = 0; k < n; k++) {
    const q = [p[0], p[1], p[2]];
    q[axis] += d / n;
    if (!isClear(env, q, P, list)) return { p, all: false };
    p = q;
  }
  return { p, all: true };
}

/**
 * F1–F5: in the air, in the ground's frame. A support that moved into the
 * body lifts it out first (P1's lift). Steered in plan as airborne is; the
 * plan move taken axis by axis (slide), an axis that is stopped zeroed. Then
 * the vertical move, cut where the body would stop being clear (resting on a
 * surface from above, or a head under one). Then F2: landing on the highest
 * kept cell under the feet that they passed, or, resting, one within a step
 * under them (on a slope the body rests on the side of its box, over the
 * cell under its centre: that cell is landed on, never rested on); F3 into
 * the water; F4 below fallLimit; F5 held by a surface that is no cell for
 * `rest`.
 */
function fall(st, input, yaw, dt, env, P, S) {
  const list = supportList(env);
  let p = [...st.p];
  if (!isClear(env, p, P, list)) p = lift(env, p, P, list); // a support moved into the body: up out of it (P1's lift)
  const want = wishVelocity(input, yaw, P);
  let [vx, vz] = approach([st.vel[0], st.vel[2]], want, P.accelAir * dt);
  let dx = vx * dt;
  let dz = vz * dt;
  const l = Math.hypot(dx, dz);
  if (l > P.maxMove) {
    dx *= P.maxMove / l;
    dz *= P.maxMove / l;
  }
  let r = slide(env, p, 0, dx, P, list);
  if (!r.all) vx = 0;
  r = slide(env, r.p, 2, dz, P, list);
  if (!r.all) vz = 0;
  p = r.p;
  // F1: the vertical move (under maxMove < height, so the boxes at its ends cover its sweep)
  let vy = st.vel[1] - P.gravity * dt;
  let dy = ((st.vel[1] + vy) / 2) * dt;
  if (Math.abs(dy) > P.maxMove) dy = Math.sign(dy) * P.maxMove;
  let end = [p[0], p[1] + dy, p[2]];
  let resting = false;
  if (!isClear(env, end, P, list)) {
    let lo = p[1];
    let hi = end[1];
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (isClear(env, [p[0], mid, p[2]], P, list)) lo = mid;
      else hi = mid;
    }
    end = [p[0], lo, p[2]];
    vy = 0;
    resting = dy < 0;
  }
  // F2
  const land = cellUnder(list, end, resting ? P.step : 0, 0, undefined, p);
  if (land) {
    const { s, a, u, v } = land;
    const lv = unrotateM(s.M, [vx, 0, vz]);
    const next = walkingAt(env, s.id, s.mesh, { cell: a, u, v }, [lv[0], lv[2]]);
    return { state: next, yaw: yaw - headingOf(s.M) };
  }
  // F3
  const wy = waterAt(env, end[0], end[2]);
  if (wy != null && end[1] < wy - S.depth) {
    const sw = swimmingAt(env, [end[0], end[2]], [vx * 0.3, vz * 0.3], P, S);
    if (sw) return { state: sw, yaw };
  }
  // F4
  if (end[1] < P.fallLimit) {
    const next = respawn(env, P, S);
    return { state: next, yaw: yawInto(env, yaw, I4, next) };
  }
  // F5
  const rest = resting ? st.rest + dt : 0;
  if (rest >= P.rest) {
    const next = placeAt(env, end, P, S, { air: false }) ?? respawn(env, P, S);
    return { state: next, yaw: yawInto(env, yaw, I4, next) };
  }
  return { state: fallingAt(end, [vx, vy, vz], rest), yaw };
}

/**
 * The body's sweep from falling at `from` (already lifted out of anything
 * that moved into it) to falling at `to`, as fall takes it: x, then z, then
 * y. Boxes under 2r apart cover the sweep between them, so this asks
 * exactly whether the whole sweep is clear. null if it is, else where it isn't.
 */
function sweepProblem(env, from, to, P, list) {
  const p = [...from];
  for (const axis of [0, 2, 1]) {
    const d = to[axis] - p[axis];
    const n = Math.ceil(Math.abs(d) / P.radius);
    for (let k = 1; k <= n; k++) {
      const q = [...p];
      q[axis] += (d * k) / n;
      if (!isClear(env, q, P, list)) return `falling swept through something at ${q.map((v) => v.toFixed(3))}`;
    }
    p[axis] = to[axis];
  }
  return null;
}

// ─── the invariant ──────────────────────────────────────────────────────────

/**
 * Invariant I, per state (DESIGN.md): the problems with a state, [] if none.
 * Given `prev`, the state it was stepped from in this env, falling to falling
 * also asks the whole sweep between them (sweepProblem); a move longer than
 * maxMove on an axis is F4 starting again, not a sweep. The body checks it
 * after every step, and throws while asserting() (tests, probes).
 */
export function checkWalker(st, env, prev = null, P = BODY, S = SWIM) {
  const bad = [];
  if (!st || typeof st !== "object") return ["no state"];
  const inRange = (x) => Number.isFinite(x) && x >= 0 && x <= 1;
  const mesh = st.mesh;
  const cellOk = () => mesh && Number.isInteger(st.cell) && st.cell >= 0 && st.cell < mesh.count;
  switch (st.mode) {
    case "waiting":
      if (st.cell != null || st.p != null) bad.push("waiting has a position");
      break;
    case "walking":
      if (!cellOk()) bad.push(`cell ${st.cell} not in the mesh`);
      if (!inRange(st.u) || !inRange(st.v)) bad.push(`u, v out of range: ${st.u}, ${st.v}`);
      break;
    case "airborne":
      if (!cellOk()) bad.push(`cell ${st.cell} not in the mesh`);
      if (!inRange(st.u) || !inRange(st.v)) bad.push(`u, v out of range: ${st.u}, ${st.v}`);
      else if (!(st.h >= 0 && st.h <= mesh.cells.headroom[st.cell] + TOL)) bad.push(`h ${st.h} out of [0, ${mesh.cells.headroom[st.cell]}]`);
      break;
    case "vaulting": {
      if (!cellOk()) {
        bad.push(`cell ${st.cell} not in the mesh`);
        break;
      }
      const e = st.cell * 4 + st.side;
      if (mesh.side.kind[e] !== WALL || mesh.side.to[e] === NONE) bad.push("vaulting over a side that isn't a WALL to somewhere");
      if (!(st.d >= 0 && st.d <= mesh.side.gap[e] + TOL)) bad.push(`d ${st.d} out of [0, ${mesh.side.gap[e]}]`);
      if (!(st.h >= mesh.side.rise[e] - TOL && st.h <= mesh.side.top[e] + TOL)) bad.push(`h ${st.h} out of [${mesh.side.rise[e]}, ${mesh.side.top[e]}]`);
      if (!inRange(st.w)) bad.push(`w out of range: ${st.w}`);
      break;
    }
    case "swimming": {
      if (!Array.isArray(st.p) || st.p.length !== 2 || !st.p.every(Number.isFinite)) {
        bad.push("no place in the water");
        break;
      }
      const why = swimProblem(env, supportList(env), st.p, P, S);
      if (why) bad.push(why);
      break;
    }
    case "falling": {
      if (!Array.isArray(st.p) || st.p.length !== 3 || !st.p.every(Number.isFinite) || !st.vel?.every?.(Number.isFinite)) {
        bad.push("no place in the air");
        break;
      }
      if (!(st.rest >= 0)) bad.push(`rest ${st.rest}`);
      const list = supportList(env);
      if (!isClear(env, st.p, P, list)) bad.push(`falling, not clear at ${st.p.map((v) => v.toFixed(3))}`);
      else if (prev?.mode === "falling") {
        const from = isClear(env, prev.p, P, list) ? prev.p : lift(env, prev.p, P, list);
        const cap = { ...WALKER, ...P }.maxMove;
        if (from.every((v, i) => Math.abs(st.p[i] - v) <= cap + TOL)) {
          const why = sweepProblem(env, from, st.p, P, list);
          if (why) bad.push(why);
        }
      }
      break;
    }
    default:
      bad.push(`no such mode: ${st.mode}`);
  }
  return bad;
}

/** checkWalker, thrown. */
export function assertWalker(st, env, prev = null, P = BODY, S = SWIM) {
  const bad = checkWalker(st, env, prev, P, S);
  if (bad.length) throw new Error(`walker invariant: ${bad.join("; ")} (${st?.mode})`);
}

export { OPEN, OFF, STEP, WALL, NONE };
