// The walker: a small state machine over a ship's navmesh (DESIGN.md,
// "Walking: a navmesh in the ship's frame"). Pure: no THREE, no rays, no
// scene. Its state can't name a place off the mesh: aboard, a position is
// (ship, cell, u, v) and a height over it, in her body frame; in the water,
// a plan point in the world. The world pose is derived from her matrix each
// frame and never fed back, so nothing that moves the ship moves the walker
// through anything.
//
// States (each also carries `mesh`, the mesh its cell numbers refer to, and
// `last`, where it was in the world: derived, for when she goes):
//   boarding  { ship, at?, offset?, from?, t }      her mesh isn't here yet (from: a world point to swim at if it never comes)
//   walking   { ship, cell, u, v, vel }             vel: plan, her frame
//   airborne  { ship, cell, u, v, h, vy, vel }      h: feet over the surface
//   vaulting  { ship, cell, side, d, h, vy, vel, w } across a WALL's checked band
//   station   { ship, cell, u, v, station }
//   ladder    { ship, link, t }
//   swimming  { p: [x, z] world, vel: [vx, vz] world }
//
// The environment it's stepped in:
//   env.mesh(ship) → NavMesh | null    env.frame(ship) → her body frame in the world (4×4) | null
//   env.ships() → ids                  env.surface(x, z) → the sea's height there (world)
//   env.blockers?(ship) → [{ a, b, r }] capsules in her frame (the boom): moving obstacles that only block

import { DIRS, NONE, OPEN, OVERBOARD, STEP, WALL, columnAt, inShadow, isEmpty, planOf, pointOf, projectPoint, putOutAt, sideBase, surfaceAt } from "./navmesh.js";
import { apply, headingOf, invert, rotateM, unrotateM } from "./frames.js";
import { DECK, SWIM, wishVelocity } from "./walk.js";

const TOL = 1e-6;

/**
 * Is invariant I asserted (a breach throws)? In tests (vitest: import.meta.env.DEV),
 * in the probe pages (they set the flag) and wherever globalThis.__SAILING_ASSERT__
 * is set; a production build (DEV replaced by false) logs once and projects.
 */
export const asserting = () => Boolean(globalThis.__SAILING_ASSERT__ ?? import.meta.env?.DEV ?? false);

