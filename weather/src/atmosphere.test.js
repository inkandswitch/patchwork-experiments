// The look from the weather (atmosphere.js; WEATHER.md, "The look"), over
// finite tables:
//   - the four anchors reproduce the art direction they were, exactly, at
//     their conditions (the old values are written out here, not read from
//     LOOKS);
//   - every output, over a grid of every kind, cover, visibility, rain and
//     hour, is one the stage's own check passes unchanged (a copy of
//     cleanAtmosphere, as water copies cloudAt), and pure JSON;
//   - the model between its anchors: rows whose expected values are
//     computed here from the anchors, by the rule WEATHER.md states (linear
//     RGB midpoints and quarters along cover and haze, cirrus as a thinner
//     cumulus), and the bands checked cell by cell against WEATHER.md's
//     table;
//   - exposure never rises as the sun sinks; the colours don't jump at a
//     band's edge, a cover node or the haze's ends; the sun gives light iff
//     it is up; shadows, haze, rain and the deck by their rules;
//   - the deck as the stage draws it (a copy of its cloudAt and its noise):
//     no jump anywhere along cover or haze.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { plugins } from "./index.js";
import { BANDS, KINDS, LOOKS, SCATTERED_MAX, atmosphereAt, atmosphereOf, bandAt, conditionsOf, dayLook, deckOf, hazeOf, skyAt, sunOf, toHex, toLinear, toSrgb, wetOf } from "./atmosphere.js";
import { sunDirection } from "./solar.js";
import { weatherParams } from "./weather.js";

// ─── the stage's check, copied (scene/src/stage/viewport.js, cleanAtmosphere, at e74b9ef7) ───
const LIGHTS = Object.freeze({ key: 1.5, keyFrom: [0.45, 1, 0.6] });
const CLOUDS = Object.freeze({ contrast: 0.1, scale: 600, base: 800 });
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function hexColour(v) {
  if (typeof v === "string" && HEX.test(v.trim())) return v.trim().toLowerCase();
  if (Number.isInteger(v) && v >= 0 && v <= 0xffffff) return `#${v.toString(16).padStart(6, "0")}`;
  return null;
}
const finite = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
function cleanAtmosphere(a) {
  if (!a || typeof a !== "object") return null;
  const out = {};
  if (a.sky && typeof a.sky === "object") {
    const t = hexColour(a.sky.top), h = hexColour(a.sky.horizon), b = hexColour(a.sky.bottom);
    const horizon = h ?? t ?? b;
    if (horizon) out.sky = { top: t ?? horizon, horizon, bottom: b ?? horizon };
  }
  if (a.fog && typeof a.fog === "object") {
    const color = hexColour(a.fog.color) ?? out.sky?.horizon ?? null;
    const near = Math.max(0, finite(a.fog.near) ?? 0);
    const far = finite(a.fog.far);
    if (color && far != null && far > near) out.fog = { color, near, far };
  }
  if (a.sun && typeof a.sun === "object") {
    const d = Array.isArray(a.sun.direction) ? a.sun.direction.slice(0, 3).map(finite) : [];
    const len = d.length === 3 && d.every((v) => v != null) ? Math.hypot(d[0], d[1], d[2]) : 0;
    const from = len > 1e-9 ? d : LIGHTS.keyFrom;
    const n = Math.hypot(from[0], from[1], from[2]);
    const intensity = finite(a.sun.intensity);
    out.sun = { direction: from.map((v) => v / n), color: hexColour(a.sun.color) ?? "#ffffff", intensity: intensity != null && intensity >= 0 ? intensity : LIGHTS.key, shadows: a.sun.shadows === true };
  }
  const exposure = finite(a.exposure);
  if (exposure != null && exposure > 0) out.exposure = exposure;
  if (out.sky && a.clouds && typeof a.clouds === "object") {
    const cover = finite(a.clouds.cover), contrast = finite(a.clouds.contrast) ?? CLOUDS.contrast, scale = finite(a.clouds.scale) ?? CLOUDS.scale, base = finite(a.clouds.base) ?? CLOUDS.base;
    if (cover != null && cover > 0 && contrast > 0 && scale > 0 && base > 0) out.clouds = { cover: Math.min(1, cover), contrast: Math.min(0.5, contrast), scale, base };
  }
  return Object.keys(out).length ? out : null;
}
// ─────────────────────────────────────────────────────────────────────────────

const params = (t) => weatherParams(t);
const KIND_NAMES = Object.keys(KINDS);
/** The largest channel difference between two linear colours. */
const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const COLOURS = ["top", "horizon", "bottom", "sun"];

describe("colour: sRGB hex ↔ linear RGB", () => {
  it("every byte, in every channel, comes back as itself", () => {
    for (let b = 0; b < 256; b++)
      for (const at of [0, 2, 4]) {
        const hex = `#${"0000".slice(0, at)}${b.toString(16).padStart(2, "0")}${"0000".slice(at)}`;
        expect(toHex(toLinear(hex))).toBe(hex);
      }
  });
  it.each([
    ["#000000", [0, 0, 0]],
    ["#ffffff", [1, 1, 1]],
    ["#808080", [0.21586050011389926, 0.21586050011389926, 0.21586050011389926]],
  ])("%s is %j", (hex, lin) => lin.forEach((v, i) => expect(toLinear(hex)[i]).toBeCloseTo(v, 12)));
  it("clamps out-of-gamut values", () => expect(toHex([-0.2, 1.7, 0.5])).toBe("#00ffbc"));
});

