// Fetching a place's real weather (WEATHER.md, "Fetch"): Open-Meteo's
// forecast and archive APIs, read into a snapshot of the weather trait. Pure
// except for fetchWeather's one fetch call.
//
//   requestFor(params, now)  → which API, which hour, and the one URL; null
//                               when Open-Meteo has no weather for that time
//   fetchWeather(request)    → the reply's JSON (the only network call)
//   snapshotFrom(json, request) → every summed field, on its slider, plus
//                               `source`: what the Fetch commands write
//
// What leaves the machine is the URL alone: coordinates, a date, variable
// names and two unit settings, under a fixed set of query keys (QUERY). No
// credentials, no referrer, nothing about the viewer or the doc.
//
// Nothing here runs on its own: the extension's ambient() never fetches, and
// a fetch happens only when someone presses Fetch (Decision 33).

import { instantOf } from "./time.js";
import { FIELDS, fetchedFields, weatherParams } from "./weather.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The provider, as `source.name` says it. */
export const NAME = "Open-Meteo";

/** The two endpoints: the forecast (also the last 90 days' and the present conditions) and the ERA5 reanalysis archive. */
export const ENDPOINTS = Object.freeze({
  forecast: "https://api.open-meteo.com/v1/forecast",
  archive: "https://archive-api.open-meteo.com/v1/archive",
});

/** The variables asked for, and the unit each must come back in (the reply's `*_units`). */
export const UNITS = Object.freeze({
  temperature_2m: "°C",
  dew_point_2m: "°C",
  relative_humidity_2m: "%",
  precipitation: "mm",
  weather_code: "wmo code",
  cloud_cover: "%",
  cloud_cover_low: "%",
  cloud_cover_mid: "%",
  cloud_cover_high: "%",
  visibility: "m",
  wind_speed_10m: "m/s",
  wind_direction_10m: "°",
  wind_gusts_10m: "m/s",
});
export const VARIABLES = Object.freeze(Object.keys(UNITS));

/** Every query key a request may carry, by route: the whitelist. */
export const QUERY = Object.freeze({
  current: Object.freeze(["latitude", "longitude", "current", "wind_speed_unit", "timezone"]),
  hourly: Object.freeze(["latitude", "longitude", "hourly", "start_date", "end_date", "wind_speed_unit", "timezone"]),
});

/** How near now counts as now: Open-Meteo's present conditions (15-minutely). */
export const CURRENT_WITHIN = 30 * MINUTE;
/**
 * The forecast API's reach in whole UTC days from today, back and ahead. It
 * serves 93 days back; 90 keeps a request near that edge from being refused
 * for a day boundary or clock that isn't quite ours, and the archive has
 * everything further back (Decision 34).
 */
export const FORECAST_BACK = 90;
export const FORECAST_AHEAD = 15;
/** The archive's first day (ERA5). */
export const ARCHIVE_FROM = Date.UTC(1940, 0, 1);

/** Why a time has no weather to fetch: the Fetch command's reason. */
export const NO_DATA = `${NAME} has no weather for this time: its forecast reaches ${FORECAST_AHEAD} days ahead, and its archive starts in 1940`;

const day = (t) => Math.floor(t / DAY);
/** An instant as a UTC calendar date, YYYY-MM-DD. */
export const isoDate = (t) => new Date(day(t) * DAY).toISOString().slice(0, 10);
/** An instant as Open-Meteo writes a GMT time, YYYY-MM-DDTHH:MM. */
export const isoMinute = (t) => new Date(Math.floor(t / MINUTE) * MINUTE).toISOString().slice(0, 16);

/**
 * Where the weather at `instant` is to be had, asked at `now` (ms):
 * - within 30 minutes of now: the forecast API's present conditions, which
 *   stand for any instant that near (the snapshot keeps the hour asked, and
 *   `source.for` says when the conditions were);
 * - else the hour nearest the instant (half past rounds up), by its UTC day
 *   from today: from 90 days back to 15 ahead, the forecast API's hours;
 *   further back to 1 January 1940, the archive's;
 * - otherwise null: nobody has weather for it.
 * @returns {{ api: "forecast"|"archive", route: "current"|"hourly", at: number } | null}
 */