/** The walker's own constants on top of DECK. */
export const WALKER = Object.freeze({
  vault: 1.5, // the least speed across a vault's band (m/s)
  maxMove: 1, // the most a move goes in one step (m), whatever dt
  sunk: 1.5, // feet this far under the sea: awash, you swim
  seatedEye: 1.15, // a seated eye over the floor, for standing up from a seat
  boardWait: 15, // waiting this long for her mesh (her model never came), you swim instead (s)
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ABOARD = new Set(["walking", "airborne", "vaulting", "station"]);

/** Move `v` toward `target` by at most `max` (2D). */
function approach(v, target, max) {
  const dx = target[0] - v[0];
  const dz = target[1] - v[1];
  const d = Math.hypot(dx, dz);
  if (d <= max || d === 0) return [target[0], target[1]];
  return [v[0] + (dx / d) * max, v[1] + (dz / d) * max];
}

// ─── where a state is ───────────────────────────────────────────────────────

/** A side's edge point at cross coordinate w, and d further along its axis: plan, her frame. */
function vaultPlan(mesh, st) {
  const [dx, dz] = DIRS[st.side];
  const u = dx ? (dx > 0 ? 1 : 0) : st.w;
  const v = dz ? (dz > 0 ? 1 : 0) : st.w;
  const [x, z] = planOf(mesh, st.cell, u, v);
  return [x + dx * st.d, z + dz * st.d];
}

/** The feet of a state aboard, in her frame; null in the water or boarding. */
export function localFeet(st) {
  const mesh = st?.mesh;
  if (!mesh) return null;
  switch (st.mode) {
    case "walking":
    case "station":
      return pointOf(mesh, st.cell, st.u, st.v);
    case "airborne": {
      const p = pointOf(mesh, st.cell, st.u, st.v);
      return [p[0], p[1] + st.h, p[2]];
    }
    case "vaulting": {
      const [x, z] = vaultPlan(mesh, st);
      return [x, sideBase(mesh, st.cell, st.side) + st.h, z];
    }
    case "ladder":
      return pointOf(mesh, st.link.at.cell, st.link.at.u, st.link.at.v);
    default:
      return null;
  }
}

/**
 * The world pose of a state: feet, eye and which way is up for the body.
 * Aboard: feet = M · local, eye = M · (local + eye up her Y). Swimming: at
 * the surface, `depth` under it, the eye over the feet.
 * @returns {{ on: string | null, feet: number[], eye: number[], heading: number } | null}
 */
export function worldPose(st, env, P = DECK, S = SWIM) {
  if (!st) return null;
  if (st.mode === "swimming") {
    const y = env.surface(st.p[0], st.p[1]) - S.depth;
    const feet = [st.p[0], y, st.p[1]];
    return { on: null, feet, eye: [feet[0], feet[1] + P.eye, feet[2]], heading: 0 };
  }
  const local = localFeet(st);
  const M = st.ship ? env.frame(st.ship) : null;
  if (!local || !M) return null;
  return { on: st.ship, feet: apply(M, local), eye: apply(M, [local[0], local[1] + P.eye, local[2]]), heading: headingOf(M) };
}

// ─── where people stand (the bake's seeds) ──────────────────────────────────

/** How far aft of a station you stand to work it (m). */
export const BEHIND = 0.6;
/** From a ladder's hook inboard to where you come aboard (m). */
export const INBOARD = 0.5;

/** Where you stand to work a station: just aft of it, in the ship's frame. */
export const behind = ([x, y, z], by = BEHIND) => [x, y, z + by];

/** How far aft of a station of this kind you stand: the mainsheet's block is at your feet, with the wheel close aft of it. */
export const standOff = (kind) => (kind === "mainsheet" ? 0.35 : BEHIND);

/** Where you come aboard by a ladder hooked over the side at `at` (local): inboard of it, on deck. */
export const ladderTop = ([x, y, z], by = INBOARD) => [x - Math.sign(x || 1) * by, y, z];

/**
 * The bake's seeds for a ship, from where her stations and her ladder are
 * (her body frame): her spawn (aft of the helm, else aft on her centreline
 * from her box), a stand spot aft of each station, and her ladder's top with
 * the hook it hangs from. Each is dropped onto what's under it by the bake.
 * @param {{ stations?: Array<{ id, at: number[], by?: number }>, helm?: string | null, ladder?: { id, at: number[] } | null, box?: { min, max } | null }} o
 */
export function seedsOf({ stations = [], helm = null, ladder = null, box = null } = {}) {
  const wheel = stations.find((s) => s.id === helm) ?? null;
  const spawnAt = wheel ? behind(wheel.at) : box ? [(box.min[0] + box.max[0]) / 2, box.max[1], box.max[2] - 1.2] : [0, 3, 0];
  const out = [{ kind: "spawn", id: null, at: spawnAt, yaw: 0 }];
  for (const s of stations) out.push({ kind: "station", id: s.id, at: behind(s.at, s.by ?? BEHIND), yaw: 0 });
  if (ladder) out.push({ kind: "ladder", id: ladder.id, at: ladderTop(ladder.at), hook: [...ladder.at], yaw: ladder.at[0] >= 0 ? Math.PI / 2 : -Math.PI / 2 });
  return out;
}

// ─── making states ──────────────────────────────────────────────────────────

const lastOf = (env, ship, local) => {
  const M = env.frame(ship);
  return M && local ? { feet: apply(M, local), heading: headingOf(M) } : null;
};

/** Walking at a mesh position. */
export function walkingAt(env, ship, mesh, at, vel = [0, 0]) {
  const st = { mode: "walking", ship, mesh, cell: at.cell, u: clamp01(at.u), v: clamp01(at.v), vel: [vel[0], vel[1]] };
  st.last = lastOf(env, ship, localFeet(st));
  return st;
}

/** In the water at a world plan point, pushed out of every ship near it. */
export function swimmingAt(env, p, vel = [0, 0]) {
  return { mode: "swimming", p: pushOut(env, [p[0], p[1]]), vel: [vel[0], vel[1]] };
}

/** Waiting for her mesh: no position yet; `last`, where in the world it was asked for (for G1 and the wait running out). */
export const boardingOn = (ship, at = null, last = null) => ({ mode: "boarding", ship, at: at ? [...at] : null, last, t: 0 });

/**
 * Projection (P1): put someone at `p`, local to `ship` (or world plan point
 * when `ship` is null). Total: it returns a valid state for any input.
 * - p over the water (outside her D_r): swimming there;
 * - else the kept cell nearest p in plan no more than `step` above it and
 *   DROP (2 m) below it (a point in the air drops onto what's under it): walking;
 * - else the nearest kept cell (in 3D);
 * - an empty mesh: swimming at her putOut.
 * A ship whose mesh isn't baked yet gives `boarding` (B1 lands it).
 * @returns {object} a state
 */
export function place(env, ship, p, P = DECK) {
  if (ship == null) return swimmingAt(env, [p[0], p[2]]);
  const mesh = env.mesh(ship);
  if (!mesh) return boardingOn(ship, p, lastOf(env, ship, p));
  const M = env.frame(ship);
  if (!M) return swimmingAt(env, [p[0], p[2]]);
  if (isEmpty(mesh)) {
    const [x, z] = putOutAt(mesh, p[0], p[2]);
    const w = apply(M, [x, p[1], z]);
    return swimmingAt(env, [w[0], w[2]]);
  }
  if (!inShadow(mesh, p[0], p[2])) {
    const w = apply(M, p);
    return swimmingAt(env, [w[0], w[2]]);
  }
  return walkingAt(env, ship, mesh, projectPoint(mesh, p, P.step));
}

/** Her spawn link (or the first link), projected: where someone coming aboard stands. */
export function spawnOn(env, ship, offset = [0, 0, 0], P = DECK) {
  const mesh = env.mesh(ship);
  if (!mesh) return boardingOn(ship, null, lastOf(env, ship, [offset[0], offset[1], offset[2]]));
  const link = mesh.links.find((l) => l.kind === "spawn") ?? mesh.links[0];
  if (!link || isEmpty(mesh)) return place(env, ship, [offset[0], 0, offset[2]], P);
  const at = pointOf(mesh, link.at.cell, link.at.u, link.at.v);
  return place(env, ship, [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]], P);
}

/** S1: stand at a station's link (or, without one, at the projection of `fallback`). */
export function takeStation(env, ship, stationId, fallback = null, P = DECK) {
  const mesh = env.mesh(ship);
  if (!mesh || isEmpty(mesh)) return null;
  const link = mesh.links.find((l) => l.kind === "station" && l.id === stationId);
  const at = link?.at ?? (fallback ? projectPoint(mesh, fallback, P.step) : null);
  if (!at) return null;
  const st = { mode: "station", ship, mesh, cell: at.cell, u: at.u, v: at.v, station: stationId };
  st.last = lastOf(env, ship, localFeet(st));
  return { state: st, yaw: link ? link.yaw : 0 };
}

/** S2: step away from a station: walking where you stood. */
export function leaveStation(st) {
  if (st?.mode !== "station") return st;
  return { mode: "walking", ship: st.ship, mesh: st.mesh, cell: st.cell, u: st.u, v: st.v, vel: [0, 0], last: st.last };
}

/** L1: onto her ladder from the water. null if she has no mesh or no ladder. */
export function climb(env, ship) {
  const mesh = env.mesh(ship);
  if (!mesh || isEmpty(mesh)) return null;
  const link = mesh.links.find((l) => l.kind === "ladder");
  if (!link) return null;
  return { mode: "ladder", ship, mesh, link, t: 0 };
}

// ─── the swimmer and the ships ──────────────────────────────────────────────

/** Every ship a swimmer must be clear of: the same list checkWalker's swimming case reads. */
function shadows(env) {
  const out = [];
  for (const ship of env.ships?.() ?? []) {
    const M = env.frame(ship);
    const mesh = env.mesh(ship);
    if (M && mesh) out.push({ ship, M, inv: invert(M), mesh });
  }
  return out;
}

/** The first of `list` whose D_r holds the world plan point q (at the sea's surface there), or null: checkWalker's test, exactly. */
function shadowAt(list, env, q) {
  if (!list.length) return null;
  const y = env.surface(q[0], q[1]);
  for (const s of list) {
    const L = apply(s.inv, [q[0], y, q[1]]);
    if (inShadow(s.mesh, L[0], L[2])) return s;
  }
  return null;
}

/** Waves and heave: how far the sea's surface may stand from a ship's origin height, for the ring search's bound (m). */
const SEA_SPAN = 10;

/**
 * How far from p a ring must reach to lie wholly outside one ship's grid
 * (so outside her D_r), in the world plan. Her grid reaches E from her
 * origin in her plan; at a horizontal distance D from her origin, a point
 * at the surface is at least √((D − D·sinθ − Y)(D + D·sinθ + Y)) from it in
 * her plan (θ her tilt, Y the surface's height off hers), which is > E once
 * D(1 − sinθ) − Y > E. Infinite for a ship on her beam ends.
 */
function clearReach(s, p, env) {
  const { M, mesh } = s;
  const k = Math.hypot(M[0], M[1], M[2]) || 1;
  const c = mesh.params?.cell ?? 0.05;
  const [x0, z0] = mesh.origin ?? [0, 0];
  const x1 = x0 + (mesh.nx ?? 0) * c;
  const z1 = z0 + (mesh.nz ?? 0) * c;
  const E = k * Math.max(Math.hypot(x0, z0), Math.hypot(x1, z0), Math.hypot(x0, z1), Math.hypot(x1, z1));
  const sin = Math.hypot(M[4], M[6]) / k;
  const Y = Math.abs(env.surface(p[0], p[1]) - M[13]) + SEA_SPAN;
  if (sin >= 0.999) return Infinity;
  return Math.hypot(M[12] - p[0], M[14] - p[1]) + (E + Y) / (1 - sin) + c;
}

/**
 * SW1's push: the world plan point nearest p that is outside every ship's
 * D_r (to within a cell).
 * 1. A few passes, each moving the point to the putOut of the ship it's in
 *    (B5: outside her own D_r). That is the answer when it ends outside them all.
 * 2. Else (ships rafted so close their D_r overlap, and each one's putOut
 *    lies in the other's): rings about p, a cell apart, sampled a cell apart
 *    round, out to where no ship's grid reaches (clearReach); the first
 *    sample outside every D_r.
 * Each answer is tested with checkWalker's own test (shadowAt), so a swimmer
 * is never put inside the union of the D_r; and the search is total, as the
 * outermost ring is outside every grid. Asserted (__SAILING_ASSERT__).
 */
export function pushOut(env, p) {
  let q = [p[0], p[1]];
  const list = shadows(env);
  for (let pass = 0; pass < 4; pass++) {
    const s = shadowAt(list, env, q);
    if (!s) return q;
    const y = env.surface(q[0], q[1]);
    const L = apply(s.inv, [q[0], y, q[1]]);
    const [x, z] = putOutAt(s.mesh, L[0], L[2]);
    const w = apply(s.M, [x, L[1], z]);
    q = [w[0], w[2]];
  }
  if (!shadowAt(list, env, q)) return q;
  const c = Math.min(...list.map((s) => (s.mesh.params?.cell ?? 0.05) * (Math.hypot(s.M[0], s.M[1], s.M[2]) || 1)));
  const far = Math.max(...list.map((s) => clearReach(s, p, env)));
  const reach = Number.isFinite(far) ? far : 200;
  for (let rho = c; rho <= reach + c; rho += c) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * rho) / c));
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n;
      const w = [p[0] + rho * Math.cos(a), p[1] + rho * Math.sin(a)];
      if (!shadowAt(list, env, w)) return w;
    }
  }
  // unreachable but for a ship on her beam ends: no point within 200 m is clear
  if (asserting()) throw new Error(`walker invariant: no water clear of every ship near ${p.map((v) => v.toFixed(3))}`);
  return q;
}

