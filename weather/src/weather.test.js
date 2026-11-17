// The weather trait made whole (weatherParams) and the world's wind (windOf),
// over finite tables: every field × {absent, valid, each way it can be
// malformed, out of range}.
import { describe, expect, it } from "vitest";
import { plugins } from "./index.js";
import { DEFAULTS, FIELDS, PLACES, SUMMED, dialledSince, fetchedFields, placeOf, provenance, weatherParams, windOf } from "./weather.js";

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
    const t = { lat: 48.95, lon: -125.558, date: "2025-12-21", hour: 8.25, offset: -8, wind: 12, from: 300, gustiness: 0.5, seed: 7, cover: 1, clouds: "stratus", base: 300, visibility: 900, rain: 4 };
    expect(weatherParams(t)).toEqual(t);
    expect(Object.keys(weatherParams(t))).toEqual(FIELDS.map((f) => f.key));
  });

  it("source, and any key that isn't a field, is dropped", () => expect(weatherParams({ source: { name: "Open-Meteo" }, colour: "red" })).toEqual(DEFAULTS));

  // [field, value given, value in force]: each kind's malformed values, and every number at and past both ends of its range.
  const rows = [
    ["offset", 5.75, 5.75],
    ["offset", "-08:00", DEFAULTS.offset],
    ["offset", "America/Vancouver", DEFAULTS.offset],
    ["offset", "-8", DEFAULTS.offset],
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
    const inherited = Object.create({ wind: 9, clouds: "stratus", offset: 0 });
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

  // W5's table: the air as sailing's parts and templates write it ({ wind, from, seed }) and as it is dialled (gustiness).
  // sailing's sea-view.test.js runs the same 48 rows from the wind ambient into createWind, through its stand-in for this
  // offer (sailing/src/test/weather.js, a pass-through of the trait's numbers, which sailing always writes): together, the
  // wind a boat's physics reads is this offer.
  it("W5's table: every row's offer is the trait's own numbers, the gustiness its default where the trait has none", () => {
    const rows = [0, 7, 12].flatMap((wind) => [0, 90, 235, 300].flatMap((from) => [undefined, 0.5].flatMap((gustiness) => [1, 7].map((seed) => ({ wind, from, seed, ...(gustiness === undefined ? {} : { gustiness }) })))));
    expect(rows).toHaveLength(48);
    for (const t of rows) expect([t, windOf(weatherParams(t))]).toStrictEqual([t, { speed: t.wind, from: t.from, seed: t.seed, gustiness: t.gustiness ?? 0.3 }]);
  });

  it("names exactly sailing's four fields, plain numbers", () => {
    const w = windOf(weatherParams({}));
    expect(Object.keys(w).sort()).toEqual(["from", "gustiness", "seed", "speed"]);
    expect(JSON.parse(JSON.stringify(w))).toStrictEqual(w);
  });
});