describe("the anchors: the art direction they were, exactly, at their conditions", () => {
  // The old values, written out: sailing/src/weather.js ATMOSPHERE and terrain/src/ucluelet.js SKIES
  // (scene-stage 3b331feb). Only Ukee grey's fog far moves, 17 000 → 17 100 (Decision 9), and every sun's direction.
  const BRIGHT = { sky: { top: "#2f6db5", horizon: "#cfe2ee", bottom: "#a9c6d8" }, fog: { color: "#cfe2ee", near: 300, far: 9000 }, sun: { color: "#fff3df", intensity: 2.2, shadows: true }, exposure: 1, clouds: { cover: 0.35, contrast: 0.25, scale: 700, base: 1200 } };
  const CLEAR = { sky: { top: "#5b86b0", horizon: "#d5e0e4", bottom: "#a9bcc4" }, fog: { color: "#d5e0e4", near: 800, far: 18000 }, sun: { color: "#fff4e2", intensity: 2.2, shadows: true }, exposure: 1 };
  const GREY = { sky: { top: "#c4cacc", horizon: "#959ea1", bottom: "#7a8487" }, fog: { color: "#959ea1", near: 900, far: 17100 }, sun: { color: "#eef0f0", intensity: 1.1, shadows: false }, exposure: 1.05, clouds: { cover: 1, contrast: 0.12, scale: 500, base: 600 } };
  const MARINE = { sky: { top: "#bfc6c7", horizon: "#c9cfcf", bottom: "#b4bbbb" }, fog: { color: "#c9cfcf", near: 30, far: 900 }, sun: { color: "#f2f3f2", intensity: 0.6, shadows: false }, exposure: 1 };

  // [name, the weather (over the default: Cadboro Bay, 2026-07-15 15:00 PDT, the sun 56° up), the look]
  const rows = [
    ["bright day (the default)", {}, BRIGHT],
    ["clear afternoon", { cover: 0, visibility: 20000 }, CLEAR],
    ...KIND_NAMES.map((k) => [`clear afternoon, ${k}, base 9000`, { cover: 0, clouds: k, base: 9000, visibility: 20000 }, CLEAR]),
    ["Ukee grey", { cover: 1, clouds: "stratocumulus", base: 600, visibility: 19000 }, GREY],
    ["Ukee grey's sky under stratus (its own deck)", { cover: 1, clouds: "stratus", base: 600, visibility: 19000 }, { ...GREY, clouds: { cover: 1, contrast: 0.05, scale: 1500, base: 600 } }],
    ["marine layer", { visibility: 1000 }, MARINE],
    ...KIND_NAMES.flatMap((k) => [0, 0.35, 1].map((cover) => [`marine layer, ${k} at cover ${cover}`, { cover, clouds: k, visibility: 1000 }, MARINE])),
    ["the marine layer, at Ucluelet", { lat: 48.95, lon: -125.558, visibility: 1000, wind: 5, from: 300 }, MARINE],
  ];
  for (const [name, t, want] of rows)
    it(name, () => {
      const p = params(t);
      const a = atmosphereOf(p);
      const sun = sunOf(p);
      expect(sun.geometric).toBeGreaterThan(20);
      expect(a).toStrictEqual({ ...want, sun: { direction: sunDirection(sun.azimuth, sun.apparent), ...want.sun } });
    });

  it("the four looks are the four anchors' (LOOKS is the table above)", () => {
    for (const [k, w] of [["bright", BRIGHT], ["clear", CLEAR], ["grey", GREY], ["fog", MARINE]]) {
      expect(LOOKS[k].sky).toEqual(w.sky);
      expect(LOOKS[k].sun).toEqual({ color: w.sun.color, intensity: w.sun.intensity });
      expect(LOOKS[k].exposure).toBe(w.exposure);
      expect(Math.round(LOOKS[k].near * w.fog.far)).toBe(w.fog.near);
    }
  });

  // The places' own weathers, as terrain's templates write them (terrain/src/template.test.js and
  // template-ucluelet.test.js pin the same literals; its publishers check the page's atmosphere against them):
  // each place shows the look it had, exactly. Ucluelet's old sun was hand-set for this very moment, 15:00 PDT on
  // 15 July: the computed one is within a degree of it (0.41°). Cadboro's was sailing's, set for no moment (from the
  // north-east, [0.55, 0.7, -0.45]): it moves to the south-west, where the sun is.
  const UCLUELET = { lat: 48.95, lon: -125.558, date: "2026-07-15", hour: 15, offset: -7, wind: 5, from: 300, seed: 7 };
  const UKEE_SUN = [-0.36, 0.84, 0.4];
  const degreesBetween = (a, b) => (Math.acos(Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0) / Math.hypot(...a) / Math.hypot(...b))) * 180) / Math.PI;
  it.each([
    ["Ucluelet under Ukee grey (its template's default sky)", { ...UCLUELET, cover: 1, clouds: "stratocumulus", base: 600, visibility: 19000 }, GREY],
    ["Ucluelet under its marine layer", { ...UCLUELET, cover: 1, clouds: "stratus", base: 100, visibility: 1000 }, MARINE],
    ["Ucluelet on a clear afternoon", { ...UCLUELET, cover: 0, clouds: "cumulus", base: 1200, visibility: 20000 }, CLEAR],
  ])("%s: its old look exactly, the sun within 1° of the one hand-set for the moment", (_, t, want) => {
    const a = atmosphereOf(params(t));
    expect({ ...a, sun: { ...a.sun, direction: null } }).toStrictEqual({ ...want, sun: { direction: null, ...want.sun } });
    expect(degreesBetween(a.sun.direction, UKEE_SUN)).toBeLessThan(1);
  });
  it("Cadboro Bay on its fair afternoon (its template's): the bright day exactly, the sun in the south-west", () => {
    const t = { lat: 48.454, lon: -123.2915, date: "2026-07-15", hour: 15, offset: -7, wind: 4, from: 235, seed: 7, cover: 0.35, clouds: "cumulus", base: 1200, visibility: 10000 };
    const a = atmosphereOf(params(t));
    expect({ ...a, sun: { ...a.sun, direction: null } }).toStrictEqual({ ...BRIGHT, sun: { direction: null, ...BRIGHT.sun } });
    // east +X, north -Z: sailing's old sun stood in the north-east, the real one in the south-west
    const [x, , z] = a.sun.direction;
    expect([Math.sign(x), Math.sign(z)]).toEqual([-1, 1]);
  });
  it("Ucluelet's computed sun at its template's moment: azimuth 221.71°, apparent elevation 56.98° (the old comment's 222° and 57°)", () => {
    const sun = sunOf(params(UCLUELET));
    expect(sun.azimuth).toBeCloseTo(221.71, 1);
    expect(sun.apparent).toBeCloseTo(56.98, 1);
  });
});

