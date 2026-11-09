// Harbour structures from OSM, extruded: floats (man_made=pier,
// floating=yes) as low pontoons, fixed piers as decks above the
// highest tide (a slab: the piles aren't drawn), breakwaters as rock walls,
// groynes as low walls. An area
// is extruded as drawn; a line is widened (its width tag, else the kind's).
// Heights are above mean water level (the floats don't ride the tide).

import { soup, prism, widen } from "./shapes.js";

export const KINDS = Object.freeze({
  float: { width: 2.4, top: 0.5, bottom: -0.6, colour: "#a8a398" },
  pier: { width: 3, top: 2.8, bottom: 2.0, colour: "#8b7558" },
  breakwater: { width: 8, top: 3, bottom: -6, colour: "#8d877c" },
  groyne: { width: 3, top: 1.5, bottom: -2, colour: "#807a6e" },
});

export const kindOf = (s) => (s.kind === "pier" ? (s.floating ? "float" : "pier") : s.kind);

/**
 * @param {{ id, kind, floating, area, width, points }[]} structures
 * @param {{ inside?: (x: number, z: number) => boolean }} [o]  keep only structures with a point inside (the grid)
 * @returns {{ positions: Float32Array, colors: Float32Array, made: number, skipped: string[] }}
 */
export function structureMesh(structures, { inside = () => true } = {}) {
  const s = soup();
  let made = 0;
  const skipped = [];
  for (const st of structures) {
    if (!st.points.some(([x, z]) => inside(x, z))) continue;
    const k = KINDS[kindOf(st)];
    if (!k) continue;
    const ring = st.area ? st.points : widen(st.points, st.width > 0 && st.width < 50 ? st.width : k.width);
    if (ring && prism(s, ring, k.bottom, k.top, k.colour)) made++;
    else skipped.push(st.id);
  }
  return { ...s.done(), made, skipped };
}

export const ROCK = Object.freeze({ colour: "#7a7267" });

/**
 * OSM islets too small to hold a node of the grid (burn.js), as rocks: each
 * ring extruded from below the bottom round it to its top.
 * @param {{ id, top, points }[]} rocks
 * @param {(x: number, z: number) => number | null} groundAt  the heightfield (metres), null off the grid
 * @param {(y: number) => number} [yOf]  the vertical exaggeration of land
 */
export function rockMesh(rocks, groundAt, yOf = (y) => y) {
  const s = soup();
  let made = 0;
  for (const r of rocks) {
    let bottom = Infinity;
    for (const [x, z] of r.points) {
      const g = groundAt(x, z);
      if (g != null) bottom = Math.min(bottom, g);
    }
    if (!Number.isFinite(bottom)) bottom = 0;
    if (prism(s, r.points, Math.min(bottom, 0) - 0.5, yOf(r.top), ROCK.colour)) made++;
  }
  return { ...s.done(), made };
}
