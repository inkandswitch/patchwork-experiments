// Fetching a place's weather (open-meteo.js), over finite tables: routing at
// every boundary, the URL's keys against the whitelist, the one fetch, the
// recorded replies (src/fixtures, written by probes/record-fixtures.mjs) as
// the fields they become, and each derivation's table.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { visibilityOf } from "./atmosphere.js";
import {
  ARCHIVE_FROM,
  BASES,
  CAPS,
  CODES,
  ENDPOINTS,
  NAME,
  QUERY,
  UNITS,
  VARIABLES,
  airVisibility,
  baseOf,
  derivedVisibility,
  fetchWeather,
  gustinessOf,
  isoMinute,
  kindOf,
  layerOf,
  onStep,
  requestFor,
  routeOf,
  snapshotFrom,
} from "./open-meteo.js";
import { DEFAULTS, FIELDS, SUMMED, dialledSince, fetchedFields, provenance, weatherParams } from "./weather.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (iso) => Date.parse(iso);
const NOW = at("2026-11-16T21:47:00Z");

describe("routeOf: where the weather at an instant is to be had", () => {
  // [instant, route] at NOW (2026-11-16 21:47 UTC): null, or [api, route, the data's instant]
  const rows = [
    ["now", NOW, ["forecast", "current", NOW]],
    ["now - 29 min", NOW - 29 * MIN, ["forecast", "current", NOW - 29 * MIN]],
    ["now + 29 min", NOW + 29 * MIN, ["forecast", "current", NOW + 29 * MIN]],
    ["now - 30 min", NOW - 30 * MIN, ["forecast", "current", NOW - 30 * MIN]],
    ["now + 30 min", NOW + 30 * MIN, ["forecast", "current", NOW + 30 * MIN]],
    ["now - 31 min (21:16 → 21:00)", NOW - 31 * MIN, ["forecast", "hourly", at("2026-11-16T21:00Z")]],
    ["now + 31 min (22:18 → 22:00)", NOW + 31 * MIN, ["forecast", "hourly", at("2026-11-16T22:00Z")]],
    ["day -90, 00:00", at("2026-08-18T00:00Z"), ["forecast", "hourly", at("2026-08-18T00:00Z")]],
    ["now - 90 d", NOW - 90 * DAY, ["forecast", "hourly", at("2026-08-18T22:00Z")]],
    ["day -91, 23:29 (→ 23:00, day -91)", at("2026-08-17T23:29Z"), ["archive", "hourly", at("2026-08-17T23:00Z")]],
    ["day -91, 23:30 (half past rounds up, to day -90)", at("2026-08-17T23:30Z"), ["forecast", "hourly", at("2026-08-18T00:00Z")]],
    ["now - 91 d", NOW - 91 * DAY, ["archive", "hourly", at("2026-08-17T22:00Z")]],
    ["now + 15 d", NOW + 15 * DAY, ["forecast", "hourly", at("2026-12-01T22:00Z")]],
    ["day +15, 23:29", at("2026-12-01T23:29Z"), ["forecast", "hourly", at("2026-12-01T23:00Z")]],
    ["day +15, 23:30 (→ day +16)", at("2026-12-01T23:30Z"), null],
    ["day +16, 00:00", at("2026-12-02T00:00Z"), null],
    ["now + 16 d", NOW + 16 * DAY, null],
    ["1940-01-01 00:00", ARCHIVE_FROM, ["archive", "hourly", ARCHIVE_FROM]],
    ["1939-12-31 23:30 (→ 1940-01-01 00:00)", at("1939-12-31T23:30Z"), ["archive", "hourly", ARCHIVE_FROM]],
    ["1939-12-31 23:29", at("1939-12-31T23:29Z"), null],
    ["year 50", Date.UTC(2000, 0, 1) - 1950 * 365.25 * DAY, null],
    ["year 9999", at("9999-06-01T00:00Z"), null],
  ];
  for (const [name, instant, want] of rows)
    it(`${name} → ${want ? want.slice(0, 2).join(" ") : "null"}`, () => {
      const r = routeOf(instant, NOW);
      expect(r).toEqual(want && { api: want[0], route: want[1], at: want[2] });
    });
});

