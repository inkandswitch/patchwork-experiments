// The world's look from its weather (WEATHER.md, "The look"): the ambient
// `atmosphere` (scene STAGE.md, "Atmosphere") as a pure function of the
// weather's params. Same params, same JSON, on every peer.
//
// A finite table of looks, each a complete daytime atmosphere, combined in
// three steps:
//   1. cloud: the look interpolated over the sky's effective cover
//      (cover · the kind's opacity) between three nodes, the clear afternoon
//      (0), the bright day (0.35) and Ukee grey (1);
//   2. haze: blended toward the fogbound look (the marine layer) by the haze
//      weight h, 0 at a visibility of 10 km or more, 1 at 1 km or less, linear
//      in log visibility between;
//   3. the sun's elevation: that look holds while the sun's geometric
//      elevation is 20° or more, and below it is filtered through a finite
//      table of bands (low, horizon, set, civil twilight, night).
// Rain darkens the sky and the sun's light; at 0 mm/h it is the identity.
// It doesn't touch the visibility: that field is the visibility in force,
// rain and all, as it is observed (Decision 41). Colours are
// interpolated and filtered in linear RGB and written as sRGB hex; the four
// looks are reproduced exactly at their conditions (the anchors' table in
// WEATHER.md), so the art direction they were is a fixed point of the model.

import { sunAt, sunDirection } from "./solar.js";
import { instantOf } from "./time.js";

// ─── colour ──────────────────────────────────────────────────────────────────

/** An sRGB "#rrggbb" as linear RGB [r, g, b] in 0..1 (the IEC 61966-2-1 transfer). */
export function toLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((b) => {
    const c = b / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

/** Linear RGB, clamped to 0..1, as sRGB in 0..1, unrounded (the inverse transfer): the space the doc's colours are written in. */
export const toSrgb = (rgb) =>
  rgb.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  });

/** Linear RGB, clamped to 0..1, as an sRGB "#rrggbb". */
export const toHex = (rgb) => `#${toSrgb(rgb).map((s) => Math.round(s * 255).toString(16).padStart(2, "0")).join("")}`;

/** a at t = 0, b at t = 1, exactly at both ends. */
const lerp = (a, b, t) => a * (1 - t) + b * t;
const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const mul3 = (a, b) => a.map((v, i) => v * b[i]);
const scale3 = (a, k) => a.map((v) => v * k);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ─── the looks (the anchors) ─────────────────────────────────────────────────

/**
 * The four daytime looks, each the art direction it was, at the conditions
 * WEATHER.md's anchors table states. `near` is the fog's near as a fraction
 * of its far, so each look's old near comes back at its visibility.
 */
export const LOOKS = Object.freeze({
  /** sailing's ATMOSPHERE: blue overhead, a pale horizon, fair-weather cumulus over a third of the sky. Cover 0.35, visibility 10 km. */
  bright: Object.freeze({ sky: Object.freeze({ top: "#2f6db5", horizon: "#cfe2ee", bottom: "#a9c6d8" }), sun: Object.freeze({ color: "#fff3df", intensity: 2.2 }), exposure: 1, near: 300 / 9000 }),
  /** terrain's "Clear afternoon" (Ucluelet). Cover 0, visibility 20 km. */
  clear: Object.freeze({ sky: Object.freeze({ top: "#5b86b0", horizon: "#d5e0e4", bottom: "#a9bcc4" }), sun: Object.freeze({ color: "#fff4e2", intensity: 2.2 }), exposure: 1, near: 800 / 18000 }),
  /** terrain's "Ukee grey": overcast, bright. Cover 1, visibility 19 km (fog far 17 100, Decision 9). */
  grey: Object.freeze({ sky: Object.freeze({ top: "#c4cacc", horizon: "#959ea1", bottom: "#7a8487" }), sun: Object.freeze({ color: "#eef0f0", intensity: 1.1 }), exposure: 1.05, near: 900 / 17100 }),
  /** terrain's "Marine layer": fogbound. Visibility 1 km, any cover. */
  fog: Object.freeze({ sky: Object.freeze({ top: "#bfc6c7", horizon: "#c9cfcf", bottom: "#b4bbbb" }), sun: Object.freeze({ color: "#f2f3f2", intensity: 0.6 }), exposure: 1, near: 30 / 900 }),
});