// Between the anchors. Each expected value is computed here, from the anchors' hex and the rule WEATHER.md states
// ("The look"): the look interpolated linearly, in linear RGB, along effective cover between the nodes and along the
// haze weight toward the marine layer; numbers (intensity, exposure, fog near's ratio) linearly. The sun is 56° up, so
// the bands are the identity. Midpoints and quarter points both: a smoothstep or an h² agrees with the line at a
// midpoint and an end, never at a quarter.
const HERE = dirname(fileURLToPath(import.meta.url));
const mixHex = (a, b, t) => toHex(toLinear(a).map((v, i) => v * (1 - t) + toLinear(b)[i] * t));
const mixNum = (a, b, t) => a * (1 - t) + b * t;
/** The look t of the way from anchor `a` to `b` (LOOKS' keys) at fog far `far`: sky, fog, sun colour and intensity, exposure. */
function between(a, b, t, far) {
  const [A, B] = [LOOKS[a], LOOKS[b]];
  const sky = Object.fromEntries(["top", "horizon", "bottom"].map((k) => [k, mixHex(A.sky[k], B.sky[k], t)]));
  return { sky, fog: { color: sky.horizon, near: Math.round(mixNum(A.near, B.near, t) * far), far }, sun: { color: mixHex(A.sun.color, B.sun.color, t), intensity: mixNum(A.sun.intensity, B.sun.intensity, t) }, exposure: mixNum(A.exposure, B.exposure, t) };
}
const lookOf = (a) => ({ sky: a.sky, fog: a.fog, sun: { color: a.sun.color, intensity: a.sun.intensity }, exposure: a.exposure });
const closeLook = (got, want) => {
  expect({ ...got, sun: { ...got.sun, intensity: 0 }, exposure: 0 }).toStrictEqual({ ...want, sun: { ...want.sun, intensity: 0 }, exposure: 0 });
  expect(got.sun.intensity).toBeCloseTo(want.sun.intensity, 12);
  expect(got.exposure).toBeCloseTo(want.exposure, 12);
};

describe("between the anchors: the rule WEATHER.md states, computed independently", () => {
  // [name, the weather, from, to, t, fog far]
  it.each([
    ["cumulus at cover 0.0875: a quarter of the way from the clear afternoon to the bright day", { cover: 0.0875 }, "clear", "bright", 0.25, 9000],
    ["cumulus at cover 0.175: halfway from the clear afternoon to the bright day", { cover: 0.175 }, "clear", "bright", 0.5, 9000],
    ["cumulus at cover 0.5125: a quarter of the way from the bright day to Ukee grey", { cover: 0.5125 }, "bright", "grey", 0.25, 9000],
    ["cumulus at cover 0.675: halfway from the bright day to Ukee grey", { cover: 0.675 }, "bright", "grey", 0.5, 9000],
    ["stratus at cover 0.675: the same look (opacity 1)", { cover: 0.675, clouds: "stratus" }, "bright", "grey", 0.5, 9000],
    ["cirrus at cover 1: effective cover 0.3, six sevenths of the way from the clear afternoon to the bright day", { cover: 1, clouds: "cirrus" }, "clear", "bright", 0.3 / 0.35, 9000],
    ["the bright day at visibility 10^3.75 m (h = 0.25): a quarter of the way into the marine layer", { visibility: 10 ** 3.75 }, "bright", "fog", 0.25, Math.round(0.9 * 10 ** 3.75)],
    ["the bright day at visibility 10^3.5 m (h = 0.5): halfway into the marine layer", { visibility: 10 ** 3.5 }, "bright", "fog", 0.5, Math.round(0.9 * 10 ** 3.5)],
    ["Ukee grey at visibility 10^3.5 m: halfway from it into the marine layer", { cover: 1, clouds: "stratocumulus", visibility: 10 ** 3.5 }, "grey", "fog", 0.5, Math.round(0.9 * 10 ** 3.5)],
  ])("%s", (_, t, a, b, f, far) => closeLook(lookOf(atmosphereOf(params(t))), between(a, b, f, far)));

  it("cumulus at cover 0.675: intensity 1.65, exposure 1.025, shadows (effective cover under 0.75)", () => {
    const a = atmosphereOf(params({ cover: 0.675 }));
    expect(a.sun.intensity).toBeCloseTo(1.65, 12);
    expect(a.exposure).toBeCloseTo(1.025, 12);
    expect(a.sun.shadows).toBe(true);
  });

  it("cirrus at cover 1 is cumulus at cover 0.3 in everything but its deck (opacity 0.3)", () => {
    const [ci, cu] = [atmosphereOf(params({ cover: 1, clouds: "cirrus" })), atmosphereOf(params({ cover: 0.3 }))];
    expect({ ...ci, clouds: null }).toStrictEqual({ ...cu, clouds: null });
  });

  // At s = 1 (a full overcast, or a fog) every tint is tempered to white, the sun's too: whatever the band, the sun's
  // colour is the day's times one gain, so an overcast sunset's sun dims and never turns orange.
  it("at s = 1 the sun's channels scale alike at every node and between", () => {
    for (const t of [{ cover: 1, clouds: "stratus" }, { cover: 1, clouds: "stratocumulus" }, { cover: 0, visibility: 1000 }]) {
      const c = conditionsOf(params(t));
      expect(c.s).toBe(1);
      const day = skyAt(c, 45).sun;
      for (const e of [...BANDS.map((b) => b.at), 13, 3, 0.5, -0.4, -3, -9, -20]) {
        const r = skyAt(c, e).sun.map((v, i) => v / day[i]);
        for (const x of r) expect(x).toBeCloseTo(r[0], 12);
        expect(r[0]).toBeCloseTo(bandAt(e).disc, 12);
      }
    }
  });
});

