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
export const FIELDS = plugins.find((p) => p.describes?.weather).describes.weather.fields;

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
  return Object.fromEntries(FIELDS.map((f) => [f.key, fieldOf(f, Object.hasOwn(t, f.key) ? t[f.key] : undefined)]));
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

// ─── places and provenance ───────────────────────────────────────────────────

/**
 * The places the Place command offers (WEATHER.md, "Setting it"): a name for
 * people and where the sun is computed from. Cadboro Bay is the defaults';
 * Ucluelet is terrain's origin there (terrain/src/ucluelet.js ORIGIN).
 */
export const PLACES = Object.freeze([
  Object.freeze({ place: "Cadboro Bay", lat: 48.454, lon: -123.2915, zone: "America/Vancouver" }),
  Object.freeze({ place: "Ucluelet", lat: 48.95, lon: -125.558, zone: "America/Vancouver" }),
]);

/** The place among PLACES the params are at (lat, lon and zone exactly; the name is a label), or null. */
export const placeOf = (p) => PLACES.find((q) => q.lat === p.lat && q.lon === p.lon && q.zone === p.zone) ?? null;

/**
 * The fields a fetched snapshot speaks for: the conditions (wind, gusts,
 * sky) and the place and moment they are of. Not `place` (a label) or
 * `seed` (which gust pattern plays, not the weather's).
 */
export const SUMMED = Object.freeze(FIELDS.map((f) => f.key).filter((k) => k !== "place" && k !== "seed"));

/**
 * The key a fetch writes as `source.sum`: the summed fields in force, in
 * order, as JSON. Exact, not a hash, so no dialled weather can pass for a
 * fetched one.
 */
export const sumOf = (p) => JSON.stringify(SUMMED.map((k) => p[k]));

/**
 * Where the weather in force came from (WEATHER.md, "The data"):
 * "fetched" while every summed field is as the fetch wrote it, "dialled
 * since fetch" once one isn't, and "dialled" with no fetch on record (no
 * `source`, or one without a string `sum`). Pure: nothing intercepts an
 * edit to know.
 */
export function provenance(trait) {
  const s = trait && typeof trait === "object" && Object.hasOwn(trait, "source") ? trait.source : null;
  if (!s || typeof s !== "object" || typeof s.sum !== "string") return "dialled";
  return s.sum === sumOf(weatherParams(trait)) ? "fetched" : "dialled since fetch";
}
