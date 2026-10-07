// Colormaps and value ranges. Pure. Colours come out as sRGB 0..1; glTF's
// COLOR_0 wants linear, so use `toLinear` before baking.

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

const STOPS = {
  viridis: [
    "#440154", "#482475", "#414487", "#355f8d", "#2a788e", "#21918c",
    "#22a884", "#44bf70", "#7ad151", "#bddf26", "#fde725",
  ].map(hex),
  // Moreland's smooth cool-warm diverging map
  coolwarm: [
    [59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221],
    [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38],
  ].map((c) => c.map((v) => v / 255)),
};

function turbo(t) {
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return [r, g, b].map((v) => Math.min(1, Math.max(0, v)));
}

export const COLORMAPS = Object.freeze(["viridis", "coolwarm", "turbo"]);

/** The map used when colormap is "auto": sequential for speed, diverging for Cp. */
export function autoColormap(colorBy) {
  return colorBy === "cp" ? "coolwarm" : "viridis";
}

/** sRGB [r, g, b] (0..1) for t ∈ [0, 1] (clamped; NaN → 0). */
export function sampleColormap(name, t) {
  const u = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  if (name === "turbo") return turbo(u);
  const stops = STOPS[name] ?? STOPS.viridis;
  const f = u * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const w = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function toLinear(rgb) {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

export function cssColor(rgb) {
  return `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")})`;
}

/**
 * A robust range for a set of values: the lo/hi percentiles, so a few samples
 * next to a singularity don't wash everything else out. Always lo < hi.
 */
export function robustRange(values, lo = 0.02, hi = 0.98) {
  const finite = [];
  for (const v of values) if (Number.isFinite(v)) finite.push(v);
  if (finite.length === 0) return [0, 1];
  finite.sort((a, b) => a - b);
  const pick = (q) => finite[Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))];
  let a = pick(lo);
  let b = pick(hi);
  if (!(b > a)) {
    const pad = Math.max(1e-6, Math.abs(a) * 0.05);
    a -= pad;
    b += pad;
  }
  return [a, b];
}

/**
 * The colour range a build uses: explicit when autoRange is off (and valid),
 * otherwise robust over the values.
 */
export function resolveRange(values, { autoRange = true, colorMin, colorMax, symmetric = false } = {}) {
  if (!autoRange && Number.isFinite(colorMin) && Number.isFinite(colorMax) && colorMax !== colorMin) {
    return colorMin < colorMax ? [colorMin, colorMax] : [colorMax, colorMin];
  }
  const r = robustRange(values);
  return symmetric ? symmetricRange(r) : r;
}

/** [−a, a] covering a range: so a diverging map's midpoint lands on 0. */
export function symmetricRange([lo, hi]) {
  const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
  return [-a, a];
}

/** Maps whose middle means "nothing happening", which want a range centred on 0. */
export function isDiverging(name) {
  return name === "coolwarm";
}

/** Bake linear RGB per value into a flat Float32Array (itemSize 3). */
export function bakeColors(values, [lo, hi], name) {
  const out = new Float32Array(values.length * 3);
  const span = hi - lo || 1;
  for (let i = 0; i < values.length; i++) {
    const c = toLinear(sampleColormap(name, (values[i] - lo) / span));
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

/** `n` evenly spaced sRGB hex colours along a map, for a legend. */
export function legendStops(name, n = 9) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = sampleColormap(name, n === 1 ? 0.5 : i / (n - 1));
    out.push("#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join(""));
  }
  return out;
}

/**
 * A legend a scene can draw without knowing about flow fields: the glTF mesh
 * `extras.legend` convention (see scene/README.md). `stops` are sRGB hex,
 * evenly spaced from `min` to `max`.
 */
export function legendFor(colorBy, range, cmap) {
  return {
    title: colorBy === "cp" ? "Pressure coefficient Cp" : "Speed",
    unit: colorBy === "cp" ? "" : "m/s",
    min: range[0],
    max: range[1],
    stops: legendStops(cmap, 9),
  };
}

/** As bakeColors, with a per-value alpha: linear RGBA (itemSize 4). */
export function bakeColorsAlpha(values, range, name, alpha) {
  const rgb = bakeColors(values, range, name);
  const out = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = alpha[i];
  }
  return out;
}