describe("the bands are WEATHER.md's table, cell by cell", () => {
  /** WEATHER.md's bands table (under "The look"), each row as a band: the doc is the spec BANDS is checked against. */
  function docBands(md) {
    const lines = md.split("\n").map((l) => l.trim());
    const start = lines.findIndex((l) => l.startsWith("| Band |"));
    const head = lines[start].split("|").slice(1, -1).map((c) => c.trim());
    expect(head).toEqual(["Band", "Geometric", "Top", "Horizon", "Bottom", "Sun tint", "`disc`", "`light`", "Exposure", "Key light"]);
    const rows = [];
    for (let i = start + 2; lines[i]?.startsWith("|"); i++) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
    const nums = (c) => c.replace(/[()]/g, "").split(",").map(Number);
    const tint = (c) => (c === "1" ? [1, 1, 1] : nums(c));
    const gain = (c) => (c === "1" ? [1, [1, 1, 1]] : [Number(c.split("×")[0]), nums(c.split("×")[1])]);
    return rows.map((r) => ({ at: parseFloat(r[1]), name: r[0], top: gain(r[2]), horizon: gain(r[3]), bottom: gain(r[4]), sun: tint(r[5]), disc: Number(r[6]), light: Number(r[7]), exposure: Number(r[8]), key: Number(r[9]) }));
  }
  const rows = docBands(readFileSync(join(HERE, "..", "WEATHER.md"), "utf8"));

  it("has a row for every band, in order", () => expect(rows.map((r) => [r.name, r.at])).toEqual(BANDS.map((b) => [b.name, b.at])));
  for (const r of rows)
    it(`${r.name}: every cell is BANDS', and the key light column is disc · light · exposure`, () => {
      const { key, ...band } = r;
      expect(BANDS.find((b) => b.name === r.name)).toStrictEqual(band);
      expect(key).toBeCloseTo(r.disc * r.light * r.exposure, 3);
    });

  it("bandAt has one shape everywhere: the nodes' values at a node, linear between, held beyond", () => {
    const keys = ["top", "horizon", "bottom", "sun", "disc", "light", "exposure"];
    const pick = (b) => Object.fromEntries(keys.map((k) => [k, b[k]]));
    for (const e of [90, 20, 13, 6, 0, -0.833, -3, -6, -12, -40]) expect(Object.keys(bandAt(e))).toEqual(keys);
    for (const b of BANDS) expect(bandAt(b.at)).toStrictEqual(pick(b));
    expect(bandAt(90)).toStrictEqual(pick(BANDS[0]));
    expect(bandAt(-40)).toStrictEqual(pick(BANDS.at(-1)));
    const mid = bandAt(13);
    expect(mid.exposure).toBeCloseTo((BANDS[0].exposure + BANDS[1].exposure) / 2, 12);
    expect(mid.top[1][2]).toBeCloseTo((BANDS[0].top[1][2] + BANDS[1].top[1][2]) / 2, 12);
  });
});

// The grid: every kind × cover × visibility × rain, at hours through two days (a summer day at Cadboro Bay and a
// winter one at Ucluelet), so every band of the sun and the night are crossed.
const GRID = [];
for (const [place, date] of [[{ lat: 48.454, lon: -123.2915 }, "2026-07-15"], [{ lat: 48.95, lon: -125.558 }, "2026-12-21"]])
  for (const clouds of KIND_NAMES)
    for (const cover of [0, 0.35, 0.5, 1])
      for (const visibility of [100, 1000, 3000, 10000, 50000])
        for (const rain of [0, 2.5, 50]) for (const hour of [0, 4, 5, 6, 7, 8, 12, 16, 17, 18, 19, 20, 21, 24]) GRID.push({ ...place, date, clouds, cover, visibility, rain, hour });

