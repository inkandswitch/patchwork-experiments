// The look from the weather (atmosphere.js; WEATHER.md, "The look"), over
// finite tables:
//   - the four anchors reproduce the art direction they were, exactly, at
//     their conditions (the old values are written out here, not read from
//     LOOKS);
//   - every output, over a grid of every kind, cover, visibility, rain and
//     hour, is one the stage's own check passes unchanged (a copy of
//     cleanAtmosphere, as water copies cloudAt), and pure JSON;
//   - exposure never rises as the sun sinks; the colours don't jump at a
//     band's edge, a cover node or the haze's ends; the sun gives light iff
//     it is up; shadows, haze, rain and the deck by their rules.
import { describe, expect, it } from "vitest";
import { plugins } from "./index.js";
import { BANDS, KINDS, LOOKS, atmosphereAt, atmosphereOf, conditionsOf, dayLook, hazeOf, skyAt, sunOf, toHex, toLinear, visibilityOf, wetOf } from "./atmosphere.js";
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
    ["the marine layer, at Ucluelet", { place: "Ucluelet", lat: 48.95, lon: -125.558, visibility: 1000, wind: 5, from: 300 }, MARINE],
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

  it("the default weather's sun is solar.js's: azimuth 225.57°, apparent elevation 56.30°", () => {
    const sun = sunOf(params({}));
    expect(sun.azimuth).toBeCloseTo(225.57, 1);
    expect(sun.apparent).toBeCloseTo(56.3, 1);
    expect(atmosphereOf(params({})).sun.direction).toEqual(sunDirection(sun.azimuth, sun.apparent));
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

  it("names only STAGE.md's fields", () => {
    for (const t of GRID) {
      const a = atmosphereOf(params(t));
      expect(Object.keys(a).filter((k) => k !== "clouds")).toEqual(["sky", "fog", "sun", "exposure"]);
      expect(Object.keys(a.sun)).toEqual(["direction", "color", "intensity", "shadows"]);
      if (a.clouds) expect(Object.keys(a.clouds)).toEqual(["cover", "contrast", "scale", "base"]);
    }
  });

  it("never throws, whatever the trait", () => {
    for (const t of [undefined, null, {}, { zone: "+05:30", date: "2026-02-30", hour: 99, cover: "lots", clouds: "nimbus", visibility: 0, rain: -1, lat: 1e9 }])
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

  // At each band's edge, and at the 2° shadow gate, the look a hundredth of a degree either side: no colour jumps
  // more than 1/255 (linear RGB, before the hex rounds it), over every kind × cover, three visibilities, and rain.
  const EDGES = [...BANDS.map((b) => b.at), 2];
  const CONDS = SKIES.flatMap((s) => [20000, 3000, 1000].flatMap((visibility) => [0, 10].map((rain) => conditionsOf(params({ ...s, visibility, rain })))));
  for (const e of EDGES)
    it(`continuous at ${e}° ± 0.01°`, () => {
      for (const c of CONDS) {
        const [a, b] = [skyAt(c, e + 0.01), skyAt(c, e - 0.01)];
        for (const k of COLOURS) expect(dist(a[k], b[k]), `${k} at ${JSON.stringify(c)}`).toBeLessThanOrEqual(1 / 255);
      }
    });

  // The sun gives light, and shows a disc, iff its geometric elevation is above the almanac's sunrise, -0.833°.
  it.each([
    [10, true],
    [0, true],
    [-0.8, true],
    [-0.833, false],
    [-1, false],
    [-30, false],
  ])("geometric %s° → the sun is up: %s", (e, up) => {
    for (const t of SKIES) {
      const sun = at(t, e).sun;
      expect(sun.intensity > 0).toBe(up);
      expect(sun.color !== "#000000").toBe(up);
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
    [{ visibility: 10000, rain: 2.5 }, 45, true],
    [{ visibility: 10000, rain: 25 }, 45, false],
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

  it.each([
    [10000, 0, 10000],
    [50000, 0, 50000],
    [1e9, 2.5, 8016],
    [1e9, 25, 1493],
    [10000, 2.5, 4449],
    [1000, 50, 474],
  ])("visibility %s m in %s mm/h of rain → %s m in force", (v, rain, want) => expect(Math.round(visibilityOf(v, rain))).toBe(want));

  it.each([
    [0, 1],
    [4, 0.85],
    [50, 1 - 15 / 54],
  ])("rain %s mm/h darkens by %s", (rain, w) => expect(wetOf(rain)).toBeCloseTo(w, 12));

  // Rain does two things: its extinction draws the visibility in (so the haze, and the look, follow it), and at that
  // haze it darkens the sky and the sun's light by wetOf. At 0 mm/h it does neither.
  it("rain at 0 mm/h is the identity; any rain draws the fog in, and at the haze it makes darkens the sky and the sun's light by wetOf", () => {
    for (const t of SKIES) {
      expect(atmosphereOf(params({ ...t, rain: 0 }))).toStrictEqual(atmosphereOf(params(t)));
      for (const rain of [0.1, 1, 10, 50]) {
        const c = conditionsOf(params({ ...t, rain }));
        expect(c.visibility).toBeLessThan(conditionsOf(params(t)).visibility);
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

describe("the cloud deck", () => {
  it("its kinds are the trait's options, each a deck the stage accepts", () => {
    expect(KIND_NAMES).toEqual(plugins[0].describes.weather.fields.find((f) => f.key === "clouds").options.map((o) => o.value));
    for (const k of Object.values(KINDS)) {
      expect(k.contrast).toBeGreaterThan(0);
      expect(k.contrast).toBeLessThanOrEqual(0.5);
      expect(k.opacity).toBeGreaterThan(0);
      expect(k.opacity).toBeLessThanOrEqual(1);
    }
  });

  // [the weather, the deck]
  it.each([
    [{ cover: 0 }, undefined],
    [{ cover: 0.5, clouds: "cumulus", base: 1500 }, { cover: 0.5, contrast: 0.25, scale: 700, base: 1500 }],
    [{ cover: 0.8, clouds: "stratocumulus", base: 600 }, { cover: 0.8, contrast: 0.12, scale: 500, base: 600 }],
    [{ cover: 1, clouds: "stratus", base: 200 }, { cover: 1, contrast: 0.05, scale: 1500, base: 200 }],
    [{ cover: 0.6, clouds: "cirrus", base: 9000 }, { cover: 0.6, contrast: 0.08, scale: 3000, base: 9000 }],
    [{ cover: 1, visibility: 1000 }, undefined],
    [{ cover: 1, visibility: 10000 / Math.sqrt(10) }, { cover: 1, contrast: 0.125, scale: 700, base: 1200 }],
  ])("%j → %j", (t, deck) => {
    const clouds = atmosphereOf(params(t)).clouds;
    if (deck === undefined) expect(clouds).toBeUndefined();
    else {
      expect(Object.keys(clouds)).toEqual(Object.keys(deck));
      for (const k of Object.keys(deck)) expect(clouds[k]).toBeCloseTo(deck[k], 12);
    }
  });

  it("cirrus lets the blue through: at cover 1 the sky is nearer the bright day than Ukee grey", () => {
    const cirrus = atmosphereOf(params({ cover: 1, clouds: "cirrus" })).sky.top;
    expect(dist(toLinear(cirrus), toLinear(LOOKS.bright.sky.top))).toBeLessThan(dist(toLinear(cirrus), toLinear(LOOKS.grey.sky.top)));
  });
});
