// The shore's bands, crisp (README, "The look"). The ground's colours are
// per vertex and its vertices are a cell apart (20 m at Ucluelet), so a
// band a metre or two high (the barnacles, the black lichen) smears across
// a whole cell into a broad wash, and a rocky shore reads as a mudflat.
// Instead, every ground triangle at the shore that spans a band's edge is
// cut along the levels where its height crosses them, into a piece a band,
// each piece one colour: the bands are sharp lines on the rock wherever the
// ground's own slope puts them, and nothing is added anywhere else.
//
// A piece's corners are the triangle's own vertices, or points on its
// edges where the height crosses a level. A point on an edge is made from
// the edge's two vertices taken lower id first and the level, so the two
// triangles either side of an edge make the very same point, to the bit
// (no cracks); the cut never moves the ground, only colours it.
//
// Pure.

import { bands } from "./palette.js";

/**
 * The shore's slabs, the bands from the water's surface up: [{ lo, hi, key,
 * wet }] from bands(tide). The first reaches down under the water (which
 * hides the ground there, so it needs no cut at the surface); `wet` is the
 * intertidal below half the highest normal tide (rockweed and below), drawn
 * darker.
 */
export function shoreSlabs(tide = {}) {
  const mhhw = tide.MHHW ?? 0.9;
  const out = [];
  let lo = -Infinity;
  for (const [top, key] of bands(tide)) {
    if (top <= 0) continue;
    out.push({ lo, hi: top, key, wet: top <= mhhw * 0.5 + 1e-9 });
    lo = top;
  }
  return out;
}

/** The levels slabs are cut at, ascending: slab q lies below levels[q], above levels[q − 1]. */
export const levelsOf = (slabs) => slabs.map((s) => s.hi);

/**
 * Cut a triangle by levels.
 * @param {number[]} h  its three corners' heights
 * @param {number[]} levels  ascending
 * @returns {{ slab: number, corners: ({ v: number } | { a: number, b: number, level: number })[] }[]}
 *   Slab q lies between levels[q − 1] and levels[q] (q = 0: below the first;
 *   q = levels.length: above the last). Each piece is a convex polygon with
 *   three corners or more, in the triangle's own winding: a corner is one
 *   of the triangle's ({ v }) or where edge a→b crosses a level.
 */
export function cutTriangle(h, levels) {
  const L = levels.length;
  const pieces = [];
  for (let q = 0; q <= L; q++) {
    const lo = q === 0 ? -Infinity : levels[q - 1], hi = q === L ? Infinity : levels[q];
    const corners = [];
    for (let u = 0; u < 3; u++) {
      const v = (u + 1) % 3;
      if (h[u] >= lo && h[u] <= hi) corners.push({ v: u });
      // where the edge crosses the slab's two levels, strictly inside it, in order from u to v
      const cs = [];
      for (const c of [lo, hi]) if (Number.isFinite(c) && ((h[u] < c && c < h[v]) || (h[v] < c && c < h[u]))) cs.push(c);
      if (cs.length === 2 && (h[u] < h[v]) !== cs[0] < cs[1]) cs.reverse();
      for (const c of cs) corners.push({ a: u, b: v, level: c });
    }
    if (corners.length < 3) continue;
    // a triangle flat on a level is in both slabs that meet there: it is the upper one's
    const at = (c) => ("v" in c ? h[c.v] : c.level);
    if (Number.isFinite(hi) && corners.every((c) => at(c) === hi)) continue;
    pieces.push({ slab: q, corners });
  }
  return pieces;
}

/**
 * Cut the shore's triangles of an indexed mesh.
 * @param {{ positions: Float32Array, normals: Float32Array, colors: Float32Array, triangles: Uint32Array | number[] }} mesh
 *   colors: each vertex's own (linear RGB)
 * @param {ArrayLike<number>} hv  each vertex's height (what the levels are in)
 * @param {ArrayLike<number>} id  each vertex's id (the grid node): what orders an edge's two ends
 * @param {number[]} levels  ascending
 * @param {(t: number) => boolean} shore  whether triangle t (its index) is at the shore: only those are painted
 * @param {(slab: number, t: number) => number[] | null} paint  a piece's colour (linear RGB), or null for the vertices' own
 *   (a point on an edge then takes the colour of the end on the piece's side). Every triangle spanning a
 *   level is cut, at the shore or not (so an edge is cut alike from both sides: no T-junctions); away from
 *   the shore a point on an edge takes the colour between its ends, so those pieces look as the triangle did.
 * @returns {{ positions: Float32Array, normals: Float32Array, colors: Float32Array, triangles: Uint32Array, cut: number, pieces: number, added: number }}
 *   The triangles not cut keep their vertices, as does a piece in the vertices' own colours; every other
 *   corner is a new vertex, shared by the pieces that make the same point in the same colour. Each piece
 *   is fanned from its first corner.
 */