describe(`every output, over a grid of ${GRID.length} weathers`, () => {
  it("passes the stage's own check unchanged (cleanAtmosphere is the identity on it, the direction to 1e-12)", () => {
    for (const t of GRID) {
      const a = atmosphereOf(params(t));
      const c = cleanAtmosphere(a);
      a.sun.direction.forEach((v, i) => expect(Math.abs(v - c.sun.direction[i])).toBeLessThan(1e-12));
      expect({ ...c, sun: { ...c.sun, direction: a.sun.direction } }).toStrictEqual(a);
    }
  });

  it("is pure JSON, the same twice: a JSON round trip is the identity, and the same params give a deep-equal value", () => {
    for (const t of GRID) {
      const a = atmosphereOf(params(t));
      expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
      expect(atmosphereOf(params(t))).toStrictEqual(a);
    }
  });

  it("names only CONVENTIONS.md's fields", () => {
    for (const t of GRID) {
      const a = atmosphereOf(params(t));
      expect(Object.keys(a).filter((k) => k !== "clouds")).toEqual(["sky", "fog", "sun", "exposure"]);
      expect(Object.keys(a.sun)).toEqual(["direction", "color", "intensity", "shadows"]);
      if (a.clouds) expect(Object.keys(a.clouds)).toEqual(["cover", "contrast", "scale", "base"]);
    }
  });

  it("never throws, whatever the trait", () => {
    for (const t of [undefined, null, {}, { offset: "+05:30", date: "2026-02-30", hour: 99, cover: "lots", clouds: "nimbus", visibility: 0, rain: -1, lat: 1e9 }])
      expect(() => atmosphereOf(params(t))).not.toThrow();
  });
});

// The conditions to step the sun under: every kind × cover {0, 0.5, 1} (clear air), as the plan's tables ask.
const SKIES = KIND_NAMES.flatMap((clouds) => [0, 0.5, 1].map((cover) => ({ clouds, cover })));
const at = (t, e) => atmosphereAt(conditionsOf(params(t)), { azimuth: 200, apparent: e, geometric: e });

describe("the sun's elevation", () => {
  it("the bands run downward from 20° to -12°, the day node is the identity, and exposure never rises as they go", () => {
    expect(BANDS.map((b) => b.at)).toEqual([20, 6, 0, -0.833, -6, -12]);
    expect(BANDS[0]).toMatchObject({ top: [1, [1, 1, 1]], horizon: [1, [1, 1, 1]], bottom: [1, [1, 1, 1]], sun: [1, 1, 1], disc: 1, light: 1, exposure: 1 });
    for (let i = 1; i < BANDS.length; i++) expect(BANDS[i].exposure).toBeLessThanOrEqual(BANDS[i - 1].exposure);
  });

  for (const t of SKIES)
    it(`exposure is non-increasing from 90° down to -20° in 1° steps, and is the night's below -12°: ${t.clouds} at cover ${t.cover}`, () => {
      let last = Infinity;
      for (let e = 90; e >= -20; e--) {
        const x = at(t, e).exposure;
        expect(x).toBeLessThanOrEqual(last);
        last = x;
      }
      const day = at(t, 45).exposure;
      for (const e of [-12, -15, -20, -90]) expect(at(t, e).exposure).toBe(day * BANDS.at(-1).exposure);
    });

  // At each band's edge, and at the 2° shadow gate, the look a hundredth of a degree either side, over every kind ×
  // cover, three visibilities, and rain: no sky colour moves more than 1/255 in sRGB, the space the doc writes it in
  // (before the hex rounds it); the sun's colour, which fades to black and so crosses sRGB's steep toe, no more than
  // 1/255 in linear RGB, the space it lights in (Decision 22).
  const EDGES = [...BANDS.map((b) => b.at), 2];
  const CONDS = SKIES.flatMap((s) => [20000, 3000, 1000].flatMap((visibility) => [0, 10].map((rain) => conditionsOf(params({ ...s, visibility, rain })))));
  for (const e of EDGES)
    it(`continuous at ${e}° ± 0.01°`, () => {
      for (const c of CONDS) {
        const [a, b] = [skyAt(c, e + 0.01), skyAt(c, e - 0.01)];
        for (const k of ["top", "horizon", "bottom"]) expect(dist(toSrgb(a[k]), toSrgb(b[k])), `${k} at ${JSON.stringify(c)}`).toBeLessThanOrEqual(1 / 255);
        expect(dist(a.sun, b.sun), `sun at ${JSON.stringify(c)}`).toBeLessThanOrEqual(1 / 255);
      }
    });

  // The sun gives light iff its geometric elevation is above the almanac's sunrise, -0.833°. Its disc fades with it
  // and is black from there down; just above, the colour rounds to black a thousandth of a degree early (-0.8329°),
  // while the light is still 2e-4 of the day's (Decision 19).
  it.each([
    [10, true, true],
    [0, true, true],
    [-0.8, true, true],
    [-0.832, true, true],
    [-0.8329, true, false],
    [-0.833, false, false],
    [-1, false, false],
    [-30, false, false],
  ])("geometric %s° → gives light: %s; a disc that isn't #000000: %s", (e, light, disc) => {
    for (const t of SKIES) {
      const sun = at(t, e).sun;
      expect(sun.intensity > 0).toBe(light);
      expect(sun.color !== "#000000").toBe(disc);
    }
  });

  it("light, the bands and the shadow gate read the geometric elevation, not the apparent", () => {
    const c = conditionsOf(params({}));
    // refraction lifts a sun 1° under the horizon to about -0.4° apparent: still set
    expect(atmosphereAt(c, { azimuth: 270, apparent: -0.4, geometric: -1 }).sun.intensity).toBe(0);
    expect(atmosphereAt(c, { azimuth: 270, apparent: 2.3, geometric: 1.9 }).sun.shadows).toBe(false);
    expect(atmosphereAt(c, { azimuth: 270, apparent: 10, geometric: 3 }).sky).toEqual(at({}, 3).sky);
  });

  // An overcast or fogbound sky (s = 1) dims as the sun sets but takes none of the bands' tints: an overcast sunset
  // is grey, not orange. So every channel of every sky colour scales by the same gain.
  it("under a full overcast and in fog the bands only dim the sky: no tint", () => {
    for (const t of [{ cover: 1, clouds: "stratus" }, { cover: 1, clouds: "stratocumulus" }, { cover: 0, visibility: 1000 }])
      for (const e of [6, 3, 0, -0.833, -3, -6, -12]) {
        const c = conditionsOf(params(t));
        const [low, day] = [skyAt(c, e), skyAt(c, 45)];
        for (const k of ["top", "horizon", "bottom"]) {
          const r = low[k].map((v, i) => v / day[k][i]);
          for (const x of r) expect(x).toBeCloseTo(r[0], 12);
        }
      }
  });

  it("in a clear sky the sunset warms the horizon: more red than blue, relative to the day", () => {
    const c = conditionsOf(params({ cover: 0, visibility: 20000 }));
    const [low, day] = [skyAt(c, 0), skyAt(c, 45)];
    expect(low.horizon[0] / day.horizon[0]).toBeGreaterThan(low.horizon[2] / day.horizon[2]);
    expect(low.sun[0] / day.sun[0]).toBeGreaterThan(low.sun[2] / day.sun[2]);
  });

  it("the sun points where solar.js says, below the horizon too (its apparent elevation)", () => {
    for (const [az, el] of [[90, 30], [200, -5], [315, 0]]) expect(atmosphereAt(conditionsOf(params({})), { azimuth: az, apparent: el, geometric: el - 0.5 }).sun.direction).toEqual(sunDirection(az, el));
  });

  it("through the day at Cadboro Bay (2026-07-15): the sun rises between 05:00 and 05:30 and sets between 21:00 and 21:15 (PDT)", () => {
    const up = [0, 4, 5, 5.5, 12, 20, 21, 21.25, 22, 24].map((hour) => [hour, atmosphereOf(params({ hour })).sun.intensity > 0]);
    expect(up).toEqual([[0, false], [4, false], [5, false], [5.5, true], [12, true], [20, true], [21, true], [21.25, false], [22, false], [24, false]]);
  });
});