export function routeOf(instant, now) {
  if (Math.abs(instant - now) <= CURRENT_WITHIN) return { api: "forecast", route: "current", at: instant };
  const at = Math.round(instant / HOUR) * HOUR;
  const d = day(at) - day(now);
  if (d > FORECAST_AHEAD || at < ARCHIVE_FROM) return null;
  return { api: d >= -FORECAST_BACK ? "forecast" : "archive", route: "hourly", at };
}

/**
 * The request for the weather `p` (params in force: lat, lon and the clock's
 * date, hour and offset) says, asked at `now`, or null when there is none to
 * be had (routeOf). It carries the place and clock it is for, so the
 * snapshot is of exactly what was asked, and the one URL it fetches.
 */
export function requestFor(p, now) {
  const r = routeOf(instantOf(p), now);
  if (!r) return null;
  const where = { latitude: String(p.lat), longitude: String(p.lon) };
  const units = { wind_speed_unit: "ms", timezone: "GMT" };
  const vars = VARIABLES.join(",");
  const query = r.route === "current" ? { ...where, current: vars, ...units } : { ...where, hourly: vars, start_date: isoDate(r.at), end_date: isoDate(r.at), ...units };
  const url = `${ENDPOINTS[r.api]}?${new URLSearchParams(query)}`;
  return Object.freeze({ ...r, url, now, lat: p.lat, lon: p.lon, date: p.date, hour: p.hour, offset: p.offset });
}

/**
 * Fetch a request's reply: one GET of its URL, with no credentials and no
 * referrer, so the URL is all that goes. An error reply ({ error: true,
 * reason }) is returned for snapshotFrom to say; a reply that isn't JSON, or
 * a failed status that isn't such a reply, throws.
 */
