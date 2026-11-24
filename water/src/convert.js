// The world's open water as one stage reads it (WATER.md, "Frames" and
// "Time"): the outermost doc's water value (plain JSON: { v, level,
// components, look?, current? }, the current [ux, uz] in m/s, its frequency
// shift already in the components)
// evaluated with this package's own surface, in the calling stage's frame and
// on its clock. Pure.
//
// Frames. A query point in the caller's frame is mapped into the world by
// the caller's frame, evaluated there, and the answer mapped back: heights as
// points, normals and directions by the rotation, velocities by the rotation
// and the scale. For a level similarity (yaw, translation, uniform scale) this
// is exact; a frame whose rotation moves +Y gives no reader.
//
// Time. The water is evaluated at τ, the world's time at the moment the
// caller's clock shows t: t + Δ while the world runs (Δ latched once a frame,
// after every clock has ticked, by latch()), the latched world time while it
// is paused (and the water then has no velocity), and t itself for the
// outermost's own reader.

import { createSurface } from "./surface.js";

/** The water value's version this package reads. */
export const VERSION = 2;
/** How far a frame's rotation may move +Y before the water is refused there. */
export const TILT_EPS = 1e-9;

/**
 * A frame (scope.js's: { matrix } with matrix column-major, or null for the
 * identity) as a level similarity's numbers, world = s·R·p + T with R about
 * Y: { a = m0, b = m2, c = m8, d = m10 (s·R's horizontal entries), s, tx,
 * ty, tz }. null when the rotation moves +Y (tilted) or the frame flips.
 */
export function levelOf(frame) {
  const m = frame?.matrix ?? null;
  if (!m) return IDENTITY;
  const s = m[5];
  if (!(s > 0)) return null;
  for (const i of [1, 4, 6, 9]) if (Math.abs(m[i]) > TILT_EPS * s) return null;
  return { a: m[0], b: m[2], c: m[8], d: m[10], s, tx: m[12], ty: m[13], tz: m[14], identity: false };
}
const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, s: 1, tx: 0, ty: 0, tz: 0, identity: true });

/** A mutable time cell: what latch() last read, and what τ is made of. */
export function createTiming(mine = false) {
  return { mine, delta: 0, running: true, worldT: 0, latched: false };
}

/**
 * Latch the time offset from the world's clock as api.ambient gave it
 * ({ t, running }) and the caller's world time now. Called once a frame,
 * after every stage's clock has ticked, so the next frame's reads don't
 * depend on the order the clocks tick in.
 */
export function latch(timing, clock, ownT) {
  timing.running = !!clock?.running;
  timing.worldT = Number(clock?.t) || 0;
  timing.delta = timing.worldT - (Number(ownT) || 0);
  timing.latched = true;
  return timing;
}

/** τ for the caller's t. */
export const tauOf = (timing, t) => (timing.mine ? t : timing.running ? t + timing.delta : timing.worldT);

/**
 * The world's water as seen from a frame, on a timing: sailing's ocean
 * shape (heightAt, sampleAt, normalAt, velocityAt, displaced, components,
 * stats, plus level and seed for the surface's look, and `body` null: it is
 * the world's open water, no doc's thing; the wind is its own ambient, not
 * the water's). null when there's
 * no value, its version isn't this package's, or the frame is tilted.
 * @param {{ v: number, level: number, components: object[], look?: object, current?: number[] } | null} value
 * @param {{ matrix: number[] | null } | null} frame
 * @param {ReturnType<typeof createTiming>} timing
 */
export function readerFor(value, frame, timing) {
  if (!value || value.v !== VERSION || !Array.isArray(value.components)) return null;
  const f = levelOf(frame);
  if (!f) return null;
  const level = Number(value.level) || 0;
  const surface = createSurface(value.components);
  const look = value.look ?? {};
  const extras = { body: null, level, seed: look.seed ?? 1, stats: look.stats ?? { hs: 0, peakPeriod: 0, peakWavelength: 0, whitecaps: 0 } };
  const Ux = Number(value.current?.[0]) || 0;
  const Uz = Number(value.current?.[1]) || 0;
  // the world itself, at its own time and level 0, with no current: the evaluator as it is (W1: alone is today)
  if (timing.mine && f.identity && level === 0 && !Ux && !Uz) return Object.freeze({ ...surface, ...extras });

  const { a, b, c, d, s, tx, ty, tz } = f;
  const s2 = s * s;
  const still = () => !timing.mine && !timing.running;
  const S = [0, 0, 0, 0];
  const N = [0, 0, 0, 0];
  const V = [0, 0, 0];
  const D = [0, 0, 0, 0];
  // the caller's (x, z) in the world: y never moves them (R is about Y)
  const wx = (x, z) => a * x + c * z + tx;
  const wz = (x, z) => b * x + d * z + tz;
  // a world height as the caller's
  const up = (h) => (h + level - ty) / s;

  function heightAt(x, z, t) {
    return up(surface.heightAt(wx(x, z), wz(x, z), tauOf(timing, t)));
  }
  function sampleAt(x, z, t, out = [0, 0, 1, 0]) {
    surface.sampleAt(wx(x, z), wz(x, z), tauOf(timing, t), S);
    const h = S[0], nx = S[1], ny = S[2], nz = S[3];
    out[0] = up(h);
    out[1] = (a * nx + b * nz) / s;
    out[2] = ny;
    out[3] = (c * nx + d * nz) / s;
    return out;
  }
  function normalAt(x, z, t, out = [0, 1, 0]) {
    sampleAt(x, z, t, N);
    out[0] = N[1];
    out[1] = N[2];
    out[2] = N[3];
    return out;
  }
  function velocityAt(x, y, z, t, out = [0, 0, 0]) {
    if (still()) {
      out[0] = out[1] = out[2] = 0;
      return out;
    }
    surface.velocityAt(wx(x, z), s * y + ty - level, wz(x, z), tauOf(timing, t), V);
    V[0] += Ux;
    V[2] += Uz;
    out[0] = (a * V[0] + b * V[2]) / s2;
    out[1] = V[1] / s;
    out[2] = (c * V[0] + d * V[2]) / s2;
    return out;
  }
  function displaced(x0, z0, t, out = [0, 0, 0, 1]) {
    surface.displaced(wx(x0, z0), wz(x0, z0), tauOf(timing, t), D);
    const dx = D[0] - tx;
    const dz = D[2] - tz;
    out[0] = (a * dx + b * dz) / s2;
    out[1] = up(D[1]);
    out[2] = (c * dx + d * dz) / s2;
    out[3] = D[3];
    return out;
  }
  return Object.freeze({ components: surface.components, heightAt, sampleAt, normalAt, velocityAt, displaced, ...extras });
}