/**
 * Into the water at `exit` (her plan) at feet height `y` (her frame): or,
 * if another ship has a kept cell under that world point within `step` of
 * the feet, onto her deck (W3's stepping across).
 */
function intoWater(env, ship, M, exit, y, vel, yaw, P) {
  const X = apply(M, [exit[0], y, exit[1]]);
  const v3 = rotateM(M, [vel[0], 0, vel[1]]);
  for (const other of env.ships?.() ?? []) {
    if (other === ship) continue;
    const M2 = env.frame(other);
    const mesh2 = env.mesh(other);
    if (!M2 || !mesh2 || isEmpty(mesh2)) continue;
    const L = apply(invert(M2), X);
    const col = columnAt(mesh2, L[0], L[2]);
    if (col < 0) continue;
    let best = -1;
    let bestDy = Infinity;
    const c = mesh2.cell;
    const i = col % mesh2.nx;
    const k = (col - i) / mesh2.nx;
    const u = clamp01((L[0] - mesh2.origin[0]) / c - i);
    const v = clamp01((L[2] - mesh2.origin[1]) / c - k);
    for (let a = mesh2.column[col]; a < mesh2.column[col + 1]; a++) {
      const dy = Math.abs(surfaceAt(mesh2, a, u, v) - L[1]);
      if (dy <= P.step && dy < bestDy) {
        best = a;
        bestDy = dy;
      }
    }
    if (best < 0) continue;
    const lv = unrotateM(M2, v3);
    return { state: walkingAt(env, other, mesh2, { cell: best, u, v }, [lv[0], lv[2]]), yaw: yaw + headingOf(M) - headingOf(M2) };
  }
  return { state: swimmingAt(env, [X[0], X[2]], [v3[0] * 0.3, v3[2] * 0.3]), yaw: yaw + headingOf(M) };
}