describe("provenance: fetched, dialled since fetch, or dialled", () => {
  it("the summed fields are every field but seed, in order", () =>
    expect(SUMMED).toEqual(["lat", "lon", "date", "hour", "offset", "wind", "from", "gustiness", "cover", "clouds", "base", "visibility", "rain"]));

  it("what a fetch records is the summed fields in force, as a map", () =>
    expect(fetchedFields(DEFAULTS)).toStrictEqual({ lat: 48.454, lon: -123.2915, date: "2026-07-15", hour: 15, offset: -7, wind: 4, from: 235, gustiness: 0.3, cover: 0.35, clouds: "cumulus", base: 1200, visibility: 10000, rain: 0 }));

  /** A trait as a fetch writes it: its fields, and a source recording them in force. */
  const fetched = (t, fields = fetchedFields(weatherParams(t))) => ({ ...t, source: { name: "Open-Meteo", api: "forecast", for: "2026-07-15T22:00Z", fetched: "2026-07-15T22:03:00Z", fields } });
  const F = fetched({ ...DEFAULTS, wind: 6.2, from: 250, cover: 0.8, clouds: "stratocumulus", visibility: 24000 });
  const reversed = (o) => Object.fromEntries(Object.entries(o).reverse());

  // [name, trait] → provenance, and the fields dialled since the fetch
  const rows = [
    ["undefined", undefined, "dialled", null],
    ["no source", DEFAULTS, "dialled", null],
    ["a source that isn't a map", { ...DEFAULTS, source: "Open-Meteo" }, "dialled", null],
    ["a source that is an array", { ...DEFAULTS, source: [] }, "dialled", null],
    ["a source with no fields", { ...DEFAULTS, source: { name: "Open-Meteo" } }, "dialled", null],
    ["fields that aren't a map", { ...DEFAULTS, source: { fields: "[48.454]" } }, "dialled", null],
    ["fields that are an array", { ...DEFAULTS, source: { fields: [] } }, "dialled", null],
    ["an inherited source", Object.create({ source: F.source }), "dialled", null],
    ["inherited fields", { ...DEFAULTS, source: Object.create({ fields: F.source.fields }) }, "dialled", null],
    ["as fetched", F, "fetched", []],
    ["as fetched, the fields recorded in another order (a map: order means nothing)", fetched(F, reversed(F.source.fields)), "fetched", []],
    ["fetched with fields left out (their defaults in force)", fetched({ wind: 6 }), "fetched", []],
    ["fetched, a malformed field (its default in force, on both sides)", fetched({ wind: "6" }), "fetched", []],
    ["fetched, then the seed dialled", { ...F, seed: 7 }, "fetched", []],
    ["fetched, then a field written as the value in force", { ...F, rain: 0 }, "fetched", []],
    ["fetched, a key the source records that isn't summed", fetched(F, { ...F.source.fields, seed: 3, colour: "red" }), "fetched", []],
    ["a source recording other fields", { ...DEFAULTS, source: F.source }, "dialled since fetch", ["wind", "from", "cover", "clouds", "visibility"]],
    ["a source that records only some fields: the rest count as dialled", fetched(F, { wind: 6.2, from: 250 }), "dialled since fetch", SUMMED.filter((k) => k !== "wind" && k !== "from")],
    ["a recorded value of another type", fetched(F, { ...F.source.fields, wind: "6.2" }), "dialled since fetch", ["wind"]],
  ];
  for (const [name, trait, want, dialled] of rows)
    it(`${name} → ${want}`, () => {
      expect(provenance(trait)).toBe(want);
      expect(dialledSince(trait)).toEqual(dialled);
    });

  // Every summed field, dialled to another value it can hold, makes it "dialled since fetch", naming exactly it.
  const other = { lat: 48.95, lon: -125.558, date: "2026-07-16", hour: 15.25, offset: -8, wind: 6.3, from: 251, gustiness: 0.35, cover: 0.85, clouds: "stratus", base: 1250, visibility: 24100, rain: 0.1 };
  it("the table of other values covers every summed field", () => expect(Object.keys(other)).toEqual([...SUMMED]));
  for (const k of SUMMED)
    it(`fetched, then ${k} dialled → dialled since fetch: [${k}]`, () => {
      expect(provenance({ ...F, [k]: other[k] })).toBe("dialled since fetch");
      expect(dialledSince({ ...F, [k]: other[k] })).toEqual([k]);
    });
  it("two fields dialled are named in field order", () => expect(dialledSince({ ...F, rain: 1, hour: 9 })).toEqual(["hour", "rain"]));
});

describe("placeOf: the place the weather is at, by its coordinates", () => {
  it.each([
    [{}, "Cadboro Bay"],
    [{ lat: 48.95, lon: -125.558 }, "Ucluelet"],
    [{ lat: 48.95, lon: -125.558, offset: 0 }, "Ucluelet"],
    [{ lat: 48.4541 }, null],
    [{ lon: -125.558 }, null],
  ])("%j → %s", (t, want) => expect(placeOf(weatherParams(t))?.name ?? null).toBe(want));

  it("every place is on the sliders (its lat, lon and clock are params as they are)", () => {
    for (const { name, ...q } of PLACES) expect(weatherParams(q)).toEqual({ ...DEFAULTS, ...q });
  });
});