describe("requestFor: one URL, and only coordinates, a date and variable names in it", () => {
  const P = (o) => weatherParams({ lat: 48.454, lon: -123.2915, offset: -7, ...o });
  // [params, now] → route; every URL is checked whole
  const rows = [
    ["now at Cadboro (14:45 PDT)", P({ date: "2026-11-16", hour: 14.75 }), "current", null],
    ["tomorrow 15:00 at Ucluelet", P({ lat: 48.95, lon: -125.558, date: "2026-11-17", hour: 15 }), "hourly", "2026-11-17"],
    ["15:30 → 16:00, 23:00 UTC", P({ date: "2026-11-17", hour: 15.5 }), "hourly", "2026-11-17"],
    ["16:45 PDT → 00:00 UTC the next day", P({ date: "2026-11-17", hour: 16.75 }), "hourly", "2026-11-18"],
    ["15 July 2025 (the archive)", P({ date: "2025-07-15", hour: 15 }), "hourly", "2025-07-15"],
    ["Sydney, UTC+11 (the UTC day before)", P({ lat: -33.86, lon: 151.21, offset: 11, date: "2026-11-17", hour: 6 }), "hourly", "2026-11-16"],
  ];
  for (const [name, p, route, date] of rows)
    it(`${name}: ${route}${date ? ` ${date}` : ""}`, () => {
      const r = requestFor(p, NOW);
      expect(r.route).toBe(route);
      const url = new URL(r.url);
      expect(`${url.origin}${url.pathname}`).toBe(ENDPOINTS[r.api]);
      expect([url.username, url.password, url.hash]).toEqual(["", "", ""]);
      expect([...url.searchParams.keys()]).toEqual(QUERY[route]);
      const want = { latitude: String(p.lat), longitude: String(p.lon), [route]: VARIABLES.join(","), wind_speed_unit: "ms", timezone: "GMT", ...(date ? { start_date: date, end_date: date } : {}) };
      expect(Object.fromEntries(url.searchParams)).toEqual(want);
      expect(r).toMatchObject({ lat: p.lat, lon: p.lon, date: p.date, hour: p.hour, offset: p.offset, now: NOW });
    });

  it("the whitelist: the keys a route sends, and nothing else", () => {
    expect(QUERY).toEqual({
      current: ["latitude", "longitude", "current", "wind_speed_unit", "timezone"],
      hourly: ["latitude", "longitude", "hourly", "start_date", "end_date", "wind_speed_unit", "timezone"],
    });
    expect(VARIABLES).toEqual(Object.keys(UNITS));
  });

  // The URL is a function of the place and the time alone: every other field
  // of the weather, at both ends of its range or each option, leaves it as it was.
  it("no field but lat, lon, date, hour and offset reaches the URL", () => {
    for (const [p, base] of [
      [P({ date: "2026-11-16", hour: 14.75 }), requestFor(P({ date: "2026-11-16", hour: 14.75 }), NOW).url],
      [P({ date: "2025-07-15", hour: 15 }), requestFor(P({ date: "2025-07-15", hour: 15 }), NOW).url],
    ])
      for (const f of FIELDS.filter((f) => !["lat", "lon", "date", "hour", "offset"].includes(f.key)))
        for (const v of f.kind === "enum" ? f.options.map((o) => o.value) : f.kind === "integer" ? [-5, 0, 99] : [f.min, f.max])
          expect(requestFor({ ...p, [f.key]: v }, NOW).url).toBe(base);
  });

  it("null for a time nobody has weather for", () => {
    expect(requestFor(P({ date: "2026-12-25", hour: 12 }), NOW)).toBe(null);
    expect(requestFor(P({ date: "1939-06-01", hour: 12 }), NOW)).toBe(null);
  });
});

