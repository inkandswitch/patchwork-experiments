// The weather trait made whole (weatherParams) and the world's wind (windOf),
// over finite tables: every field × {absent, valid, each way it can be
// malformed, out of range}.
import { describe, expect, it } from "vitest";
import { plugins } from "./index.js";
import { DEFAULTS, FIELDS, weatherParams, windOf } from "./weather.js";

const INIT = plugins[0].describes.weather.init;

describe("weatherParams: every field in force", () => {
  it("the defaults are index.js's init, field for field", () => expect(DEFAULTS).toEqual(INIT));

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["{}", {}],
    ["a number", 7],
    ["a string", "weather"],
    ["an array", []],
  ])("a trait that is %s gives exactly the defaults", (_, t) => expect(weatherParams(t)).toEqual(DEFAULTS));

  it("a whole valid trait comes back as it is, its keys the fields' in order", () => {
    const t = { place: "Ucluelet", lat: 48.95, lon: -125.558, zone: "America/Vancouver", date: "2025-12-21", hour: 8.25, wind: 12, from: 300, gustiness: 0.5, seed: 7, cover: 1, clouds: "stratus", base: 300, visibility: 900, rain: 4 };
    expect(weatherParams(t)).toEqual(t);
    expect(Object.keys(weatherParams(t))).toEqual(FIELDS.map((f) => f.key));
  });

  it("source, and any key that isn't a field, is dropped", () => expect(weatherParams({ source: { name: "Open-Meteo" }, colour: "red" })).toEqual(DEFAULTS));

  // [field, value given, value in force]: each kind's malformed values, and every number at and past both ends of its range.
  const rows = [
    ["place", "Ucluelet", "Ucluelet"],
    ["place", "", ""],
    ["place", 7, DEFAULTS.place],
    ["place", null, DEFAULTS.place],
    ["zone", "UTC", "UTC"],
    ["zone", "Asia/Kolkata", "Asia/Kolkata"],
    ["zone", "Mars/Olympus_Mons", DEFAULTS.zone],
    ["zone", "+05:30", DEFAULTS.zone],
    ["zone", "-08:00", DEFAULTS.zone],
    ["zone", "", DEFAULTS.zone],
    ["zone", 5, DEFAULTS.zone],
    ["date", "2024-02-29", "2024-02-29"],
    ["date", "2026-02-29", DEFAULTS.date],
    ["date", "2026-02-30", DEFAULTS.date],
    ["date", "15/07/2026", DEFAULTS.date],
    ["date", "2026-7-15", DEFAULTS.date],
    ["date", "", DEFAULTS.date],
    ["date", 20260715, DEFAULTS.date],
    ["clouds", "cirrus", "cirrus"],
    ["clouds", "nimbus", DEFAULTS.clouds],
    ["clouds", "Cumulus", DEFAULTS.clouds],
    ["clouds", 1, DEFAULTS.clouds],
    ["seed", 42, 42],
    ["seed", -3, -3],
    ["seed", 0, 0],
    ["seed", -0, 0],
    ["seed", 1.5, DEFAULTS.seed],
    ["seed", "7", DEFAULTS.seed],
    ["seed", 2 ** 60, DEFAULTS.seed],
    ["wind", "7", DEFAULTS.wind],
    ["wind", "", DEFAULTS.wind],
    ["wind", [7], DEFAULTS.wind],
    ["wind", null, DEFAULTS.wind],
    ["wind", true, DEFAULTS.wind],
    ["wind", Infinity, DEFAULTS.wind],
    ["wind", NaN, DEFAULTS.wind],
    ["wind", -0, 0],
  ];
  for (const f of FIELDS.filter((f) => f.kind === "number"))
    rows.push([f.key, f.min, f.min], [f.key, f.max, f.max], [f.key, f.min - 1, f.min], [f.key, f.max + 1, f.max], [f.key, (f.min + f.max) / 2, (f.min + f.max) / 2]);

  for (const [key, given, want] of rows)
    it(`${key}: ${JSON.stringify(given) ?? String(given)} → ${JSON.stringify(want)}`, () => {
      const p = weatherParams({ [key]: given });
      expect(Object.is(p[key], want)).toBe(true);
      expect({ ...p, [key]: DEFAULTS[key] }).toEqual(DEFAULTS); // field by field: no other field moved
    });

  it("reads only the trait's own fields, never an inherited one", () => {
    const inherited = Object.create({ wind: 9, clouds: "stratus", zone: "UTC" });
    inherited.cover = 0.8;
    expect(weatherParams(inherited)).toEqual({ ...DEFAULTS, cover: 0.8 });
  });

  it("is idempotent: params are a trait that gives themselves", () => {
    for (const [key, given] of rows) {
      const p = weatherParams({ [key]: given });
      expect(weatherParams(p)).toEqual(p);
    }
  });
});

describe("windOf: the world's wind is the trait's own numbers", () => {
  it.each([
    [{}, { speed: 4, from: 235, seed: 1, gustiness: 0.3 }],
    [{ wind: 0 }, { speed: 0, from: 235, seed: 1, gustiness: 0.3 }],
    [{ wind: 12, from: 300, gustiness: 0.5, seed: 7 }, { speed: 12, from: 300, seed: 7, gustiness: 0.5 }],
    [{ wind: 7, from: 0, gustiness: 0, seed: -1 }, { speed: 7, from: 0, seed: -1, gustiness: 0 }],
    [{ wind: 45, from: 400, gustiness: 2 }, { speed: 40, from: 360, seed: 1, gustiness: 1 }],
  ])("%j → %j", (t, want) => expect(windOf(weatherParams(t))).toStrictEqual(want));

  it("names exactly sailing's four fields, plain numbers", () => {
    const w = windOf(weatherParams({}));
    expect(Object.keys(w).sort()).toEqual(["from", "gustiness", "seed", "speed"]);
    expect(JSON.parse(JSON.stringify(w))).toStrictEqual(w);
  });
});