export async function fetchWeather(request, { fetch = globalThis.fetch, signal } = {}) {
  const r = await fetch(request.url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  let json;
  try {
    json = await r.json();
  } catch {
    throw new Error(`${NAME} answered ${r.status}, not with weather`);
  }
  if (!r.ok && json?.error !== true) throw new Error(`${NAME} answered ${r.status}`);
  return json;
}

// ─── the snapshot ────────────────────────────────────────────────────────────

const field = (key) => FIELDS.find((f) => f.key === key);
const decimals = (step) => (String(step).split(".")[1] ?? "").length;

/** A value on a described number field's slider: clamped into its range, rounded to its step (counted from its min). */
export function onStep(key, v) {
  const f = field(key);
  const x = Math.min(f.max, Math.max(f.min, v));
  return Number((f.min + Math.round((x - f.min) / f.step) * f.step).toFixed(decimals(f.step))) + 0;
}

/**
 * A fetched hour's gustiness (Decision 10): the peak gust over the mean,
 * less 1, on the slider. In a calm (mean under 0.5 m/s), or with no peak, a
 * gust factor means nothing, and it is the default 0.3 (Decision 24).
 */
export function gustinessOf(mean, peak) {
  if (!(Number.isFinite(mean) && mean >= 0.5 && Number.isFinite(peak))) return field("gustiness").default;
  return onStep("gustiness", peak / mean - 1);
}

/** The lifting condensation level, m: where rising air at T with dew point Td makes cloud (Espy's 125 m per degree). */
export const lcl = (t, td) => 125 * (t - td);

/** The cloud layer that dominates (the most cover; low over mid over high on a tie), or null with none. Covers are 0..1. */
export function layerOf(low, mid, high) {
  const layers = [
    ["low", low],
    ["mid", mid],
    ["high", high],
  ].filter(([, c]) => c > 0);
  if (!layers.length) return null;
  const [name, cover] = layers.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { name, cover };
}

/** Typical bases of the layers the data has no base for, m (WMO's mid and high étages). */
export const BASES = Object.freeze({ low: 1000, mid: 3000, high: 7000 });
/** The low cloud base's range, m: fog lifting off the water to dry-air cumulus. */
export const LCL_RANGE = Object.freeze([100, 3000]);

/** The cloud base, m: a low or no layer's from the LCL when the temperature and dew point are known (clamped), else the layer's typical base. */
export function baseOf(layer, t, td) {
  const name = layer?.name ?? "low";
  if (name !== "low" || t == null || td == null) return BASES[name];
  return Math.min(LCL_RANGE[1], Math.max(LCL_RANGE[0], lcl(t, td)));
}

/** WMO weather codes (WMO 4677, as Open-Meteo reports them) grouped by what they say of the sky. */
export const CODES = Object.freeze({
  fog: Object.freeze([45, 48]),
  drizzle: Object.freeze([51, 53, 55, 56, 57]),
  rain: Object.freeze([61, 63, 65, 66, 67]),
  snow: Object.freeze([71, 73, 75, 77]),
  showers: Object.freeze([80, 81, 82]),
  snowShowers: Object.freeze([85, 86]),
  thunder: Object.freeze([95, 96, 99]),
});
const isIn = (group, code) => CODES[group].includes(code);

/** A layer this full or more is a sheet; less, heaps. */
export const SHEET = 0.6;
/** A low sheet under this base is stratus. */
export const STRATUS_BELOW = 300;

/**
 * The cloud kind: what falls says it first (fog, drizzle, steady rain and
 * snow fall from a flat layer: stratus; showers of rain or snow and
 * thunder from heaps: cumulus), else the dominant layer: high is cirrus; a sheet (cover ≥ 0.6)
 * is stratus when low and under 300 m, else stratocumulus; heaps are
 * cumulus. No layer at all is cumulus, the default: the kind doesn't show
 * at cover 0.
 */
export function kindOf(code, layer, base) {
  if (isIn("fog", code) || isIn("drizzle", code) || isIn("rain", code) || isIn("snow", code)) return "stratus";
  if (isIn("showers", code) || isIn("snowShowers", code) || isIn("thunder", code)) return "cumulus";
  if (!layer) return "cumulus";
  if (layer.name === "high") return "cirrus";
  if (layer.cover >= SHEET) return layer.name === "low" && base < STRATUS_BELOW ? "stratus" : "stratocumulus";
  return "cumulus";
}

/** Koschmieder's constant: visibility = 3.912 / extinction (2% contrast). */
export const KOSCHMIEDER = 3.912;

/**
 * Rain's extinction, per metre, at `rain` mm/h: 0.25 · R^0.73 per km, the
 * usual power-law form, set so moderate rain (2.5 mm/h) alone sees about
 * 8 km and heavy rain (25 mm/h) about 1.5 km (Decision 21). Only a derived
 * visibility uses it: an observed one has the rain in it already.
 */
export const rainExtinction = (rain) => (rain > 0 ? 0.25e-3 * rain ** 0.73 : 0);

/**
 * The visibility, m, when the data gives none: the air's (fog's; else
 * humid air's haze, 20 km at 80% and under to 4 km at 100%, log-linear,
 * capped by what falls: snow, drizzle), seen through the rain (its
 * extinction added to the air's; exactly the air's in no rain). Like an
 * observed one, it is the visibility in force (Decision 41).
 */
export const HAZE = Object.freeze({ clear: 20000, humid: 4000, from: 80 });
export const CAPS = Object.freeze({ fog: 500, snow: 2000, drizzle: 5000 });
export function derivedVisibility(code, rh, rain = 0) {
  const haze = rh == null || rh <= HAZE.from ? HAZE.clear : HAZE.clear * (HAZE.humid / HAZE.clear) ** ((Math.min(rh, 100) - HAZE.from) / (100 - HAZE.from));
  const cap = isIn("fog", code) ? CAPS.fog : isIn("snow", code) || isIn("snowShowers", code) ? CAPS.snow : isIn("drizzle", code) ? CAPS.drizzle : Infinity;
  const air = Math.min(haze, cap);
  const k = rainExtinction(rain);
  return k > 0 ? KOSCHMIEDER / (KOSCHMIEDER / air + k) : air;
}

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * A reply's one hour as a reader of its variables, its time and its
 * aggregation interval; throws when the reply has no such hour, when its
 * present conditions aren't within 30 minutes of when they were asked for
 * (request.now, the same point routeOf measures from), or when any variable
 * it has a number for is in another unit than asked (UNITS: every one, by
 * construction).
 */
function hourOf(json, request) {
  const block = json[request.route];
  const units = json[`${request.route}_units`];
  if (!isMap(block)) throw new Error(`${NAME} sent no ${request.route} weather`);
  let at, i, interval;
  if (request.route === "current") {
    if (!TIME.test(block.time)) throw new Error(`${NAME} sent no time for the present conditions`);
    at = Date.parse(`${block.time}Z`);
    if (Math.abs(at - request.now) > CURRENT_WITHIN) throw new Error(`${NAME}'s present conditions are for ${block.time} GMT, not now`);
    interval = Number.isFinite(block.interval) && block.interval > 0 ? block.interval : 3600;
  } else {
    i = Array.isArray(block.time) ? block.time.indexOf(isoMinute(request.at)) : -1;
    if (i < 0) throw new Error(`${NAME} sent no weather for ${isoMinute(request.at)} GMT`);
    at = request.at;
    interval = 3600;
  }
  /** A variable's number at this hour, or null. */
  const num = (k) => {
    const x = i == null ? block[k] : block[k]?.[i];
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  for (const k of VARIABLES) if (num(k) != null && units?.[k] !== UNITS[k]) throw new Error(`${NAME} sent ${k} in ${units?.[k]}, not ${UNITS[k]}`);
  return { at, interval, num };
}

/**
 * A reply as the weather it says: every summed field (WEATHER.md, "The
 * data") on its slider, plus `source`. The place and clock are the
 * request's, so the snapshot is of exactly the place and moment asked; the
 * conditions are the reply's: the present conditions (within 30 minutes of
 * the time asked, routeOf), or the hour nearest it. `source.for` is the
 * conditions' own time:
 * - wind, from: as sent (both required: a reply without them is no weather);
 * - gustiness: the hour's peak gust over the mean (gustinessOf);
 * - cover: the total cloud cover (else the dominant layer's, else none);
 * - base: the LCL under a low layer, a typical base over a mid or high one;
 * - clouds: kindOf; visibility: as sent, rain and all (else
 *   derivedVisibility); rain: the precipitation as a rate, mm/h.
 * `source.fields` is exactly the fields written (fetchedFields), so the
 * weather reads "fetched" until someone dials one. Throws, with a reason for
 * people, on an error reply or one that isn't weather for that hour.
 */
export function snapshotFrom(json, request) {
  if (!isMap(json)) throw new Error(`${NAME} sent nothing readable`);
  if (json.error === true) throw new Error(typeof json.reason === "string" && json.reason ? json.reason : `${NAME} refused the request`);
  if (json.utc_offset_seconds !== 0) throw new Error(`${NAME} answered in another time zone than GMT`);
  const { at, interval, num } = hourOf(json, request);
  const wind = num("wind_speed_10m");
  const from = num("wind_direction_10m");
  if (wind == null || from == null) throw new Error(`${NAME} has no wind for ${isoMinute(at)} GMT`);
  const pct = (k) => (num(k) == null ? null : num(k) / 100);
  const layer = layerOf(pct("cloud_cover_low"), pct("cloud_cover_mid"), pct("cloud_cover_high"));
  const base = baseOf(layer, num("temperature_2m"), num("dew_point_2m"));
  const code = num("weather_code");
  const rain = ((num("precipitation") ?? 0) * 3600) / interval;
  const p = weatherParams({
    lat: request.lat,
    lon: request.lon,
    date: request.date,
    hour: request.hour,
    offset: request.offset,
    wind: onStep("wind", wind),
    from: onStep("from", from),
    gustiness: gustinessOf(wind, num("wind_gusts_10m")),
    cover: onStep("cover", pct("cloud_cover") ?? layer?.cover ?? 0),
    clouds: kindOf(code, layer, onStep("base", base)),
    base: onStep("base", base),
    visibility: onStep("visibility", num("visibility") > 0 ? num("visibility") : derivedVisibility(code, num("relative_humidity_2m"), rain)),
    rain: onStep("rain", rain),
  });
  const fields = fetchedFields(p);
  return {
    ...fields,
    source: { name: NAME, api: request.api, for: new Date(at).toISOString(), fetched: new Date(request.now).toISOString(), fields: { ...fields } },
  };
}