describe("fetchWeather: one GET of the URL, nothing else", () => {
  const request = { url: "https://api.open-meteo.com/v1/forecast?latitude=1" };
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => (typeof body === "string" ? JSON.parse(body) : body) });
  // [status, body] → returned JSON, or the error thrown
  const rows = [
    ["200 weather", 200, { current: {} }, { current: {} }],
    ["400 an error reply", 400, { error: true, reason: "out of range" }, { error: true, reason: "out of range" }],
    ["500 not an error reply", 500, { message: "down" }, new Error(`${NAME} answered 500`)],
    ["200 not JSON", 200, "<html>", new Error(`${NAME} answered 200, not with weather`)],
    ["502 not JSON", 502, "Bad gateway", new Error(`${NAME} answered 502, not with weather`)],
  ];
  for (const [name, status, body, want] of rows)
    it(name, async () => {
      const signal = new AbortController().signal;
      const fetch = vi.fn(async () => reply(status, body));
      if (want instanceof Error) await expect(fetchWeather(request, { fetch, signal })).rejects.toThrow(want.message);
      else expect(await fetchWeather(request, { fetch, signal })).toEqual(want);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]).toEqual([request.url, { signal, credentials: "omit", referrerPolicy: "no-referrer" }]);
    });

  it("a fetch that fails throws as it did", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchWeather(request, { fetch })).rejects.toThrow("Failed to fetch");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── the recorded replies ────────────────────────────────────────────────────

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

describe("snapshotFrom: the recorded replies as the fields they become", () => {
  // Every expected value worked from the reply's hour (printed beside it):
  // wind and from on their steps; gustiness = gust / wind - 1 on its step
  // (to 1); cover = cloud_cover on its step; the dominant layer and base
  // (LCL 125·(T - Td) under a low or no layer, 3000 under a mid one);
  // visibility as sent, else from humidity (20 km at 80% and under).
  const rows = [
    // T 10.1 Td 6.6 RH 79, code 3, cloud 87 (low 87), vis 18600, wind 1.8 from 74 gust 2.0; at 21:45 UTC = 14:45 PDT
    ["cadboro-current", { lat: 48.454, lon: -123.2915, date: "2026-11-16", hour: 14.75, offset: -7, wind: 1.8, from: 74, gustiness: 0.1, cover: 0.85, clouds: "stratocumulus", base: 450, visibility: 18600, rain: 0 }, "forecast", "2026-11-16T21:45:00.000Z"],
    // T 9.7 Td 5.6 RH 76, code 1, cloud 24 (low 22, mid 24), vis 20700, wind 6.93 from 119 gust 14.6
    ["ucluelet-forecast", { lat: 48.95, lon: -125.558, date: "2026-11-17", hour: 15, offset: -7, wind: 6.9, from: 119, gustiness: 1, cover: 0.25, clouds: "cumulus", base: 3000, visibility: 20700, rain: 0 }, "forecast", "2026-11-17T22:00:00.000Z"],
    // T 22.4 Td 15.8 RH 66, code 0, cloud 13 (low 11, mid 2), vis null (unit "undefined"), wind 3.59 from 289 gust 8.7; LCL 824.99… → 800
    ["ucluelet-archive", { lat: 48.95, lon: -125.558, date: "2025-07-15", hour: 15, offset: -7, wind: 3.6, from: 289, gustiness: 1, cover: 0.15, clouds: "cumulus", base: 800, visibility: 20000, rain: 0 }, "archive", "2025-07-15T22:00:00.000Z"],
    // GEM: T 9.8 Td 6.7 RH 81, code 0, cloud 18 (low 55), vis null, wind 5.2 from 110 gust 6.7; vis 20000·0.2^(1/20) = 18454 → 18500
    ["cadboro-gem", { lat: 48.454, lon: -123.2915, date: "2026-11-17", hour: 15, offset: -7, wind: 5.2, from: 110, gustiness: 0.3, cover: 0.2, clouds: "cumulus", base: 400, visibility: 18500, rain: 0 }, "forecast", "2026-11-17T22:00:00.000Z"],
    // all cloud 0: T 26 Td 12.7 RH 44, code 0, vis null, wind 1.93 from 111 gust 7.7; LCL 1662.5 → 1650
    ["cadboro-clear", { lat: 48.454, lon: -123.2915, date: "2025-07-01", hour: 15, offset: -7, wind: 1.9, from: 111, gustiness: 1, cover: 0, clouds: "cumulus", base: 1650, visibility: 20000, rain: 0 }, "archive", "2025-07-01T22:00:00.000Z"],
  ];
  for (const [name, fields, api, forIso] of rows)
    it(`${name} → ${JSON.stringify(fields)}`, () => {
      const { request, json } = fixture(name);
      const s = snapshotFrom(json, request);
      const { source, ...written } = s;
      expect(written).toEqual(fields);
      expect(Object.keys(written)).toEqual(SUMMED);
      expect(source).toEqual({ name: NAME, api, for: forIso, fetched: new Date(request.now).toISOString(), fields });
      expect(source.fields).not.toBe(written);
      // what it writes is already the weather in force, and reads "fetched"
      expect(fetchedFields(weatherParams(written))).toEqual(written);
      expect(provenance(s)).toBe("fetched");
      expect(dialledSince({ ...s, seed: 7 })).toEqual([]);
    });

  it("the error reply → its reason, thrown", () => {
    const { request, json } = fixture("error");
    expect(json.error).toBe(true);
    expect(() => snapshotFrom(json, request)).toThrow(json.reason);
  });

  it("every fixture on disk has a row", () => expect(readdirSync(FIXTURES).map((f) => f.replace(/\.json$/, "")).sort()).toEqual([...rows.map((r) => r[0]), "error"].sort()));

  it("the archive's visibility is null in a unit that isn't one, and GEM's null too", () => {
    const a = fixture("ucluelet-archive").json;
    expect(a.hourly_units.visibility).toBe("undefined");
    expect(a.hourly.visibility.every((v) => v === null)).toBe(true);
    expect(fixture("cadboro-gem").json.hourly.visibility.every((v) => v === null)).toBe(true);
  });
});