// ─── one move over the mesh ─────────────────────────────────────────────────

/** Does a body (plan point q, feet y0 to head y1, radius r) meet a capsule { a, b, r }? Conservative: the capsule's ends as slabs. */
export function meetsCapsule(q, y0, y1, r, cap) {
  const { a, b } = cap;
  const cr = cap.r;
  let t0 = 0;
  let t1 = 1;
  const dy = b[1] - a[1];
  if (Math.abs(dy) < 1e-12) {
    if (a[1] < y0 - cr || a[1] > y1 + cr) return false;
  } else {
    let ta = (y0 - cr - a[1]) / dy;
    let tb = (y1 + cr - a[1]) / dy;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(0, ta);
    t1 = Math.min(1, tb);
    if (t0 > t1) return false;
  }
  const px = a[0] + (b[0] - a[0]) * t0;
  const pz = a[2] + (b[2] - a[2]) * t0;
  const qx = a[0] + (b[0] - a[0]) * t1;
  const qz = a[2] + (b[2] - a[2]) * t1;
  const ex = qx - px;
  const ez = qz - pz;
  const l2 = ex * ex + ez * ez;
  const s = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - px) * ex + (q[1] - pz) * ez) / l2)) : 0;
  return Math.hypot(q[0] - (px + ex * s), q[1] - (pz + ez * s)) < r + cr;
}