describe("shadows: effective cover under 0.75, haze under 0.5, the sun more than 2° up", () => {
  // [the weather, the sun's geometric elevation, shadows]
  it.each([
    [{}, 45, true],
    [{}, 2.01, true],
    [{}, 2, false],
    [{}, -10, false],
    [{ cover: 0.7 }, 45, true],
    [{ cover: 0.75 }, 45, false],
    [{ cover: 1, clouds: "cirrus" }, 45, true],
    [{ cover: 1, clouds: "stratus" }, 45, false],
    [{ visibility: 3200 }, 45, true],
    [{ visibility: 3100 }, 45, false],
    // rain only darkens: it leaves the visibility, so the haze and this gate, as they were (Decision 41)
    [{ visibility: 10000, rain: 50 }, 45, true],
    [{ visibility: 3100, rain: 50 }, 45, false],
  ])("%j at %s° → %s", (t, e, want) => expect(at(t, e).sun.shadows).toBe(want));
});

describe("haze, rain and the fog", () => {
  it.each([
    [50000, 0],
    [10000, 0],
    [10000 / Math.sqrt(10), 0.5],
    [1000, 1],
    [100, 1],
  ])("visibility %s m → haze %s", (v, h) => expect(hazeOf(v)).toBeCloseTo(h, 12));

  // The visibility field is the visibility in force, rain and all, as it is
  // observed: rain leaves it as it is (Decision 41).
  it("the visibility in force is the field's, in any rain", () => {
    for (const visibility of [100, 1000, 3100, 10000, 50000]) for (const rain of [0, 0.1, 2.5, 25, 50]) expect(conditionsOf(params({ visibility, rain })).visibility).toBe(visibility);
  });

  it.each([
    [0, 1],
    [4, 0.85],
    [50, 1 - 15 / 54],
  ])("rain %s mm/h darkens by %s", (rain, w) => expect(wetOf(rain)).toBeCloseTo(w, 12));

  // Rain does one thing: it darkens the sky and the sun's light by wetOf, at the haze the visibility makes, which it
  // leaves as it is (the visibility field has the rain in it already). At 0 mm/h it does nothing.
  it("rain at 0 mm/h is the identity; any rain leaves the visibility and the haze, and darkens the sky and the sun's light by wetOf", () => {
    for (const t of SKIES) {
      expect(atmosphereOf(params({ ...t, rain: 0 }))).toStrictEqual(atmosphereOf(params(t)));
      for (const rain of [0.1, 1, 10, 50]) {
        const c = conditionsOf(params({ ...t, rain }));
        expect({ ...c, wet: 1 }).toEqual(conditionsOf(params(t)));
        const [wet, dry] = [skyAt(c, 45), skyAt({ ...c, wet: 1 }, 45)];
        for (const k of ["top", "horizon", "bottom"]) wet[k].forEach((v, i) => expect(v).toBeCloseTo(dry[k][i] * wetOf(rain), 12));
        expect(wet.intensity).toBeCloseTo(dry.intensity * wetOf(rain), 12);
        expect(wet.sun).toEqual(dry.sun);
      }
    }
  });

  it.each([
    [{}, 9000],
    [{ visibility: 100 }, 90],
    [{ visibility: 50000 }, 45000],
    [{ visibility: 19000 }, 17100],
  ])("%j: fog far %s m, the horizon's colour, near under far", (t, far) => {
    const a = atmosphereOf(params(t));
    expect(a.fog.far).toBe(far);
    expect(a.fog.color).toBe(a.sky.horizon);
    expect(a.fog.near).toBeLessThan(a.fog.far);
  });

  it("the look is continuous across the cover nodes and the haze's ends (at 45°)", () => {
    for (const [ca, cb] of [[0.3499, 0.3501], [0.9999, 1]]) expect(Math.max(...COLOURS.map((k) => dist(dayLook(ca, 0)[k], dayLook(cb, 0)[k])))).toBeLessThan(1 / 255);
    for (const [va, vb] of [[9990, 10010], [999, 1001]])
      for (const cover of [0, 0.35, 1]) {
        const [a, b] = [skyAt(conditionsOf(params({ cover, visibility: va })), 45), skyAt(conditionsOf(params({ cover, visibility: vb })), 45)];
        for (const k of COLOURS) expect(dist(a[k], b[k])).toBeLessThan(1 / 255);
      }
  });
});

