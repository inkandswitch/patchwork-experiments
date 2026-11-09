// What the ground looks like by height: a chart's palette, roughly (sand at
// the waterline, seabed greying and bluing with depth; land greening up from
// the beach and greying on the hills). Stops are sRGB hex; colourAt gives
// linear RGB, which is what a GLB's COLOR_0 holds.

import { hexToLinear } from "./glb.js";

const WATER = [
  [0, "#d6c99e"],
  [2, "#b3b48e"],
  [6, "#86a093"],
  [15, "#5f8592"],
  [40, "#41657e"],
  [100, "#2c4862"],
  [250, "#1c2f46"],
];
const LAND = [
  [0, "#ddd2a8"],
  [2, "#a7a675"],
  [6, "#7e9160"],
  [25, "#66804d"],
  [60, "#5c6f47"],
  [120, "#7b7865"],
  [250, "#97928a"],
];

const toRGB = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const ramp = (stops, x) => {
  if (x <= stops[0][0]) return toRGB(stops[0][1]);
  for (let k = 1; k < stops.length; k++) {
    if (x <= stops[k][0]) {
      const [x0, c0] = stops[k - 1], [x1, c1] = stops[k];
      const t = (x - x0) / (x1 - x0);
      const a = toRGB(c0), b = toRGB(c1);
      return a.map((v, i) => v + (b[i] - v) * t);
    }
  }
  return toRGB(stops.at(-1)[1]);
};

/** sRGB #rrggbb for a height (metres above mean water). */
export function hexAt(h) {
  const rgb = h >= 0 ? ramp(LAND, h) : ramp(WATER, -h);
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** Linear RGB (0..1) for a height. */
export const colourAt = (h) => hexToLinear(hexAt(h));

/** A legend for the scene's colour bar (README, GLB conventions): `count` stops evenly from min to max. */
export function legend(min, max, count = 32) {
  const stops = [];
  for (let k = 0; k < count; k++) stops.push(hexAt(min + ((max - min) * k) / (count - 1)));
  return { title: "Height above mean water", unit: "m", min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, stops };
}
