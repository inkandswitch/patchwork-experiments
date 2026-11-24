// What covers the ground at each node: OpenStreetMap's land use and natural
// areas (look-osm.js) painted onto the grid, the larger first so a smaller
// area inside a larger one (a park in a residential zone, a lake in the
// woods) wins where they overlap; a multipolygon's holes are left as they
// were. Pure.

import { nodesInside } from "./burn.js";

/** The covers, by code (a byte a node). */
export const COVERS = Object.freeze(["none", "wood", "scrub", "residential", "yard", "grass", "wetland", "beach", "rock", "lake"]);
export const COVER = Object.freeze(Object.fromEntries(COVERS.map((c, k) => [c, k])));

/** |area| of a ring in (x, z). */
export function ringArea(pts) {
  let s = 0;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) s += pts[b][0] * pts[a][1] - pts[a][0] * pts[b][1];
  return Math.abs(s) / 2;
}

/**
 * @param {{ n, cell, x0, z0 }} grid
 * @param {{ areas: { cover, rings, holes }[] } | null} look
 * @returns {Uint8Array}  a COVER code at every node
 */
export function coverGrid(grid, look) {
  const out = new Uint8Array(grid.n * grid.n);
  if (!look?.areas?.length) return out;
  const areas = look.areas
    .filter((a) => COVER[a.cover] != null)
    .map((a) => ({ a, size: a.rings.reduce((s, r) => s + ringArea(r), 0) - (a.holes ?? []).reduce((s, r) => s + ringArea(r), 0) }))
    // the largest first; ties by id, so the order is the data's
    .sort((p, q) => q.size - p.size || (p.a.id < q.a.id ? -1 : p.a.id > q.a.id ? 1 : 0));
  for (const { a } of areas) {
    const code = COVER[a.cover];
    const hole = new Set();
    for (const r of a.holes ?? []) for (const k of nodesInside(grid, r)) hole.add(k);
    for (const r of a.rings) for (const k of nodesInside(grid, r)) if (!hole.has(k)) out[k] = code;
  }
  return out;
}

/**
 * Each land node's distance to the nearest water node (metres; 0 on
 * water), by a two-pass chamfer (3-4) over the grid: within 8% of the
 * Euclidean distance, never more than it by more than that. Pure.
 */
export function distanceToWater(n, label, cell) {
  const INF = 1e9;
  const d = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) d[k] = label[k] < 0 ? 0 : INF;
  const a = cell, b = cell * Math.SQRT2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - n] + a);
        if (i > 0) v = Math.min(v, d[k - n - 1] + b);
        if (i < n - 1) v = Math.min(v, d[k - n + 1] + b);
      }
      d[k] = v;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + a);
      if (j < n - 1) {
        v = Math.min(v, d[k + n] + a);
        if (i < n - 1) v = Math.min(v, d[k + n + 1] + b);
        if (i > 0) v = Math.min(v, d[k + n - 1] + b);
      }
      d[k] = v;
    }
  }
  return d;
}
