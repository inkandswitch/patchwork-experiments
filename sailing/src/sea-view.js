// ctx.sea (DESIGN.md, "Play"): what the other parts read of the sea, the
// ocean and wind they float and sail on and the time to ask them at. It
// makes and draws no sea of its own. A boat sails on her world's water,
// which is the outermost doc's (water/WATER.md):
//
//   - ocean: the water package's reader, collected in this stage (its
//     contribution `water`): the world's water in this stage's frame, on
//     this stage's clock. A boat alone is her own world, and it is her own
//     sea exactly; linked into a harbour, it is the harbour's; in a dry room,
//     or tilted, there is none, and nothing sails.
//   - wind: the world's `sailing.wind` ambient (sea.js), made into a wind
//     here (wind.js) and read the same way: mapped by this stage's frame, at
//     the world's time for this stage's t, the offset latched once a frame
//     after every clock has ticked (the water package's rule, copied: tick()).
//   - clock: the doc's world time, api.clock.t() (scene TOOLS.md §7): the
//     computing view's own, every other view's following it.
//
// A boat at another scale than her world's doesn't sail (gravity doesn't
// scale): no ocean, and a notice once.

import { createWind } from "./wind.js";
import { WIND_AMBIENT } from "./sea.js";

/** The water package's contribution that is the world's water as this stage reads it. */
export const WATER = "water";
const EPS = 1e-9;

/**
 * A frame (scope.js's { matrix }, column-major; null matrix: the identity)
 * as a level placement's numbers, or null when it tilts.
 */
export function levelOf(frame) {
  const m = frame?.matrix ?? null;
  if (!m) return { a: 1, b: 0, c: 0, d: 1, s: 1, tx: 0, tz: 0, identity: true };
  const s = m[5];
  if (!(s > 0)) return null;
  for (const i of [1, 4, 6, 9]) if (Math.abs(m[i]) > EPS * s) return null;
  return { a: m[0], b: m[2], c: m[8], d: m[10], s, tx: m[12], tz: m[14], identity: false };
}

/**
 * The world's wind as a stage reads it: the ambient's numbers made into a
 * wind, its at(x, z, t) in the stage's frame (velocities by the rotation and
 * scale) and the stage's time (τ from `timing`). The world itself gets the
 * wind as made, unwrapped. null for no value or a tilted frame. Pure.
 * @param {{ speed, from, seed } | null} value  @param {{ matrix } | null} frame
 * @param {{ mine: boolean, delta: number, running: boolean, worldT: number }} timing
 */
export function windFor(value, frame, timing) {
  if (!value) return null;
  const f = levelOf(frame);
  if (!f) return null;
  const raw = createWind({ speed: value.speed, from: value.from, seed: value.seed });
  if (timing.mine && f.identity) return raw;
  const { a, b, c, d, s, tx, tz } = f;
  const s2 = s * s;
  const W = [0, 0];
  const tau = (t) => (timing.mine ? t : timing.running ? t + timing.delta : timing.worldT);
  return {
    speed: raw.speed / s,
    from: raw.from,
    gustiness: raw.gustiness,
    at(x, z, t, out = [0, 0]) {
      raw.at(a * x + c * z + tx, b * x + d * z + tz, tau(t), W);
      out[0] = (a * W[0] + b * W[1]) / s2;
      out[1] = (c * W[0] + d * W[1]) / s2;
      return out;
    },
  };
}

const frameKey = (frame) => (frame?.matrix ? frame.matrix.join(",") : "I");

/**
 * ctx.sea. play.js ticks it first each frame.
 * @param {any} api
 */
export function createSeaView(api) {
  const timing = { mine: false, delta: 0, running: true, worldT: 0 };
  let wind = null;
  let windFrom = null; // { value, key, mine }
  let scaled = false; // said once: at another scale, she doesn't sail

  function latch(clock) {
    timing.running = !!clock.running;
    timing.worldT = Number(clock.t) || 0;
    timing.delta = timing.worldT - api.clock.t();
  }

  function refreshWind() {
    const a = api.ambient(WIND_AMBIENT);
    if (!a) {
      wind = null;
      windFrom = null;
      return null;
    }
    const key = frameKey(a.frame);
    if (!windFrom || windFrom.value !== a.value || windFrom.key !== key || windFrom.mine !== a.mine) {
      timing.mine = a.mine;
      if (!a.mine && !windFrom) latch(a.clock);
      wind = windFor(a.value, a.frame, timing);
      windFrom = { value: a.value, key, mine: a.mine };
    }
    return a;
  }

  /** Is this stage at its world's scale (always, for a boat alone)? Sailing needs it. */
  function sameScale() {
    const a = api.ambient(WATER);
    const s = a ? (levelOf(a.frame)?.s ?? 1) : 1;
    const ok = Math.abs(s - 1) <= EPS;
    if (!ok && !scaled) {
      scaled = true;
      api.notify?.("At another scale than the water it's on, a boat doesn't sail (gravity doesn't scale)", "info");
    }
    return ok;
  }

  return {
    /** the world's water here (the water package's reader), or null: no water, tilted, or at another scale */
    get ocean() {
      const w = api.collect(WATER).find((c) => c.value)?.value ?? null;
      return w && sameScale() ? w : null;
    },
    get wind() {
      if (!windFrom) refreshWind();
      return wind;
    },
    /** the sea's time: the doc's world time (s) */
    clock: () => api.clock.t(),
    /** is this boat's doc the world (the outermost: a boat alone)? Her camera ride and her HUD show only then, or while you're aboard */
    world: () => !!api.ambient(WATER)?.mine,
    /** One frame, after every clock has ticked: the wind's offset for the next frame's reads. */
    tick() {
      const a = refreshWind();
      if (a && !a.mine) latch(a.clock);
      return api.clock.t();
    },
  };
}
