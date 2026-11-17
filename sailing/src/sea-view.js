// ctx.sea (DESIGN.md, "Play"): what the other parts read of the sea, the
// water and wind they float and sail on and the time to ask them at. It
// makes and draws no sea of its own (water/WATER.md, "Water bodies"):
//
//   - oceanAt(p, not): the water a point in this stage's frame is in, as the
//     water package's contribution `water` answers it (its at(p, { not })),
//     leaving out the water attached under `not` (a ship's own tank never
//     buoys her): the world's open water in this stage's frame and on its
//     clock (a boat alone is her own world, and it is her own sea exactly;
//     linked into a harbour, it is the harbour's), or a bounded body of her
//     own doc, which she keeps wherever she is placed; or null (a dry room,
//     a tilted link), and nothing floats there. p[1] null asks from above.
//   - wind: the world's `wind` ambient (weather.js offers it), made into a wind
//     here (wind.js) and read the same way: mapped by this stage's frame, at
//     the world's time for this stage's t, the offset latched once a frame
//     after every clock has ticked (the water package's rule, copied: tick()).
//     Its speed and from are in this stage's frame too. It is the ambient's
//     as it is when read: made again at the read the ambient changed, not at
//     the next tick, which comes after the frame's steps.
//   - world(): is her doc the world (the outermost: a boat alone)? Read from
//     the wind ambient's `mine`, which her own sea offers wherever she is the
//     world, so it holds whatever packages are installed; elsewhere the wind
//     is another doc's, or nobody's (a dry room). Her camera ride and HUD
//     show only then, or while you're aboard (WATER.md Decisions 19 and 28).
//
// It has no clock of its own: the sea's time is the doc's world time, which
// every reader asks of api.clock.t() (scene TOOLS.md §7: the computing
// view's own, every other view's following it).
//
// A boat at another scale than her world's doesn't sail (gravity doesn't
// scale): no ocean, and a notice once.

import { createWind } from "./wind.js";
import { WIND_AMBIENT } from "./weather.js";

/** The water package's contribution that answers which water a point is in, as this stage reads it. */
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
 * wind, every part of it in the stage's frame: at(x, z, t) (velocities by the
 * rotation and scale, at τ from `timing`), its mean `speed` by the scale and
 * `from` by the rotation, so at() with no gusts blows `speed` from `from`.
 * The world itself gets the wind as made, unwrapped. null for no value or a
 * tilted frame. Pure.
 * @param {{ speed, from, seed, gustiness? } | null} value  @param {{ matrix } | null} frame
 * @param {{ mine: boolean, delta: number, running: boolean, worldT: number }} timing
 */
export function windFor(value, frame, timing) {
  if (!value) return null;
  const f = levelOf(frame);
  if (!f) return null;
  const raw = createWind({ speed: value.speed, from: value.from, seed: value.seed, gustiness: value.gustiness });
  if (timing.mine && f.identity) return raw;
  const { a, b, c, d, s, tx, tz } = f;
  const s2 = s * s;
  const W = [0, 0];
  const tau = (t) => (timing.mine ? t : timing.running ? t + timing.delta : timing.worldT);
  // the mean wind's downwind direction, turned into the frame (Rᵀ, as at() turns velocities), as a compass bearing it blows from
  const rad = (raw.from * Math.PI) / 180;
  const dx = -Math.sin(rad), dz = Math.cos(rad);
  const from = ((Math.atan2(-(a * dx + b * dz), c * dx + d * dz) * 180) / Math.PI + 360) % 360;
  return {
    speed: raw.speed / s,
    from,
    gustiness: raw.gustiness,
    at(x, z, t, out = [0, 0]) {
      raw.at(a * x + c * z + tx, b * x + d * z + tz, tau(t), W);
      out[0] = (a * W[0] + b * W[1]) / s2;
      out[1] = (c * W[0] + d * W[1]) / s2;
      return out;
    },
  };
}

/**
 * The world's mean wind in a stage's frame, as plain numbers: its speed
 * scaled and its `from` turned by the frame (windFor's rule), what a sea
 * builds its waves from. null for no value or a tilted frame. Pure.
 * @returns {{ speed: number, from: number } | null}
 */
export function meanWindHere(value, frame) {
  if (!value) return null;
  const f = levelOf(frame);
  if (!f) return null;
  const speed = Math.max(0, Number(value.speed) || 0);
  const from0 = Number(value.from) || 0;
  if (f.identity) return { speed, from: from0 };
  const rad = (from0 * Math.PI) / 180;
  const dx = -Math.sin(rad), dz = Math.cos(rad);
  const from = ((Math.atan2(-(f.a * dx + f.b * dz), f.c * dx + f.d * dz) * 180) / Math.PI + 360) % 360;
  return { speed: speed / f.s, from };
}

const frameKey = (frame) => (frame?.matrix ? frame.matrix.join(",") : "I");

/**
 * ctx.sea. play.js ticks it first each frame.
 * @param {any} api
 */
export function createSeaView(api) {
  const timing = { mine: false, delta: 0, running: true, worldT: 0 };
  let wind = null;
  let windFrom = null; // { value, key, mine }: the ambient the wind was made from
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
    // the stage hands the frame as a new matrix at every ask (an outer world's: scene scope.frame), so the frame
    // is compared by its numbers, the value by identity (an ambient's value is a new object only when it changed)
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
    /**
     * The water p ([x, y, z] in this stage's frame; y null: from above) is in,
     * leaving out what `not` (an object id) carries: the water package's
     * reader, or null (no water there, a tilted link, or the world's open
     * water at another scale than this boat's).
     */
    oceanAt(p, not = null) {
      const w = api.collect(WATER).find((c) => c.value?.at)?.value ?? null;
      const r = w ? w.at(p, { not }) : null;
      if (!r) return null;
      return r.body == null && !sameScale() ? null : r;
    },
    /**
     * The world's wind as it is now: made again whenever the ambient's value
     * or its frame's numbers changed, at the read, not at the next frame's tick (which comes after
     * the frame's steps), so a step never reads the last value's wind
     * (DESIGN.md, "Determinism"), as the water package's reader is.
     */
    get wind() {
      refreshWind();
      return wind;
    },
    /** is this boat's doc the world (the outermost: a boat alone)? Her camera ride and her HUD show only then, or while you're aboard */
    world: () => !!api.ambient(WIND_AMBIENT)?.mine,
    /** One frame, after every clock has ticked: the wind's offset for the next frame's reads. */
    tick() {
      const a = refreshWind();
      if (a && !a.mine) latch(a.clock);
      return api.clock.t();
    },
  };
}