function blocked(env, ship, mesh, cell, u, v, h, P) {
  const caps = env.blockers?.(ship);
  if (!caps?.length) return false;
  const [x, z] = planOf(mesh, cell, u, v);
  const y = surfaceAt(mesh, cell, u, v) + h;
  return caps.some((cap) => meetsCapsule([x, z], y, y + P.height, P.radius, cap));
}

/**
 * The plan displacement (dx, dz) walked side by side over the cells (a DDA).
 * Within a cell: move. At a side, by its record: STEP crosses (in the air,
 * only if the height fits the cell beyond); WALL blocks that axis (in the
 * air, high enough and to somewhere: a vault); OPEN leads into the water.
 * Exactly through a corner, X goes first.
 * `lift`: how far the feet jumped up (or, negative, down) at the STEPs crossed
 * on the ground, and on landing up one in the air: what the camera eases (presentation only).
 * @returns {{ cell, u, v, h, air, vel, lift, vault?: { side, h, w }, exit?: number }}
 */
export function travel(mesh, pos, dx, dz, vel, air, P = DECK) {
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

// ─── one step ───────────────────────────────────────────────────────────────

/**
 * One step of the walker.
 * @param {object} st  a state
 * @param {{ forward, strafe, run?, jump? }} input
 * @param {number} yaw  aboard: to her bow; in the water: the world's
 * @param {number} dt
 * @param {object} env
 * @returns {{ state: object, yaw: number, lift?: number }}  yaw changes only when the frame does (stepping across,
 *   into the water); lift: how far the feet jumped at a STEP this step (her up), for the camera to ease
 */
export function step(st, input, yaw, dt, env, P = DECK, S = SWIM) {
  const W = { ...WALKER, ...P };
  if (!st) return { state: st, yaw };
  if (st.mode === "boarding") {
    const M = env.frame(st.ship);
    const mesh = M ? env.mesh(st.ship) : null;
    if (mesh) {
      // B1: her mesh landed; yaw was to her bow, so into the water (an empty mesh) it turns by her heading
      const next = st.at ? place(env, st.ship, st.at, P) : spawnOn(env, st.ship, st.offset ?? [0, 0, 0], P);
      return { state: next, yaw: next.mode === "swimming" ? yaw + headingOf(M) : yaw };
    }
    const t = (st.t ?? 0) + dt;
    if (!M || t > W.boardWait) {
      // G1 while boarding (she's gone), or her model never came: into the water where you were to board
      const last = (M ? lastOf(env, st.ship, st.at ?? st.offset ?? [0, 0, 0]) : null) ?? st.last;
      const p = st.from ?? last?.feet ?? [0, 0, 0];
      return { state: swimmingAt(env, [p[0], p[2]]), yaw: yaw + (last?.heading ?? 0) };
    }
    return { state: { ...st, t, last: lastOf(env, st.ship, st.at ?? st.offset ?? [0, 0, 0]) ?? st.last }, yaw };
  }
  if (st.mode === "swimming") return { state: swim(st, input, yaw, dt, env, S), yaw };
  if (st.mode === "ladder") {
    // L2: at the top (for now in one step, as boarding by the ladder always was)
    const s2 = walkingAt(env, st.ship, st.mesh, st.link.at);
    return { state: s2, yaw: st.link.yaw };
  }
  if (!ABOARD.has(st.mode)) return { state: st, yaw };

  const M = env.frame(st.ship);
  if (!M) {
    // G1: she's gone; into the water where you last were
    const p = st.last?.feet ?? [0, 0, 0];
    return { state: swimmingAt(env, [p[0], p[2]]), yaw: yaw + (st.last?.heading ?? 0) };
  }
  const mesh = env.mesh(st.ship);
  if (!mesh) return { state: { ...st, last: lastOf(env, st.ship, localFeet(st)) }, yaw };
  if (mesh !== st.mesh) {
    // R1: rebaked under you: projected onto the new mesh; into the water, yaw (to her bow) becomes the world's
    const next = place(env, st.ship, localFeet(st), P);
    return { state: next, yaw: next.mode === "swimming" ? yaw + headingOf(M) : yaw };
  }

  // W5: awash (she's going down): into the water, out of her D_r
  {
    const local = localFeet(st);
    const w = apply(M, local);
    if (w[1] < env.surface(w[0], w[2]) - W.sunk) {
      const [x, z] = putOutAt(mesh, local[0], local[2]);
      const at = apply(M, [x, local[1], z]);
      return { state: swimmingAt(env, [at[0], at[2]]), yaw: yaw + headingOf(M) };
    }
  }

  let s = st;
  if (s.mode === "station") return { state: { ...s, last: lastOf(env, s.ship, localFeet(s)) }, yaw };

  if (s.mode === "vaulting") return vault(s, yaw, dt, env, M, mesh, W);

  const want = wishVelocity(input, yaw, P);
  if (s.mode === "walking") {
    const vel = approach(s.vel, want, P.accelGround * dt);
    if (input.jump && P.jump > 0) {
      s = { mode: "airborne", ship: s.ship, mesh, cell: s.cell, u: s.u, v: s.v, h: 0, vy: P.jump, vel }; // W4
    } else {
      const r = travel(mesh, s, vel[0] * dt, vel[1] * dt, vel, false, W);
      if (r.exit != null) return intoWater(env, s.ship, M, sideExit(mesh, r.cell, r.exit), localFeet(s)[1], r.vel, yaw, P); // W3
      let next = { mode: "walking", ship: s.ship, mesh, cell: r.cell, u: r.u, v: r.v, vel: r.vel };
      let lift = r.lift;
      if (blocked(env, s.ship, mesh, r.cell, r.u, r.v, 0, P) && !blocked(env, s.ship, mesh, s.cell, s.u, s.v, 0, P)) (next = { ...s, vel: [0, 0] }), (lift = 0);
      next.last = lastOf(env, s.ship, localFeet(next));
      return { state: next, yaw, lift };
    }
  } else {
    s = { ...s, vel: approach(s.vel, want, P.accelAir * dt) };
  }

  // airborne: across first, at the height you're at; then up and down
  const r = travel(mesh, s, s.vel[0] * dt, s.vel[1] * dt, s.vel, true, W);
  if (r.exit != null) return intoWater(env, s.ship, M, sideExit(mesh, r.cell, r.exit), localFeet(s)[1], r.vel, yaw, P); // A5
  if (r.vault) {
    // A4: into a WALL high enough, to somewhere: across its band
    const v = { mode: "vaulting", ship: s.ship, mesh, cell: r.cell, side: r.vault.side, d: 0, h: r.vault.h, vy: s.vy, vel: r.vel, w: r.vault.w };
    v.last = lastOf(env, s.ship, localFeet(v));
    return { state: v, yaw };
  }
  let next;
  let lift = r.lift;
  if (!r.air) next = { mode: "walking", ship: s.ship, mesh, cell: r.cell, u: r.u, v: r.v, vel: r.vel };
  else next = { mode: "airborne", ship: s.ship, mesh, cell: r.cell, u: r.u, v: r.v, h: r.h, vy: s.vy, vel: r.vel };
  if (blocked(env, s.ship, mesh, next.cell, next.u, next.v, next.h ?? 0, P) && !blocked(env, s.ship, mesh, s.cell, s.u, s.v, s.h, P)) {
    next = { ...s, vel: [0, 0] };
    lift = 0;
  }
  if (next.mode === "airborne") next = fall(next, dt, env, mesh, P);
  next.last = lastOf(env, next.ship, localFeet(next));
  return { state: next, yaw, lift };
}

/** A1/A2: up and down under gravity (her −Y), under her headroom and any blocker; landing walks. */
function fall(s, dt, env, mesh, P) {
  const vy0 = s.vy;
  let vy = vy0 - P.gravity * dt;
  let h = s.h + ((vy0 + vy) / 2) * dt;
  const room = mesh.cells.headroom[s.cell];
  if (h >= room) {
    h = room;
    if (vy > 0) vy = 0; // a head bump
  }
  if (h > s.h && blocked(env, s.ship, mesh, s.cell, s.u, s.v, h, P) && !blocked(env, s.ship, mesh, s.cell, s.u, s.v, s.h, P)) {
    let lo = s.h;
    let hi = h;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (blocked(env, s.ship, mesh, s.cell, s.u, s.v, mid, P)) hi = mid;
      else lo = mid;
    }
    h = lo;
    vy = Math.min(vy, 0);
  }
  if (h <= 0 && vy <= 0) return { mode: "walking", ship: s.ship, mesh, cell: s.cell, u: s.u, v: s.v, vel: s.vel };
  return { ...s, h: Math.max(0, h), vy };
}

