// A stand-in for the weather package's offer of the world's wind, for
// sailing's fakes and tests. The weather package (weather/WEATHER.md, "What
// it offers") turns the scene trait `weather` into the `wind` ambient:
// every field the trait leaves out, or holds in a shape it can't be, is its
// default; a number outside its range is clamped into it; the trait's own
// numbers are then passed through as { speed, from, seed, gustiness }. This
// is that rule for the four fields the wind reads, copied from
// weather/src/weather.js (weatherParams, windOf) and weather/src/index.js
// (the fields' defaults and ranges): sailing imports no other package. The
// real offer is checked against a boat's wind by the probes, which load the
// weather package's build (probes/sailing-run.mjs, harbour-run.mjs).

/** The air's fields of the weather trait: its key, default and range (weather/src/index.js). */
export const AIR = Object.freeze({
  wind: Object.freeze({ default: 4, min: 0, max: 40 }),
  from: Object.freeze({ default: 235, min: 0, max: 360 }),
  gustiness: Object.freeze({ default: 0.3, min: 0, max: 1 }),
});
/** The gust seed's default: any safe integer is one. */
export const SEED = 1;

const number = (t, key) => {
  const f = AIR[key];
  const v = Object.hasOwn(t, key) ? t[key] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, v)) + 0 : f.default;
};

/**
 * The `wind` ambient a `weather` trait offers: { speed, from, seed,
 * gustiness }, or null for no trait (a falsy one), as the weather's
 * extension offers nothing then.
 */
export function windOffer(trait) {
  if (!trait) return null;
  const t = typeof trait === "object" ? trait : {};
  const seed = Object.hasOwn(t, "seed") && Number.isSafeInteger(t.seed) ? t.seed + 0 : SEED;
  return { speed: number(t, "wind"), from: number(t, "from"), seed, gustiness: number(t, "gustiness") };
}