/** The cloud-cover nodes: effective cover → look. */
const COVER = Object.freeze([
  [0, "clear"],
  [0.35, "bright"],
  [1, "grey"],
]);

/** A look in linear RGB, for interpolating. */
const linearLook = (l) => ({ top: toLinear(l.sky.top), horizon: toLinear(l.sky.horizon), bottom: toLinear(l.sky.bottom), sun: toLinear(l.sun.color), intensity: l.sun.intensity, exposure: l.exposure, near: l.near });
const LINEAR = Object.fromEntries(Object.entries(LOOKS).map(([k, l]) => [k, linearLook(l)]));

const mixLooks = (a, b, t) => ({
  top: lerp3(a.top, b.top, t),
  horizon: lerp3(a.horizon, b.horizon, t),
  bottom: lerp3(a.bottom, b.bottom, t),
  sun: lerp3(a.sun, b.sun, t),
  intensity: lerp(a.intensity, b.intensity, t),
  exposure: lerp(a.exposure, b.exposure, t),
  near: lerp(a.near, b.near, t),
});

/** The daytime look (linear) at effective cover `ce` and haze weight `h`. */
export function dayLook(ce, h) {
  const i = ce <= COVER[1][0] ? 0 : 1;
  const [[c0, a], [c1, b]] = [COVER[i], COVER[i + 1]];
  const cloud = mixLooks(LINEAR[a], LINEAR[b], (ce - c0) / (c1 - c0));
  return mixLooks(cloud, LINEAR.fog, h);
}

// ─── the clouds ──────────────────────────────────────────────────────────────

/**
 * Each kind's opacity (how much of the sky's look it takes: thin cirrus lets
 * the blue through), which of the stage's two decks draws it, and that
 * deck's contrast and cell size (STAGE.md's clouds). The stage draws a deck
 * of cover under 1 as scattered clouds (the noise's top `cover` whitened and
 * brightened overhead) and a deck of cover 1 as a layer (the whole sky
 * textured ±contrast, nothing whitened): two decks, not one deck at two
 * covers. So a kind is drawn by one of them at every cover (deckOf): heaps
 * and wisps (cumulus, cirrus) scattered, sheets (stratocumulus, stratus) as
 * a layer. Cumulus and stratocumulus are the anchors' own decks; stratus (a
 * flat low grey, barely textured, wide cells) and cirrus (high, faint, very
 * wide) are new art direction.
 */
export const KINDS = Object.freeze({
  cumulus: Object.freeze({ opacity: 1, deck: "scattered", contrast: 0.25, scale: 700 }),
  stratocumulus: Object.freeze({ opacity: 1, deck: "layer", contrast: 0.12, scale: 500 }),
  stratus: Object.freeze({ opacity: 1, deck: "layer", contrast: 0.05, scale: 1500 }),
  cirrus: Object.freeze({ opacity: 0.3, deck: "scattered", contrast: 0.08, scale: 3000 }),
});

/**
 * The highest cover a scattered deck is drawn at. Under 1, so it never turns
 * into the stage's layer; at 0.95 the scattered deck already whitens all but
 * the noise's lowest 17% (under half a percent of the sky), so 0.95 to 1 is
 * one look.
 */
export const SCATTERED_MAX = 0.95;

/**
 * The deck (STAGE.md's clouds) for conditions `c`, or null: continuous in
 * the trait's cover and the haze, as drawn, because it moves only by the
 * stage deck's own continuous levers and never crosses from one deck to the
 * other. A layer is the stage's cover-1 deck, its contrast the kind's ×
 * cover; a scattered deck is the kind's at min(cover, SCATTERED_MAX). The
 * haze fades either toward none, `× (1 - h)` (a layer's contrast; a
 * scattered deck's cover and contrast, since its whitening follows its cover
 * alone). None at cover 0 or h = 1: a clear sky has none, and fog hides it.
 */
export function deckOf(c) {
  const k = KINDS[c.kind];
  const fade = 1 - c.h;
  const [cover, contrast] = k.deck === "layer" ? [1, k.contrast * c.cover * fade] : [Math.min(c.cover, SCATTERED_MAX) * fade, k.contrast * fade];
  return cover > 0 && contrast > 0 ? { cover, contrast, scale: k.scale, base: c.base } : null;
}

