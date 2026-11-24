// Colour legends for objects whose GLB says how it was coloured: a mesh's glTF
// `extras.legend` = { title, unit, min, max, stops: ["#rrggbb", …] }, stops
// evenly spaced from min to max (see README). The viewport checks it
// (sanitizeLegend); this turns it into what the overlay draws. Pure.

/** A tick label: up to 2 decimals, no trailing zeros, a real minus sign. */
export function formatTick(v) {
  const r = Math.round(v * 100) / 100;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(2).replace(/\.?0+$/, "");
  return s.replace(/^-/, "−");
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * A colour stop as it looks under a scene colour override: the viewport
 * multiplies the material colour into the baked vertex colours (in linear
 * light), so a "#4e5b73" override on a blue–red map draws it navy–maroon.
 * @param {string} stop  "#rrggbb"
 * @param {string} tint  "#rrggbb"
 */
export function tintStop(stop, tint) {
  const a = hexRgb(stop);
  const b = hexRgb(tint);
  return (
    "#" +
    a
      .map((v, i) => Math.round(255 * Math.min(1, Math.max(0, toSrgb(toLinear(v) * toLinear(b[i]))))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * @param {{ title: string, unit: string, min: number, max: number, stops: string[] }} legend  already sanitised
 * @param {string} name  the scene object's name
 * @param {string | null} [tint]  the object's colour override, "#rrggbb": the legend then shows the tinted colours
 * @returns {{ label: string, gradient: string, ticks: { at: number, text: string }[], tinted: boolean }}
 */
export function legendModel(legend, name, tint = null) {
  const { min, max } = legend;
  const tinted = typeof tint === "string" && /^#[0-9a-f]{6}$/i.test(tint);
  const stops = tinted ? legend.stops.map((c) => tintStop(c, tint)) : legend.stops;
  const parts = stops.map((c, i) => `${c} ${((100 * i) / (stops.length - 1)).toFixed(1)}%`);
  const quantity = legend.title ? (legend.unit ? `${legend.title} (${legend.unit})` : legend.title) : legend.unit;
  const label = [name, quantity].filter(Boolean).join(" · ");
  const ticks = [0, 0.5, 1].map((at) => ({ at, text: formatTick(min + at * (max - min)) }));
  return { label, gradient: `linear-gradient(to right, ${parts.join(", ")})`, ticks, tinted };
}