// ─── the stage's deck, copied: cloudAt (scene/src/stage/viewport.js at e74b9ef7) and the sky shader's noise ───
// (cloudHash, cloudNoise, in double precision rather than the GPU's float: the same field, statistically).
const fract = (x) => x - Math.floor(x);
const mod289 = (x) => x - 289 * Math.floor(x / 289);
const cloudHash = (x, y) => fract(Math.sin(mod289(x) * 127.1 + mod289(y) * 311.7) * 43758.5453);
function cloudNoise(px, pz) {
  const [ix, iz] = [Math.floor(px), Math.floor(pz)];
  const [fx, fz] = [px - ix, pz - iz];
  const [ux, uz] = [fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)];
  const mix = (a, b, t) => a * (1 - t) + b * t;
  return mix(mix(cloudHash(ix, iz), cloudHash(ix + 1, iz), ux), mix(cloudHash(ix, iz + 1), cloudHash(ix + 1, iz + 1), ux), uz);
}
function cloudAt(d, { cover, contrast, scale, base }, noise) {
  if (!(d[1] > 0)) return { factor: 1, white: 0 };
  const k = (base / Math.max(d[1], 0.02)) / scale;
  const x = d[0] * k, z = d[2] * k;
  const n = noise(x, z) * 0.65 + noise(x * 2.3 + 17, z * 2.3 + 17) * 0.35;
  const sm = (a, b, t) => {
    const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const fade = sm(0.03, 0.3, d[1]);
  const w = cover >= 1 ? n : sm(1 - cover - 0.12, 1 - cover + 0.12, n);
  const shape = cover >= 1 ? 2 * w - 1 : w * (2 * sm(0.05, 0.35, d[1]) - 1);
  return { factor: 1 + contrast * shape * fade, white: cover >= 1 ? 0 : w * fade * 0.6 };
}
// ─────────────────────────────────────────────────────────────────────────────

/** A finite set of directions over the sky: 24 elevations × 36 azimuths. */
const SKY_DIRS = [];
for (let i = 1; i <= 24; i++)
  for (let j = 0; j < 36; j++) {
    const [el, az] = [((i - 0.5) / 24) * (Math.PI / 2), (j * 10 * Math.PI) / 180];
    SKY_DIRS.push([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
  }
/** The deck as the sky shader draws it, at every direction: [factor, whitening] pairs (no deck: 1 and 0). */
const drawn = (atm) => SKY_DIRS.map((d) => (atm.clouds ? cloudAt(d, atm.clouds, cloudNoise) : { factor: 1, white: 0 }));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** The largest change, at any direction, in the drawn factor or whitening between two atmospheres. */
const drawnStep = (a, b) => {
  const [p, q] = [drawn(a), drawn(b)];
  return Math.max(...p.map((x, i) => Math.max(Math.abs(x.factor - q[i].factor), Math.abs(x.white - q[i].white))));
};

describe("the cloud deck", () => {
  it("its kinds are the trait's options, each a deck the stage accepts, drawn scattered or as a layer", () => {
    expect(KIND_NAMES).toEqual(plugins[0].describes.weather.fields.find((f) => f.key === "clouds").options.map((o) => o.value));
    expect(Object.fromEntries(KIND_NAMES.map((k) => [k, KINDS[k].deck]))).toEqual({ cumulus: "scattered", stratocumulus: "layer", stratus: "layer", cirrus: "scattered" });
    for (const k of Object.values(KINDS)) {
      expect(k.contrast).toBeGreaterThan(0);
      expect(k.contrast).toBeLessThanOrEqual(0.5);
      expect(k.opacity).toBeGreaterThan(0);
      expect(k.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("a kind never crosses from one of the stage's decks to the other: a layer is always the stage's cover 1, a scattered deck never reaches it", () => {
    for (const t of GRID) {
      const p = params(t);
      const deck = deckOf(conditionsOf(p));
      if (!deck) continue;
      if (KINDS[p.clouds].deck === "layer") expect(deck.cover).toBe(1);
      else expect(deck.cover).toBeLessThanOrEqual(SCATTERED_MAX);
      expect(atmosphereOf(p).clouds).toStrictEqual(deck);
    }
  });

  // [the weather, the deck]
  it.each([
    [{ cover: 0 }, undefined],
    [{ cover: 0, clouds: "stratus" }, undefined],
    [{ cover: 0.5, clouds: "cumulus", base: 1500 }, { cover: 0.5, contrast: 0.25, scale: 700, base: 1500 }],
    [{ cover: 1, clouds: "cumulus" }, { cover: 0.95, contrast: 0.25, scale: 700, base: 1200 }],
    [{ cover: 0.8, clouds: "stratocumulus", base: 600 }, { cover: 1, contrast: 0.096, scale: 500, base: 600 }],
    [{ cover: 1, clouds: "stratus", base: 200 }, { cover: 1, contrast: 0.05, scale: 1500, base: 200 }],
    [{ cover: 0.6, clouds: "cirrus", base: 9000 }, { cover: 0.6, contrast: 0.08, scale: 3000, base: 9000 }],
    [{ cover: 1, clouds: "cirrus", base: 9000 }, { cover: 0.95, contrast: 0.08, scale: 3000, base: 9000 }],
    [{ cover: 1, visibility: 1000 }, undefined],
    [{ cover: 1, clouds: "stratus", visibility: 1000 }, undefined],
    [{ cover: 1, visibility: 10 ** 3.5 }, { cover: 0.475, contrast: 0.125, scale: 700, base: 1200 }],
    [{ cover: 1, clouds: "stratocumulus", visibility: 10 ** 3.5 }, { cover: 1, contrast: 0.06, scale: 500, base: 1200 }],
  ])("%j → %j", (t, deck) => {
    const clouds = atmosphereOf(params(t)).clouds;
    if (deck === undefined) expect(clouds).toBeUndefined();
    else {
      expect(Object.keys(clouds)).toEqual(Object.keys(deck));
      for (const k of Object.keys(deck)) expect(clouds[k]).toBeCloseTo(deck[k], 12);
    }
  });

  // The stage draws a deck of cover under 1 scattered (whitened up to 0.6, brightened overhead) and of cover 1 as a
  // layer (textured, never whitened): handing it the trait's cover straight would jump at cover 1 (cumulus's mean
  // factor 1.21 → 0.98, its whitening 0.54 → 0). As drawn, 0.95, 0.99 and 1 are one sky, for every kind.
  for (const kind of KIND_NAMES)
    it(`as drawn, ${kind} at cover 0.95, 0.99 and 1 is one sky: mean factor and whitening agree to 1e-3`, () => {
      const [a, b, c] = [0.95, 0.99, 1].map((cover) => drawn(atmosphereOf(params({ cover, clouds: kind }))));
      for (const x of [b, c])
        for (const f of ["factor", "white"]) expect(Math.abs(mean(x.map((d) => d[f])) - mean(a.map((d) => d[f])))).toBeLessThan(1e-3);
    });

  // Continuity as drawn, along both levers, per direction. The stage's smoothstep over the noise is 1.5 / 0.24 = 6.25
  // steep, so a deck cover step of 0.01 whitens a direction by at most 0.6 × 6.25 × 0.01 = 0.0375 and moves its factor
  // by less; a jump between decks moves one by up to 0.6. So: no direction moves more than 0.04 for a 0.01 step.
  const STEP = 0.04;
  for (const kind of KIND_NAMES) {
    it(`as drawn, ${kind}: no jump along cover 0 → 1 (steps of 0.01, at visibility 10 km and 3 km)`, () => {
      for (const visibility of [10000, 3000]) {
        let last = atmosphereOf(params({ cover: 0, clouds: kind, visibility }));
        for (let i = 1; i <= 100; i++) {
          const next = atmosphereOf(params({ cover: i / 100, clouds: kind, visibility }));
          expect(drawnStep(last, next), `cover ${(i - 1) / 100} → ${i / 100} at ${visibility} m`).toBeLessThanOrEqual(STEP);
          last = next;
        }
      }
    });
    it(`as drawn, ${kind}: no jump along the haze 0 → 1, into the fog where the deck goes (steps of 0.01, at cover 0.35 and 1)`, () => {
      for (const cover of [0.35, 1]) {
        let last = atmosphereOf(params({ cover, clouds: kind, visibility: 10000 }));
        for (let i = 1; i <= 100; i++) {
          const next = atmosphereOf(params({ cover, clouds: kind, visibility: 10000 / 10 ** (i / 100) }));
          expect(drawnStep(last, next), `h ${(i - 1) / 100} → ${i / 100} at cover ${cover}`).toBeLessThanOrEqual(STEP);
          last = next;
        }
        expect(last.clouds).toBeUndefined();
      }
    });
  }

  it("cirrus lets the blue through: at cover 1 the sky is nearer the bright day than Ukee grey", () => {
    const cirrus = atmosphereOf(params({ cover: 1, clouds: "cirrus" })).sky.top;
    expect(dist(toLinear(cirrus), toLinear(LOOKS.bright.sky.top))).toBeLessThan(dist(toLinear(cirrus), toLinear(LOOKS.grey.sky.top)));
  });
});