// ─── haze and rain ───────────────────────────────────────────────────────────

/** The haze weight: 0 at a visibility of 10 km or more, 1 at 1 km or less, linear in log visibility between. */
export const hazeOf = (visibility) => clamp01(Math.log10(10000 / visibility));

/** How much rain darkens the sky and the sun's light: 1 at 0 mm/h, 0.85 at 4, toward 0.7 in a cloudburst. */
export const wetOf = (rain) => 1 - (0.3 * rain) / (rain + 4);

/**
 * What the look depends on besides the sun, from the weather's params:
 * the deck (cover, kind, base), the effective cover `ce`, the visibility in
 * force, the haze weight `h`, the rain's darkening `wet`, and `s`, how
 * overcast or fogbound the sky is (max of ce and h), which greys the bands'
 * tints: an overcast sunset is dim, not orange.
 */
export function conditionsOf(p) {
  const ce = p.cover * KINDS[p.clouds].opacity;
  const h = hazeOf(p.visibility);
  return { cover: p.cover, kind: p.clouds, base: p.base, ce, visibility: p.visibility, h, wet: wetOf(p.rain), s: Math.max(ce, h) };
}

// ─── the sun's elevation ─────────────────────────────────────────────────────

/**
 * The bands, by the sun's geometric elevation (degrees), highest first. Each
 * says what becomes of the daytime look there: the sky's three colours each
 * as a gain and a tint (linear RGB multipliers; the tint is greyed toward
 * white by how overcast the sky is), the sun's tint, `disc` (how bright the
 * sun's colour, and so its disc in the sky, stays), `light` (its intensity's
 * factor) and `exposure`'s. Linear between nodes; above the first node the
 * look holds, below the last it is night. The sun sets at -0.833° (the
 * almanac's sunrise: the upper limb on the horizon), where its light and
 * disc reach 0; civil twilight ends at -6° and nautical at -12°. All but the
 * day node are new art direction. Exposure never rises as the sun sinks.
 */
export const BANDS = Object.freeze([
  { at: 20, name: "day", top: [1, [1, 1, 1]], horizon: [1, [1, 1, 1]], bottom: [1, [1, 1, 1]], sun: [1, 1, 1], disc: 1, light: 1, exposure: 1 },
  { at: 6, name: "low", top: [0.85, [0.97, 1, 1.04]], horizon: [0.95, [1.08, 0.98, 0.85]], bottom: [0.85, [1.03, 0.99, 0.94]], sun: [1, 0.83, 0.62], disc: 0.7, light: 0.95, exposure: 0.92 },
  { at: 0, name: "horizon", top: [0.5, [0.92, 0.96, 1.1]], horizon: [0.75, [1.3, 0.78, 0.45]], bottom: [0.5, [1.12, 0.88, 0.75]], sun: [1, 0.55, 0.25], disc: 0.2, light: 0.8, exposure: 0.72 },
  { at: -0.833, name: "set", top: [0.42, [0.9, 0.95, 1.12]], horizon: [0.62, [1.3, 0.72, 0.45]], bottom: [0.42, [1.1, 0.86, 0.78]], sun: [1, 0.5, 0.22], disc: 0, light: 0, exposure: 0.64 },
  { at: -6, name: "civil", top: [0.06, [0.75, 0.88, 1.25]], horizon: [0.1, [1.1, 0.8, 0.85]], bottom: [0.05, [0.85, 0.9, 1.1]], sun: [1, 0.5, 0.22], disc: 0, light: 0, exposure: 0.3 },
  { at: -12, name: "night", top: [0.008, [0.7, 0.85, 1.35]], horizon: [0.01, [0.85, 0.9, 1.15]], bottom: [0.006, [0.85, 0.9, 1.1]], sun: [1, 0.5, 0.22], disc: 0, light: 0, exposure: 0.15 },
].map((b) => Object.freeze(b)));

/**
 * The band filter at geometric elevation `e`: the nodes' values, linear
 * between, the day's above the first node and the night's below the last.
 * One shape everywhere: { top, horizon, bottom, sun, disc, light, exposure }.
 */
