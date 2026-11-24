// The atmosphere (CONVENTIONS.md, "Atmosphere"): the world ambient the
// viewport draws, as a value. What an offered value is once checked, the
// lights it implies, and the cloud deck the sky shader draws, worked in JS.
// Pure: plain data, no three.js. ./sky.js draws what this decides.

/**
 * The stage's own lights, which no atmosphere is exactly (intensities, and
 * the key light's direction from the origin): a white key light fixed in
 * the world, high and to one side, so a faceted part's faces take different
 * shades as the view turns; a weak headlight on the camera, so nothing
 * facing it goes black; a dim sky/ground light and environment for a little
 * modelling and something for metals to reflect. A face lit by all of them
 * stays near 1, so light albedos keep their colour instead of clipping.
 */
export const LIGHTS = Object.freeze({ key: 1.5, keyFrom: [0.45, 1, 0.6], headlight: 0.45, hemisphere: 0.35, environment: 0.35 });

/** A cloud deck's defaults: how far it moves the sky's luminance either way; its cells' size and its height, metres. */
export const CLOUDS = Object.freeze({ contrast: 0.1, scale: 600, base: 800 });

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** An sRGB hex colour as given ("#rgb", "#rrggbb" or a number), or null. */
function hexColour(v) {
  if (typeof v === "string" && HEX.test(v.trim())) return v.trim().toLowerCase();
  if (Number.isInteger(v) && v >= 0 && v <= 0xffffff) return `#${v.toString(16).padStart(6, "0")}`;
  return null;
}
const finite = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * An atmosphere made safe to draw: colours checked, numbers finite, the
 * sun's direction a unit vector; whatever can't be used is left out, and
 * nothing usable at all is null. A sky missing a colour takes a
 * neighbour's; fog without a colour takes the sky's horizon; a sun without
 * a direction stands where the key light does. Clouds (over a sky only)
 * need a cover over 0; their contrast, scale and base default to CLOUDS'.
 * @returns {{ sky?: { top, horizon, bottom }, fog?: { color, near, far }, sun?: { direction, color, intensity, shadows }, exposure?: number, clouds?: { cover, contrast, scale, base } } | null}
 */
export function cleanAtmosphere(a) {
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
    out.sun = {
      direction: from.map((v) => v / n),
      color: hexColour(a.sun.color) ?? "#ffffff",
      intensity: intensity != null && intensity >= 0 ? intensity : LIGHTS.key,
      shadows: a.sun.shadows === true,
    };
  }
  const exposure = finite(a.exposure);
  if (exposure != null && exposure > 0) out.exposure = exposure;
  // clouds over a sky: cover in (0, 1], contrast in (0, 0.5], scale and base positive metres
  if (out.sky && a.clouds && typeof a.clouds === "object") {
    const cover = finite(a.clouds.cover), contrast = finite(a.clouds.contrast) ?? CLOUDS.contrast, scale = finite(a.clouds.scale) ?? CLOUDS.scale, base = finite(a.clouds.base) ?? CLOUDS.base;
    if (cover != null && cover > 0 && contrast > 0 && scale > 0 && base > 0) out.clouds = { cover: Math.min(1, cover), contrast: Math.min(0.5, contrast), scale, base };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * How a cloud deck changes the sky's luminance in direction `d` (unit, y up):
 * the direction carried up to a deck `base` metres overhead, two octaves of
 * value noise over it in cells `scale` across (`noise(x, z)` in [0, 1]: the
 * shader's own); an overcast (cover 1) every part of it, ±`contrast`; a sky
 * of scattered cloud (cover under 1) only the noise's top `cover`, brighter
 * overhead and darker underneath toward the horizon; faded out toward the
 * horizon (where the deck's cells shrink under a pixel and the fog takes
 * over), and nothing below it. A factor in [1 − contrast, 1 + contrast], and
 * how white (0 to 1) a scattered cloud makes the sky there. The sky
 * shader's own working (./sky.js), tested over directions and covers.
 */
export function cloudAt(d, { cover, contrast, scale, base }, noise) {
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

/**
 * The lights a clean atmosphere asks for. No atmosphere is exactly the
 * stage's own (LIGHTS). A sun replaces the key light (its direction,
 * colour, strength, shadows), and the headlight dims to a third, since a
 * full one would fill the sun's shadows in; a sky tints the sky/ground
 * light with its top and bottom; exposure scales every light.
 */
export function lighting(atm) {
  const x = atm?.exposure ?? 1;
  return {
    hemisphere: { intensity: LIGHTS.hemisphere * x, sky: atm?.sky?.top ?? "#ffffff", ground: atm?.sky?.bottom ?? "#3a3a3a" },
    key: {
      intensity: (atm?.sun?.intensity ?? LIGHTS.key) * x,
      color: atm?.sun?.color ?? "#ffffff",
      from: atm?.sun ? [...atm.sun.direction] : [...LIGHTS.keyFrom],
      shadows: !!atm?.sun?.shadows,
    },
    headlight: (atm?.sun ? LIGHTS.headlight / 3 : LIGHTS.headlight) * x,
    environment: LIGHTS.environment * x,
  };
}

/** What shows where nothing is drawn: fog's colour when there is fog and no sky, else null (the theme's background). */
export function clearColourOf(atm) {
  return atm?.fog && !atm.sky ? atm.fog.color : null;
}
