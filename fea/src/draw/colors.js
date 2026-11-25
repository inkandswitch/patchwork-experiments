// Colour for a field's values. Pure. Colours are sRGB 0..1 here; glTF's
// COLOR_0 and three's vertex colours want linear, so bake with `linear`.
//
// One map, "turbo" (Mikhailov, 2019): the blue-to-red a stress plot is
// expected to be, without the false bands of the old rainbow.

export function turbo(t) {
  const u = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const r = 0.13572138 + u * (4.6153926 + u * (-42.66032258 + u * (132.13108234 + u * (-152.94239396 + u * 59.28637943))));
  const g = 0.09140261 + u * (2.19418839 + u * (4.84296658 + u * (-14.18503333 + u * (4.27729857 + u * 2.82956604))));
  const b = 0.1066733 + u * (12.64194608 + u * (-60.58204836 + u * (110.36276771 + u * (-89.90310912 + u * 27.34824973))));
  return [r, g, b].map((v) => Math.min(1, Math.max(0, v)));
}

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const hex = (rgb) => "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

/** Linear RGB a value, flat (three a value), over [lo, hi]. */
export function bake(values, [lo, hi]) {
  const out = new Float32Array(values.length * 3);
  const span = hi - lo || 1;
  for (let i = 0; i < values.length; i++) {
    const c = turbo((values[i] - lo) / span);
    out[i * 3] = srgbToLinear(c[0]);
    out[i * 3 + 1] = srgbToLinear(c[1]);
    out[i * 3 + 2] = srgbToLinear(c[2]);
  }
  return out;
}

/** `n` evenly spaced sRGB hex colours along the map, for a legend. */
export function stops(n = 9) {
  return Array.from({ length: n }, (_, i) => hex(turbo(n === 1 ? 0.5 : i / (n - 1))));
}