export function bandAt(e) {
  const [first, last] = [BANDS[0], BANDS[BANDS.length - 1]];
  const x = e < first.at ? (e > last.at ? e : last.at) : first.at; // NaN holds the day, as the sun is never NaN
  const j = BANDS.findIndex((b) => b.at < x);
  const i = j < 0 ? BANDS.length - 2 : j - 1; // BANDS[i].at >= x >= BANDS[i + 1].at
  const [a, b] = [BANDS[i], BANDS[i + 1]];
  const t = (a.at - x) / (a.at - b.at);
  const pair = (p, q) => [lerp(p[0], q[0], t), lerp3(p[1], q[1], t)];
  return { top: pair(a.top, b.top), horizon: pair(a.horizon, b.horizon), bottom: pair(a.bottom, b.bottom), sun: lerp3(a.sun, b.sun, t), disc: lerp(a.disc, b.disc, t), light: lerp(a.light, b.light, t), exposure: lerp(a.exposure, b.exposure, t) };
}

/** A tint greyed toward white by `s` (0 the tint, 1 white), exactly the tint at s = 0 and exactly white for a white tint. */
const temper = (tint, s) => tint.map((v) => v + (1 - v) * s);

/**
 * The look in linear RGB under conditions `c` (conditionsOf's) with the sun
 * at geometric elevation `e`: the daytime look, filtered by the band there
 * and darkened by rain. Unrounded: atmosphereAt writes it as JSON. Its
 * fields: top, horizon, bottom, sun (colours), intensity, exposure, near.
 */
export function skyAt(c, e) {
  const day = dayLook(c.ce, c.h);
  const band = bandAt(e);
  const sky = (key) => scale3(mul3(day[key], temper(band[key][1], c.s)), band[key][0] * c.wet);
  return {
    top: sky("top"),
    horizon: sky("horizon"),
    bottom: sky("bottom"),
    sun: scale3(mul3(day.sun, temper(band.sun, c.s)), band.disc),
    intensity: day.intensity * band.light * c.wet,
    exposure: day.exposure * band.exposure,
    near: day.near,
  };
}

// ─── the atmosphere ──────────────────────────────────────────────────────────

/**
 * The ambient `atmosphere` (STAGE.md's shape) under conditions `c` with the
 * sun at `sun` ({ azimuth, apparent, geometric }, solar.js's sunAt):
 *   - sky: the look's gradient;
 *   - fog: the horizon's colour, far 0.9 × the visibility in force
 *     (Koschmieder style), near the look's fraction of it, whole metres;
 *   - sun: toward the sun (azimuth and apparent elevation), always there, so
 *     the stage's own key light never stands in for it. It gives light iff
 *     the sun's geometric elevation is above -0.833° (the almanac's
 *     sunrise); its colour, and so its disc, fades to black there, rounding
 *     to #000000 a thousandth of a degree before (Decision 19).
 *     Shadows while the effective cover is under 0.75, the haze weight under
 *     0.5 and the sun more than 2° up;
 *   - exposure;
 *   - clouds: deckOf's deck, none in a clear sky or a fog.
 */
export function atmosphereAt(c, sun) {
  const e = sun.geometric;
  const l = skyAt(c, e);
  const horizon = toHex(l.horizon);
  const far = Math.round(0.9 * c.visibility);
  const out = {
    sky: { top: toHex(l.top), horizon, bottom: toHex(l.bottom) },
    fog: { color: horizon, near: Math.round(l.near * far), far },
    sun: {
      direction: sunDirection(sun.azimuth, sun.apparent),
      color: toHex(l.sun),
      intensity: l.intensity,
      shadows: c.ce < 0.75 && c.h < 0.5 && e > 2,
    },
    exposure: l.exposure,
  };
  const deck = deckOf(c);
  if (deck) out.clouds = deck;
  return out;
}

/** Where the sun is under the weather's params: solar.js at the params' instant and place. */
export const sunOf = (p) => sunAt(instantOf(p), p.lat, p.lon);

/** The ambient `atmosphere` of the weather's params (weatherParams'): pure, the same JSON on every peer. */
export const atmosphereOf = (p) => atmosphereAt(conditionsOf(p), sunOf(p));
