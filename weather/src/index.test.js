// The plugin metadata (index.js): one scene extension on one scene trait whose
// fields are the weather's data shape (WEATHER.md, "The data"), every number a
// bounded slider, and the entry a worker can evaluate. Finite tables: every
// field, every trait case.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { plugins } from "./index.js";

/** The data shape, in WEATHER.md's order: where, when, the air, the sky. */
const FIELDS = ["place", "lat", "lon", "zone", "date", "hour", "wind", "from", "gust", "seed", "cover", "clouds", "base", "visibility", "rain"];
/** Fields with no default: a missing gust is "30% over the wind", which no fixed number says. */
const NO_DEFAULT = new Set(["gust"]);

describe("the weather plugin", () => {
  it("is exactly one scene extension, `weather`, on the scene trait `weather`", () => {
    expect(plugins.map((p) => [p.type, p.id, p.traits])).toEqual([["scene:extension", "weather", ["weather"]]]);
    expect(Object.keys(plugins[0].describes)).toEqual(["weather"]);
    expect(plugins[0].describes.weather.on).toBe("scene");
  });

  it("survives structuredClone but for load()", () => {
    const meta = plugins.map(({ load, ...p }) => p);
    expect(structuredClone(meta)).toEqual(meta);
  });

  it("the entry imports nothing statically: its one specifier is its own lazy load", () => {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.js"), "utf8");
    expect([...text.matchAll(/\bimport\b\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1])).toEqual(["./extension.js"]);
    expect(/^\s*import\s/m.test(text)).toBe(false);
  });
});

describe("the weather trait's fields", () => {
  const d = plugins[0].describes.weather;
  const byKey = Object.fromEntries(d.fields.map((f) => [f.key, f]));

  it("are the data shape, in order, once each", () => expect(d.fields.map((f) => f.key)).toEqual(FIELDS));
  it("init is the defaults: every described field but gust, nothing undescribed", () => expect(Object.keys(d.init)).toEqual(FIELDS.filter((k) => !NO_DEFAULT.has(k))));

  for (const key of FIELDS) {
    const f = byKey[key];
    it(`${key}: init equals its default${NO_DEFAULT.has(key) ? " (none)" : ""}`, () => expect(d.init[key]).toEqual(f.default));
    if (f.kind === "number")
      it(`${key}: a bounded slider, its default inside`, () => {
        expect(f.min).toBeLessThan(f.max);
        if (f.default !== undefined) {
          expect(f.default).toBeGreaterThanOrEqual(f.min);
          expect(f.default).toBeLessThanOrEqual(f.max);
        }
        if (f.log) expect(f.min).toBeGreaterThan(0);
      });
    if (f.kind === "enum") it(`${key}: its default is an option`, () => expect(f.options.map((o) => o.value)).toContain(f.default));
  }

  it("the sun slider steps a quarter hour over the whole day", () => expect([byKey.hour.min, byKey.hour.max, byKey.hour.step]).toEqual([0, 24, 0.25]));
  it("the cloud kinds are the four the sky model knows", () => expect(byKey.clouds.options.map((o) => o.value)).toEqual(["cumulus", "stratocumulus", "stratus", "cirrus"]));
  it("starts at Cadboro Bay, 15:00 on 15 July, Vancouver time", () =>
    expect([d.init.place, d.init.lat, d.init.lon, d.init.zone, d.init.date, d.init.hour]).toEqual(["Cadboro Bay", 48.454, -123.2915, "America/Vancouver", "2026-07-15", 15]));
});

describe("the extension (the scaffold)", () => {
  const api = (traits) => ({ doc: () => ({ traits: traits === undefined ? {} : { weather: traits } }) });
  const cases = { absent: undefined, empty: {}, full: plugins[0].describes.weather.init };
  for (const [name, trait] of Object.entries(cases))
    it(`offers nothing yet: trait ${name}`, async () => {
      const ext = await plugins[0].load();
      expect(ext.create(api(trait)).ambient()).toBe(null);
    });
});