/** V1/V2: across a WALL's band; down on the far side (a cell, or the water). */
function vault(s, yaw, dt, env, M, mesh, P) {
  const e = s.cell * 4 + s.side;
  const S = mesh.side;
  const [ax, az] = DIRS[s.side];
  const along = s.vel[0] * ax + s.vel[1] * az;
  const d = Math.min(S.gap[e], s.d + Math.max(along, P.vault) * dt);
  const vy0 = s.vy;
  let vy = vy0 - P.gravity * dt;
  let h = s.h + ((vy0 + vy) / 2) * dt;
  if (h < S.rise[e]) {
    h = S.rise[e];
    vy = Math.max(vy, 0);
  }
  if (h > S.top[e]) {
    h = S.top[e];
    vy = Math.min(vy, 0);
  }
  if (d < S.gap[e]) {
    const next = { ...s, d, h, vy };
    next.last = lastOf(env, s.ship, localFeet(next));
    return { state: next, yaw };
  }
  // V2: d reached the gap
  const base = sideBase(mesh, s.cell, s.side);
  const to = S.to[e];
  if (to === OVERBOARD) return intoWater(env, s.ship, M, sideExit(mesh, s.cell, s.side), base + h, s.vel, yaw, P);
  const u = ax ? (ax > 0 ? 0 : 1) : s.w;
  const v = az ? (az > 0 ? 0 : 1) : s.w;
  const h2 = Math.max(0, Math.min(base + h - surfaceAt(mesh, to, u, v), mesh.cells.headroom[to]));
  let next;
  if (h2 <= TOL && vy <= 0) next = { mode: "walking", ship: s.ship, mesh, cell: to, u, v, vel: s.vel };
  else next = { mode: "airborne", ship: s.ship, mesh, cell: to, u, v, h: h2, vy, vel: s.vel };
  next.last = lastOf(env, s.ship, localFeet(next));
  return { state: next, yaw };
}

