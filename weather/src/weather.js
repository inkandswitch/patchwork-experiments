// The weather trait made whole, and the world's wind (WEATHER.md, "The data"
// and "What it offers"). Pure.
//
// weatherParams fills every field the trait leaves out, or gives in a shape
// it can't be, with its default, and clamps every number into its described
// range, so the ambients never see a value the sliders couldn't show and
// never throw. The fields, defaults and ranges are index.js's describes: one
// source, which WEATHER.md's table is checked against.

import { plugins } from "./index.js";
import { validDate } from "./time.js";

/** The weather trait's described fields (index.js), in order. */
export const FIELDS = plugins.find((p) => p.describes?.weather).describes.weather.fields;

/** Every field's default: the trait a new world's weather starts as. */
export const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.key, f.default])));

/** The checks a field's value must pass, by key, beyond its kind's. */
const VALID = { date: validDate };

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
 * is its default (an invalid date too, by time.js's predicate), and
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
 * people, where the sun is computed from, and the clock people there read
 * (British Columbia's is UTC-7 all year from November 2026). Cadboro Bay is
 * the defaults'; Ucluelet is terrain's origin there (terrain/src/ucluelet.js
 * ORIGIN). The name lives here, not in the doc: the coordinates are the
 * place, so nothing in the doc can say one place while meaning another.
 */
export const PLACES = Object.freeze([
  Object.freeze({ name: "Cadboro Bay", lat: 48.454, lon: -123.2915, offset: -7 }),
  Object.freeze({ name: "Ucluelet", lat: 48.95, lon: -125.558, offset: -7 }),
]);

/** The place among PLACES the params are at (lat and lon exactly: the clock is when, not where), or null. */
export const placeOf = (p) => PLACES.find((q) => q.lat === p.lat && q.lon === p.lon) ?? null;

/**
 * The fields a fetched snapshot speaks for: the conditions (wind, gusts,
 * sky) and the place and moment they are of. Every field but `seed`, which
 * picks the gust pattern and is not weather.
 */
export const SUMMED = Object.freeze(FIELDS.map((f) => f.key).filter((k) => k !== "seed"));

/**
 * What a fetch writes as `source.fields`: the summed fields in force, as a
 * map. Exact values, keyed by name, so no dialled weather can pass for a
 * fetched one, the doc says what was fetched, and no field order is implied.
 */
export const fetchedFields = (p) => Object.fromEntries(SUMMED.map((k) => [k, p[k]]));

/**
 * The summed fields dialled since the fetch on record, in field order: those
 * whose value in force isn't `source.fields`'s (a field the source doesn't
 * name counts as dialled). null with no fetch on record: no `source` of the
 * trait's own, or one without a `fields` map. Pure: nothing intercepts an
 * edit to know.
 */
export function dialledSince(trait) {
  const own = (o, k) => !!o && typeof o === "object" && !Array.isArray(o) && Object.hasOwn(o, k);
  if (!own(trait, "source") || !own(trait.source, "fields")) return null;
  const f = trait.source.fields;
  if (!f || typeof f !== "object" || Array.isArray(f)) return null;
  const p = weatherParams(trait);
  return SUMMED.filter((k) => !Object.hasOwn(f, k) || f[k] !== p[k]);
}

/**
 * Where the weather in force came from (WEATHER.md, "The data"): "fetched"
 * while every summed field is as the fetch wrote it, "dialled since fetch"
 * once one isn't, and "dialled" with no fetch on record.
 */
export function provenance(trait) {
  const d = dialledSince(trait);
  return d == null ? "dialled" : d.length ? "dialled since fetch" : "fetched";
}