describe("snapshotFrom: what isn't weather for that hour", () => {
  const base = () => structuredClone(fixture("ucluelet-forecast"));
  const hourIndex = (f) => f.json.hourly.time.indexOf(isoMinute(f.request.at));
  const edit = (fn) => {
    const f = base();
    fn(f.json, hourIndex(f), f.request);
    return () => snapshotFrom(f.json, f.request);
  };
  // [name, edit] → the reason thrown
  const rows = [
    ["an error reply with no reason", (j) => Object.assign(j, { error: true }), `${NAME} refused the request`],
    ["an error reply with a reason", (j) => Object.assign(j, { error: true, reason: "Latitude must be in range of -90 to 90°" }), "Latitude must be in range of -90 to 90°"],
    ["another time zone", (j) => (j.utc_offset_seconds = -25200), `${NAME} answered in another time zone than GMT`],
    ["no utc offset", (j) => delete j.utc_offset_seconds, `${NAME} answered in another time zone than GMT`],
    ["no hourly block", (j) => delete j.hourly, `${NAME} sent no hourly weather`],
    ["not the hour asked for", (j, i) => (j.hourly.time[i] = "2026-11-17T22:30"), `${NAME} sent no weather for 2026-11-17T22:00 GMT`],
    ["no wind that hour", (j, i) => (j.hourly.wind_speed_10m[i] = null), `${NAME} has no wind for 2026-11-17T22:00 GMT`],
    ["no wind direction that hour", (j, i) => (j.hourly.wind_direction_10m[i] = null), `${NAME} has no wind for 2026-11-17T22:00 GMT`],
    ["wind in km/h", (j) => (j.hourly_units.wind_speed_10m = "km/h"), `${NAME} sent wind_speed_10m in km/h, not m/s`],
    ["gusts in km/h", (j) => (j.hourly_units.wind_gusts_10m = "km/h"), `${NAME} sent wind_gusts_10m in km/h, not m/s`],
    ["visibility in ft", (j) => (j.hourly_units.visibility = "ft"), `${NAME} sent visibility in ft, not m`],
  ];
  for (const [name, fn, reason] of rows) it(`${name} → "${reason}"`, () => expect(edit(fn)).toThrow(reason));

  it("a reply that isn't JSON's object", () => {
    const { request } = base();
    for (const j of [null, "weather", 7, []]) expect(() => snapshotFrom(j, request)).toThrow(`${NAME} sent nothing readable`);
  });

  it("present conditions for another time than now", () => {
    const f = structuredClone(fixture("cadboro-current"));
    f.json.current.time = "2026-11-16T23:00";
    expect(() => snapshotFrom(f.json, f.request)).toThrow(`${NAME}'s present conditions are for 2026-11-16T23:00 GMT, not now`);
    f.json.current.time = "21:45";
    expect(() => snapshotFrom(f.json, f.request)).toThrow(`${NAME} sent no time for the present conditions`);
  });
});

