// What the ground looks like (look.js's colours): a natural palette, by
// height about mean water, what covers the ground there (cover.js) and the
// tide (the intertidal bands are set by the place's own tide levels, so a
// coast with a 4 m range is banded wider than one with 2 m). Colours are
// art direction for a Pacific Northwest rocky shore (the West Coast's: dark
// rock, rockweed, barnacles, black lichen, dark conifers to the waterline),
// sRGB hex; a place may override any of them (its doc's look.colours).
//
// Pure.

import { COVER } from "./cover.js";

export const COLOURS = Object.freeze({
  // the intertidal, by the tide's levels (below)
  kelp: "#2a3326",
  mussel: "#262729",
  rockweed: "#575027",
  barnacle: "#77746c",
  lichen: "#242322",
  rock: "#4f4d49",
  // the sea floor by depth (m)
  seabed: [[0, "#6b6550"], [3, "#4f5a48"], [10, "#34463f"], [30, "#243634"], [100, "#162426"], [300, "#0f1a1c"]],
  // land, by cover
  forestFloor: "#26331f",
  shrub: "#3e4a2c",
  lawn: "#5f6f45",
  yard: "#6c6961",
  grass: "#6f7f4a",
  bog: "#6d6a3f",
  beach: "#7d776c",
  bareRock: "#5a5854",
  lake: "#3b4a4e",
  // high, bare ground
  scree: "#7a776f",
});

const toRGB = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rampAt = (stops, x) => {
  if (x <= stops[0][0]) return toRGB(stops[0][1]);
  for (let k = 1; k < stops.length; k++) if (x <= stops[k][0]) return mix(toRGB(stops[k - 1][1]), toRGB(stops[k][1]), (x - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]));
  return toRGB(stops.at(-1)[1]);
};

/**
 * The intertidal and splash bands, by height about MWL: [top, colour key]
 * from the bottom up, from the place's tide (MLLW, MHHW; Cadboro's or
 * Ucluelet's). The splash zone's black lichen reaches about 1.8 m above
 * the highest normal tide; bare rock then runs to about 3 m above it.
 */
export function bands(tide = {}) {
  const mllw = tide.MLLW ?? -1.2, mhhw = tide.MHHW ?? 0.9, hhwlt = tide.HHWLT ?? 1.3;
  return [
    [mllw, "kelp"],
    [mllw + (0 - mllw) * 0.75, "mussel"],
    [mhhw * 0.5, "rockweed"],
    [mhhw, "barnacle"],
    [hhwlt + 1.1, "lichen"],
    [hhwlt + 3, "rock"],
  ];
}

/** A node-hash in [0, 1): the same node, the same value, everywhere. */
export function hash01(k, seed = 0) {
  let h = Math.imul((k ^ 0x9e3779b9) + seed * 0x85ebca6b, 0xcc9e2d51);
  h ^= h >>> 15;
  h = Math.imul(h, 0x1b873593);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The ground's sRGB (0–255) at a node.
 * @param {number} h  metres about MWL
 * @param {number} cover  a COVER code
 * @param {number} canopy  metres (0: none)
 * @param {object} tide  the datum's tide levels
 * @param {object} [colours]  COLOURS, with a place's overrides
 * @param {number} [k]  the node's index, for a little variation
 * @param {boolean} [shore]  whether the node is at the shore (the splash zone's bands above the tide are drawn only there)
 */
export function groundRGB(h, cover, canopy, tide, colours = COLOURS, k = 0, shore = true) {
  const C = colours;
  let rgb;
  // above the highest normal tide, the splash zone's bands belong to the shore only (low land inland is what covers it)
  const splash = shore || h <= (tide?.MHHW ?? 0.9);
  if (h < 0 && h < (tide?.MLLW ?? -1.2) - 0.6) rgb = rampAt(C.seabed.map(([d, c]) => [-d, c]).reverse(), h);
  else {
    const bs = bands(tide);
    const beachy = cover === COVER.beach;
    let band = null;
    for (const [top, key] of bs) if (h <= top) {
      band = key;
      break;
    }
    if (band && splash && !(beachy && h > 0) && !(band === "rock" && cover !== COVER.none && cover !== COVER.rock)) rgb = toRGB(C[band]);
    else if (cover === COVER.wood || (cover === COVER.none && canopy > 5)) rgb = toRGB(C.forestFloor);
    else if (cover === COVER.scrub) rgb = toRGB(C.shrub);
    else if (cover === COVER.residential) rgb = toRGB(C.lawn);
    else if (cover === COVER.yard) rgb = toRGB(C.yard);
    else if (cover === COVER.grass) rgb = toRGB(C.grass);
    else if (cover === COVER.wetland) rgb = toRGB(C.bog);
    else if (cover === COVER.beach) rgb = toRGB(C.beach);
    else if (cover === COVER.rock) rgb = toRGB(C.bareRock);
    else if (cover === COVER.lake) rgb = toRGB(C.lake);
    else rgb = h > 600 ? toRGB(C.scree) : toRGB(C.shrub);
  }
  // a little variation, by node, so a large flat area isn't one flat colour
  const v = k < 0 ? 1 : 0.94 + 0.12 * hash01(k, 7);
  return rgb.map((c) => Math.min(255, c * v));
}

/** sRGB 0–255 to linear 0–1 (what COLOR_0 holds). */
export const linear = (rgb) => rgb.map((c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
});

/** The legend for the scene's colour bar: height to colour on bare ground (no cover). */
export function naturalLegend(min, max, tide, colours = COLOURS, count = 32) {
  const stops = [];
  for (let k = 0; k < count; k++) {
    const h = min + ((max - min) * k) / (count - 1);
    stops.push("#" + groundRGB(h, 0, 0, tide, colours, -1).map((v) => Math.round(Math.min(255, v / 1)).toString(16).padStart(2, "0")).join(""));
  }
  return { title: "Ground by height above mean water (bare ground; land cover, forest and the intertidal bands from the tide)", unit: "m", min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, stops };
}