export function cutShore(mesh, hv, id, levels, shore, paint) {
  const { positions, normals, colors, triangles } = mesh;
  const V = positions.length / 3;
  const P = Array.from(positions), Nn = Array.from(normals), C = Array.from(colors);
  const tris = [];
  let cut = 0, pieces = 0;
  // a piece's vertex is shared with every other piece that makes the same point in the same colour
  const made = new Map();
  const vert = (key, p, nrm, c) => {
    let v = made.get(key);
    if (v != null) return v;
    v = P.length / 3;
    P.push(p[0], p[1], p[2]);
    Nn.push(nrm[0], nrm[1], nrm[2]);
    C.push(c[0], c[1], c[2]);
    made.set(key, v);
    return v;
  };
  const get = (arr, v) => [arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]];
  for (let t = 0; t < triangles.length; t += 3) {
    const vs = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const h = vs.map((v) => hv[v]);
    const lo = Math.min(...h), hi = Math.max(...h);
    if (!levels.some((c) => lo < c && c < hi)) {
      tris.push(...vs);
      continue;
    }
    // every triangle that spans a level is cut, so no edge is cut on one side and whole on the other (no T-junctions);
    // only the shore's are painted, the rest keep their colours exactly (a point on an edge takes the colour between its ends)
    const atShore = shore(t / 3);
    cut++;
    for (const piece of cutTriangle(h, levels)) {
      const flat = atShore ? paint(piece.slab, t / 3) : null;
      const tag = flat ? flat.join(",") : "own";
      const sLo = piece.slab === 0 ? -Infinity : levels[piece.slab - 1];
      const corners = piece.corners.map((c) => {
        if ("v" in c) {
          const v = vs[c.v];
          // the vertex's own colour: the vertex itself
          return flat ? vert(`${v}|${tag}`, get(P, v), get(Nn, v), flat) : v;
        }
        // the edge's ends, lower id first: both triangles on the edge make this point alike
        let a = vs[c.a], b = vs[c.b];
        if (id[b] < id[a]) [a, b] = [b, a];
        const s = (c.level - hv[a]) / (hv[b] - hv[a]);
        // its colour: the piece's; else at the shore the end's on the piece's side (it lies above the level it starts at, below the one it ends at); else between its ends
        const up = hv[a] > hv[b] ? a : b, down = up === a ? b : a;
        const side = c.level === sLo ? up : down;
        const key = `${a}-${b}@${c.level}|${flat ? tag : atShore ? side : "lerp"}`;
        if (made.has(key)) return made.get(key);
        const pa = get(P, a), pb = get(P, b), na = get(Nn, a), nb = get(Nn, b), ca = get(C, a), cb = get(C, b);
        const m = [na[0] + (nb[0] - na[0]) * s, na[1] + (nb[1] - na[1]) * s, na[2] + (nb[2] - na[2]) * s];
        const len = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) || 1;
        const colour = flat ?? (atShore ? get(C, side) : [ca[0] + (cb[0] - ca[0]) * s, ca[1] + (cb[1] - ca[1]) * s, ca[2] + (cb[2] - ca[2]) * s]);
        return vert(key, [pa[0] + (pb[0] - pa[0]) * s, pa[1] + (pb[1] - pa[1]) * s, pa[2] + (pb[2] - pa[2]) * s], [m[0] / len, m[1] / len, m[2] / len], colour);
      });
      for (let k = 1; k + 1 < corners.length; k++) tris.push(corners[0], corners[k], corners[k + 1]);
      pieces++;
    }
  }
  return { positions: Float32Array.from(P), normals: Float32Array.from(Nn), colors: Float32Array.from(C), triangles: Uint32Array.from(tris), cut, pieces, added: P.length / 3 - V };
}