describe("snapshotFrom: each field from the hour's numbers", () => {
  // One hour, written as Open-Meteo's present conditions, with the values asked.
  const REQUEST = requestFor(weatherParams({ date: "2026-11-16", hour: 14.75 }), NOW);
  const reply = (values, interval = 900) => ({
    utc_offset_seconds: 0,
    current_units: { time: "iso8601", interval: "seconds", ...UNITS },
    current: { time: "2026-11-16T21:45", interval, ...Object.fromEntries(VARIABLES.map((k) => [k, null])), wind_speed_10m: 5, wind_direction_10m: 200, ...values },
  });
  const snap = (values, interval) => {
    const { source, ...f } = snapshotFrom(reply(values, interval), REQUEST);
    return f;
  };

  // [values sent, interval] → the fields that differ from the all-null hour's
  const ALL_NULL = { lat: DEFAULTS.lat, lon: DEFAULTS.lon, date: "2026-11-16", hour: 14.75, offset: -7, wind: 5, from: 200, gustiness: 0.3, cover: 0, clouds: "cumulus", base: BASES.low, visibility: 20000, rain: 0 };
  const rows = [
    ["everything else null", {}, 900, {}],
    ["wind 45 (clamped to 40)", { wind_speed_10m: 45 }, 900, { wind: 40 }],
    ["wind 0, a calm", { wind_speed_10m: 0, wind_gusts_10m: 3 }, 900, { wind: 0, gustiness: 0.3 }],
    ["wind from 359.6 → 360", { wind_direction_10m: 359.6 }, 900, { from: 360 }],
    ["gust 6.5 on 5", { wind_gusts_10m: 6.5 }, 900, { gustiness: 0.3 }],
    ["gust 12.5 on 5 (to 1)", { wind_gusts_10m: 12.5 }, 900, { gustiness: 1 }],
    ["0.5 mm in 15 min → 2 mm/h", { precipitation: 0.5 }, 900, { rain: 2 }],
    ["2 mm in an hour → 2 mm/h", { precipitation: 2 }, 3600, { rain: 2 }],
    ["20 mm in 15 min → 80 mm/h (clamped to 50)", { precipitation: 20 }, 900, { rain: 50 }],
    ["no interval: an hour's", { precipitation: 2 }, null, { rain: 2 }],
    ["cloud 87% → 0.85", { cloud_cover: 87 }, 900, { cover: 0.85 }],
    ["no total: the dominant layer's", { cloud_cover_mid: 70 }, 900, { cover: 0.7, clouds: "stratocumulus", base: BASES.mid }],
    ["high 90%: cirrus at 7000 m", { cloud_cover: 90, cloud_cover_high: 90 }, 900, { cover: 0.9, clouds: "cirrus", base: BASES.high }],
    ["T and Td: the LCL", { temperature_2m: 14, dew_point_2m: 6 }, 900, { base: 1000 }],
    ["visibility 90 km (clamped to 50)", { visibility: 90000 }, 900, { visibility: 50000 }],
    ["visibility 50 m (clamped to 100)", { visibility: 50 }, 900, { visibility: 100 }],
    ["visibility 0 (not a visibility: from humidity)", { visibility: 0 }, 900, {}],
    ["a low sheet at an LCL of 293.75 m: on the slider 300, so stratocumulus (the kind follows the base written)", { cloud_cover: 80, cloud_cover_low: 80, temperature_2m: 12.35, dew_point_2m: 10 }, 900, { cover: 0.8, clouds: "stratocumulus", base: 300 }],
    ["a low sheet at an LCL of 268.75 m: 250, stratus", { cloud_cover: 80, cloud_cover_low: 80, temperature_2m: 12.15, dew_point_2m: 10 }, 900, { cover: 0.8, clouds: "stratus", base: 250 }],
    ["fog, code 45, no visibility", { weather_code: 45, cloud_cover: 100, cloud_cover_low: 100, temperature_2m: 8, dew_point_2m: 8 }, 900, { cover: 1, clouds: "stratus", base: 100, visibility: CAPS.fog }],
  ];
  for (const [name, values, interval, want] of rows) it(`${name} → ${JSON.stringify(want)}`, () => expect(snap(values, interval)).toEqual({ ...ALL_NULL, ...want }));

  it("every field is on its slider and finite, over every row and the recorded replies", () => {
    const all = [...rows.map(([, v, i]) => snap(v, i)), ...["cadboro-current", "ucluelet-forecast", "ucluelet-archive", "cadboro-gem", "cadboro-clear"].map((n) => snapshotFrom(fixture(n).json, fixture(n).request))];
    for (const s of all)
      for (const f of FIELDS.filter((f) => f.kind === "number")) {
        expect(Number.isFinite(s[f.key])).toBe(true);
        expect(s[f.key]).toBeGreaterThanOrEqual(f.min);
        expect(s[f.key]).toBeLessThanOrEqual(f.max);
        if (!["lat", "lon", "hour", "offset"].includes(f.key)) expect(onStep(f.key, s[f.key])).toBe(s[f.key]);
      }
  });

  // Rain alone sees 9.4 km at 2 mm/h, 2.9 km at 10 and 26 km at 0.5
  // (atmosphere.js rainExtinction): under those, the air's visibility is what
  // is left; at or over, the air is as clear as the slider goes, and the
  // visibility in force is the rain's with it.
  it("rain observed through: the visibility in force is the observed one, where the rain alone sees further", () => {
    // within half a step: d(in force)/d(air) = (in force / air)² < 1, and the air's is rounded to 100 m
    for (const [vis, rain] of [
      [6000, 2],
      [2500, 10],
      [12000, 0.5],
    ]) {
      const s = snap({ visibility: vis, precipitation: rain / 4 });
      expect(s.rain).toBe(rain);
      expect(Math.abs(visibilityOf(s.visibility, s.rain) - vis)).toBeLessThanOrEqual(50);
    }
    const s = snap({ visibility: 10000, precipitation: 0.5 });
    expect(s.visibility).toBe(50000);
    expect(Math.round(visibilityOf(50000, 2))).toBe(7937);
  });
});