const sideExit = (mesh, a, s) => [mesh.side.exit[(a * 4 + s) * 2], mesh.side.exit[(a * 4 + s) * 2 + 1]];

/** SW1: a stroke in the world at the surface, then out of any ship's D_r. */
function swim(st, input, yaw, dt, env, S) {
  const want = wishVelocity({ ...input, jump: false }, yaw, S);
  const vel = approach(st.vel, want, S.accelGround * dt);
  let dx = vel[0] * dt;
  let dz = vel[1] * dt;
  const l = Math.hypot(dx, dz);
  if (l > WALKER.maxMove) {
    dx *= WALKER.maxMove / l;
    dz *= WALKER.maxMove / l;
  }
  return { mode: "swimming", p: pushOut(env, [st.p[0] + dx, st.p[1] + dz]), vel };
}

// ─── the invariant ──────────────────────────────────────────────────────────

/**
 * Invariant I, per state (DESIGN.md): the problems with a state, [] if none.
 * The crew checks it after every step, and throws while asserting() (tests, probes).
 */
export function checkWalker(st, env) {
  const bad = [];
  if (!st || typeof st !== "object") return ["no state"];
  const inRange = (x) => Number.isFinite(x) && x >= 0 && x <= 1;
  const mesh = st.mesh;
  const cellOk = () => mesh && Number.isInteger(st.cell) && st.cell >= 0 && st.cell < mesh.count;
  switch (st.mode) {
    case "boarding":
      if (st.cell != null || st.p != null) bad.push("boarding has a position");
      break;
    case "walking":
    case "station":
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
    case "ladder":
      if (!mesh || !st.link || st.link.kind !== "ladder" || !(st.t >= 0 && st.t <= 1)) bad.push("not on her ladder");
      break;
    case "swimming": {
      if (!Array.isArray(st.p) || !st.p.every(Number.isFinite)) {
        bad.push("no place in the water");
        break;
      }
      for (const ship of env?.ships?.() ?? []) {
        const M = env.frame(ship);
        const m = env.mesh(ship);
        if (!M || !m) continue;
        const L = apply(invert(M), [st.p[0], env.surface(st.p[0], st.p[1]), st.p[1]]);
        if (inShadow(m, L[0], L[2])) bad.push(`in ${ship}'s shadow (D_r) at ${L[0].toFixed(3)}, ${L[2].toFixed(3)}`);
      }
      break;
    }
    default:
      bad.push(`no such mode: ${st.mode}`);
  }
  return bad;
}

/** checkWalker, thrown. */
export function assertWalker(st, env) {
  const bad = checkWalker(st, env);
  if (bad.length) throw new Error(`walker invariant: ${bad.join("; ")} (${st?.mode})`);
}

export { OPEN, OVERBOARD, STEP, WALL, NONE };
