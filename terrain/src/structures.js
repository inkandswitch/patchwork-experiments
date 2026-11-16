// Harbour structures from OSM, extruded: floats (man_made=pier,
// floating=yes) as low pontoons among their tall black guide piles, fixed piers as decks above the
// highest tide (a slab: the piles aren't drawn), breakwaters as rock walls,
// groynes as low walls. An area
// is extruded as drawn; a line is widened (its width tag, else the kind's).
// Heights are above mean water level (the floats don't ride the tide).

import { hashString } from "./buildings.js";
import { soup, prism, widen, cylinder } from "./shapes.js";

export const KINDS = Object.freeze({
  float: { width: 2.4, top: 0.5, bottom: -0.6, colour: "#a8a398", piles: { every: 15, top: [5, 7], colour: "#2e2721", r: 0.22 } },
  pier: { width: 3, top: 2.8, bottom: 2.0, colour: "#7a7368" },
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
    const width = st.width > 0 && st.width < 50 ? st.width : k.width;
    const ring = st.area ? st.points : widen(st.points, width);
    if (ring && prism(s, ring, k.bottom, k.top, k.colour)) made++;
    else skipped.push(st.id);
    if (k.piles && !st.area) floatPiles(s, st, width, k.piles, inside);
  }
  return { ...s.done(), made, skipped };
}

/**
 * A float's guide piles: tall, black, creosoted, through hoops at its edges
 * every `every` metres along each side (alternating sides, so a slip has one
 * either end), from well under the water to `top` (a range: by hash of the
 * float's id and the pile), as a harbour's floats stand among them.
 */
export function floatPiles(s, st, width, { every, top: [t0, t1], colour, r }, inside = () => true) {
  let q = 0;
  for (let p = 0; p + 1 < st.points.length; p++) {
    const [ax, az] = st.points[p], [bx, bz] = st.points[p + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const n = Math.max(1, Math.round(L / every));
    for (let i = 0; i <= n; i++, q++) {
      if (i === n && p + 2 < st.points.length) continue; // the next leg's first
      const side = q % 2 ? 1 : -1, off = width / 2 - 0.1;
      const x = ax + ux * L * (i / n) - uz * off * side, z = az + uz * L * (i / n) + ux * off * side;
      if (!inside(x, z)) continue;
      cylinder(s, x, z, -6, t0 + (t1 - t0) * hashString(`${st.id}#${q}`, 9), r, r * 0.9, colour, 6);
    }
  }
  return q;
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