describe("the derivations' tables", () => {
  it.each([
    // [T - Td] → base under a low layer (125 m per degree, clamped 100..3000)
    [0, 100],
    [0.4, 100],
    [2, 250],
    [8, 1000],
    [23.9, 2987.5],
    [30, 3000],
  ])("LCL: T - Td %s → %s m", (spread, base) => expect(baseOf({ name: "low", cover: 0.5 }, 10 + spread, 10)).toBe(base));

  it.each([
    ["no layer, T and Td", null, 15, 7, 1000],
    ["a low layer, no dew point", { name: "low", cover: 0.5 }, 15, null, BASES.low],
    ["a low layer, no temperature", { name: "low", cover: 0.5 }, null, 7, BASES.low],
    ["a mid layer", { name: "mid", cover: 0.5 }, 15, 7, BASES.mid],
    ["a high layer", { name: "high", cover: 0.5 }, 15, 7, BASES.high],
  ])("base: %s → %s m", (_, layer, t, td, base) => expect(baseOf(layer, t, td)).toBe(base));

  it.each([
    [null, null, null, null],
    [0, 0, 0, null],
    [0.3, 0, 0, { name: "low", cover: 0.3 }],
    [0.3, 0.3, 0.3, { name: "low", cover: 0.3 }],
    [0.2, 0.3, 0.3, { name: "mid", cover: 0.3 }],
    [0.2, 0.3, 0.5, { name: "high", cover: 0.5 }],
    [null, 0.4, null, { name: "mid", cover: 0.4 }],
  ])("layerOf(%s, %s, %s) → %j", (low, mid, high, want) => expect(layerOf(low, mid, high)).toEqual(want));

  // The plan's codes × a fair-weather low layer of heaps at 800 m, at 70% humidity
  const heaps = { name: "low", cover: 0.3 };
  it.each([
    [0, "cumulus", 20000],
    [3, "cumulus", 20000],
    [45, "stratus", CAPS.fog],
    [61, "stratus", 20000],
    [95, "cumulus", 20000],
  ])("WMO %s → %s, visibility %s", (code, kind, vis) => {
    expect(kindOf(code, heaps, 800)).toBe(kind);
    expect(derivedVisibility(code, 70)).toBe(vis);
  });

  it("every code in a group says its kind, whatever the layers", () => {
    const want = { fog: "stratus", drizzle: "stratus", rain: "stratus", snow: "stratus", showers: "cumulus", thunder: "cumulus" };
    for (const [g, codes] of Object.entries(CODES))
      for (const code of codes) for (const layer of [null, heaps, { name: "high", cover: 1 }, { name: "low", cover: 1 }]) expect(kindOf(code, layer, 150)).toBe(want[g]);
    expect(Object.values(CODES).flat().length).toBe(new Set(Object.values(CODES).flat()).size);
  });

  it.each([
    ["no layer", null, 800, "cumulus"],
    ["high 0.9", { name: "high", cover: 0.9 }, 800, "cirrus"],
    ["high 0.2", { name: "high", cover: 0.2 }, 800, "cirrus"],
    ["mid 0.7 (a sheet)", { name: "mid", cover: 0.7 }, 3000, "stratocumulus"],
    ["mid 0.3 (heaps)", { name: "mid", cover: 0.3 }, 3000, "cumulus"],
    ["low 0.6 at 299 m", { name: "low", cover: 0.6 }, 299, "stratus"],
    ["low 0.6 at 300 m", { name: "low", cover: 0.6 }, 300, "stratocumulus"],
    ["low 0.59", { name: "low", cover: 0.59 }, 200, "cumulus"],
  ])("codes 0-3, %s → %s", (_, layer, base, kind) => {
    for (const code of [0, 1, 2, 3, null]) expect(kindOf(code, layer, base)).toBe(kind);
  });

  it.each([
    ["fog", 45, 50, CAPS.fog],
    ["snow", 73, 50, CAPS.snow],
    ["drizzle", 53, 50, CAPS.drizzle],
    ["drizzle in humid air", 53, 100, 4000],
    ["no humidity", 0, null, 20000],
    ["80%", 0, 80, 20000],
    ["90%", 0, 90, Math.sqrt(20000 * 4000)],
    ["100%", 0, 100, 4000],
    ["110% (as 100)", 0, 110, 4000],
  ])("derivedVisibility: %s → %s m", (_, code, rh, vis) => expect(derivedVisibility(code, rh)).toBeCloseTo(vis, 6));

  it.each([
    [10000, 0],
    [8000, 2],
    [2500, 10],
    [800, 25],
  ])("airVisibility(%s, %s mm/h): rain added back gives the observed", (vis, rain) => expect(visibilityOf(airVisibility(vis, rain), rain)).toBeCloseTo(vis, 6));

  it("airVisibility: rain that accounts for it all leaves the air clear (Infinity, on the slider 50 km)", () => {
    expect(airVisibility(8000, 20)).toBe(Infinity);
    expect(onStep("visibility", Infinity)).toBe(50000);
  });
});

