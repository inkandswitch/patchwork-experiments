// The weather trait made whole, and the world's wind (WEATHER.md, "The data"
// and "What it offers"). Pure.
//
// weatherParams fills every field the trait leaves out, or gives in a shape
// it can't be, with its default, and clamps every number into its described
// range, so the ambients never see a value the sliders couldn't show and
// never throw. The fields, defaults and ranges are index.js's describes: one
// source, which WEATHER.md's table is checked against.

import { plugins } from "./index.js";
import { validDate, validZone } from "./time.js";

/** The weather trait's described fields (index.js), in order. */
export const FIELDS = plugins[0].describes.weather.fields;

/** Every field's default: the trait a new world's weather starts as. */
export const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.key, f.default])));

/** The checks a field's value must pass, by key, beyond its kind's. */
const VALID = { zone: validZone, date: validDate };

/** One field's value in force: the trait's when it is one the field can hold (clamped into a number's range), else the default. */
function fieldOf(f, v) {
  switch (f.kind) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, v)) + 0 : f.default;
    case "integer":
      return Number.isSafeInteger(v) ? v + 0 : f.default;
    case "enum":
      return f.options.some((o) => o.value === v) ? v : f.default;
    default: // string
      return typeof v === "string" && (VALID[f.key]?.(v) ?? true) ? v : f.default;
  }
}

/**
 * The weather trait with every field in force: a missing or malformed field
 * is its default (an invalid zone or date too, by time.js's predicates), and
 * a number outside its range is clamped into it. `source` is not a field and
 * is dropped: nothing the ambients compute reads it. Any trait, even none,
 * gives a whole set of params.
 */
export function weatherParams(trait) {
  const t = trait && typeof trait === "object" ? trait : {};
  return Object.fromEntries(FIELDS.map((f) => [f.key, fieldOf(f, t[f.key])]));
}

/**
 * The world's wind (the ambient `wind`; WEATHER.md, "What it offers"):
 * { speed (m/s at 10 m), from (degrees true), seed, gustiness (0..1) }. The
 * trait's own fields passed through: gustiness is sailing's quantity, so
 * nothing converts it, and the sim reads exactly the numbers in the doc.
 */
export function windOf(p) {
  return { speed: p.wind, from: p.from, seed: p.seed, gustiness: p.gustiness };
}

/** The gustiness field's default and slider step. */
const GUSTINESS = FIELDS.find((f) => f.key === "gustiness");

/**
 * The gustiness of an hour whose mean wind is `mean` and whose peak gust is
 * `peak` (m/s; a fetch's wind_speed_10m and wind_gusts_10m): the peak over
 * the mean, less 1, clamped to 0..1 and rounded to the slider's step
 * (Decision 10: the model's hourly peak is mean · (1 + g)). In a calm (mean
 * under 0.5 m/s) a gust factor means nothing, and with no peak there is
 * none: both are the default.
 */
export function gustinessOf(mean, peak) {
  if (!(Number.isFinite(mean) && mean >= 0.5 && Number.isFinite(peak))) return GUSTINESS.default;
  const g = Math.min(GUSTINESS.max, Math.max(GUSTINESS.min, peak / mean - 1));
  return Number((Math.round(g / GUSTINESS.step) * GUSTINESS.step).toFixed(2)); // 0.05 steps: two decimals are exact
}