describe("gustinessOf: a fetched hour's mean and peak → gustiness (Decision 10)", () => {
  // [mean, peak, gustiness]: the plan's gust factors 1.3, 2, 2.5 and a calm, then the rest
  it.each([
    [5, 6.5, 0.3],
    [5, 10, 1],
    [5, 12.5, 1],
    [0.3, 0.6, 0.3],
    [0, 0, 0.3],
    [0, 3, 0.3],
    [0.49, 2, 0.3],
    [0.5, 0.65, 0.3],
    [5, 5, 0],
    [5, 4, 0],
    [5, 20, 1],
    [4, 5.2, 0.3],
    [10, 13.1, 0.3],
    [10, 13.3, 0.35],
    [10, 17.4, 0.75],
    [5, undefined, 0.3],
    [5, null, 0.3],
    [5, NaN, 0.3],
    [undefined, 7, 0.3],
  ])("mean %s, peak %s → %s", (mean, peak, g) => expect(gustinessOf(mean, peak)).toBe(g));

  it("is always on the slider: a multiple of its step in 0..1", () => {
    const f = FIELDS.find((f) => f.key === "gustiness");
    for (const mean of [0.5, 1, 3, 7, 13])
      for (let peak = 0; peak <= 30; peak += 0.7) {
        const g = gustinessOf(mean, peak);
        expect(g).toBeGreaterThanOrEqual(f.min);
        expect(g).toBeLessThanOrEqual(f.max);
        expect(onStep("gustiness", g)).toBe(g);
      }
  });
});

describe("onStep: a value on its slider", () => {
  it.each([
    ["wind", 45, 40],
    ["wind", -1, 0],
    ["wind", 6.93, 6.9],
    ["wind", 0.05, 0.1],
    ["rain", 80, 50],
    ["rain", 0.04, 0],
    ["from", 359.6, 360],
    ["from", 0.4, 0],
    ["cover", 0.87, 0.85],
    ["cover", 0.875, 0.9],
    ["base", 437.5, 450],
    ["base", 10, 50],
    ["base", 1e6, 12000],
    ["visibility", 18649, 18600],
    ["visibility", 18650, 18700],
    ["visibility", 20, 100],
    ["gustiness", 0.333, 0.35],
  ])("%s %s → %s", (key, v, want) => expect(onStep(key, v)).toBe(want));

  it("is the identity on every step of every slider it is used on", () => {
    for (const key of ["wind", "from", "gustiness", "cover", "base", "visibility", "rain"]) {
      const f = FIELDS.find((x) => x.key === key);
      const n = Math.round((f.max - f.min) / f.step);
      for (let i = 0; i <= n; i++) {
        const v = Number((f.min + i * f.step).toFixed(6));
        expect(onStep(key, v)).toBe(v);
      }
    }
  });
});

// The fetch is never automatic: open-meteo.js's fetchWeather is the only
// place in the package's runtime that calls fetch (the extension's run
// calls fetchWeather, and extension.test.js shows nothing else does).
describe("the one fetch call", () => {
  it("is in fetchWeather, and nowhere else in the runtime", () => {
    const SRC = dirname(fileURLToPath(import.meta.url));
    const calls = readdirSync(SRC)
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
      .flatMap((f) => [...readFileSync(join(SRC, f), "utf8").matchAll(/(?<![\w])fetch\s*\(/g)].map(() => f));
    expect(calls).toEqual(["open-meteo.js"]);
    const text = readFileSync(join(SRC, "open-meteo.js"), "utf8");
    const body = text.slice(text.indexOf("export async function fetchWeather"), text.indexOf("// ─── the snapshot"));
    expect([...body.matchAll(/(?<![\w])fetch\s*\(/g)].length).toBe(1);
  });
});
