// Surf on the exposed coast (README, "The look"): white water along the
// stretches of shore open to the swell. Dressing, not data: nobody maps
// where the sea breaks, so it is drawn where the place's own shape says it
// must, from the place's swell (its doc's `swell.from`) and its heights.
//
// - The coastline (OSM's, joined: coast.js) is cut into pieces no longer
//   than a cell. A piece's sea side is the side the grid says is water a
//   cell out (a piece with water on both sides or neither is left alone).
// - Its exposure is the share of `rays` rays, fanned ±`spread`° about the
//   direction the swell comes from, that leave it over open water for
//   `reach` metres (or leave the grid over water) without touching land.
//   The fan is wide (±75°: a swell bends round a headland onto the shores
//   beside it); a piece whose sea side faces further than about 100° from
//   the swell's direction has none.
// - Where the exposure is at least `min`, a band of foam lies along it on
//   the water, from just inside the shore out to 4 + 12·exposure metres,
//   broken into dashes by a hash of where it is; a sheet of spray stands
//   on the dash, white at the water and greying by 0.5 + 1.5·exposure
//   metres up (a flat band alone is a hairline from a boat a few hundred metres
//   off: surf is seen by its height); and a fainter line of lace further
//   out where the exposure is high. Every number is art
//   direction; every choice is a function of the piece alone, so the surf
//   of the whole coast is the union of its pieces' (tested).
//
// The mesh is an opaque triangle soup, drawn unlit: the foam's own colour
// (#e4ebe8 by default), as bright under a grey sky as it is, fading to the
// sea's grey-green at its edges.
//
// Pure.

import { hash01 } from "./palette.js";
import { dsin, dcos, len } from "./detmath.js";
import { hexToLinear } from "./glb.js";

export const SURF = Object.freeze({ spread: 75, facing: -0.17, rays: 9, reach: 3000, min: 0.35, colour: "#e4ebe8", fade: "#5f6e6e", y: 0.3 });

/** The label of the node nearest (x, z): +1 land, −1 water, 0 untold or outside the grid (outside: null). */
function labelAt(grid, label, x, z) {
  const i = Math.round((x - grid.x0) / grid.cell), j = Math.round((z - grid.z0) / grid.cell);
  if (i < 0 || j < 0 || i >= grid.n || j >= grid.n) return null;
  return label[j * grid.n + i];
}

/** A unit vector toward where the swell comes from, `from` degrees true (x east, z south). */
export const toward = (from) => [dsin((from * Math.PI) / 180), -dcos((from * Math.PI) / 180)];

/**
 * The share of rays from (x, z), fanned about the swell's direction, that
 * reach `reach` metres over water (or leave the grid over water) without
 * touching land, stepping half a cell.
 */
export function exposure(grid, label, x, z, from, { spread = SURF.spread, rays = SURF.rays, reach = SURF.reach } = {}) {
  const step = grid.cell / 2;
  let open = 0;
  for (let r = 0; r < rays; r++) {
    const a = from + (rays > 1 ? -spread + (2 * spread * r) / (rays - 1) : 0);
    const [dx, dz] = toward(a);
    let ok = true;
    for (let d = step; d <= reach; d += step) {
      const l = labelAt(grid, label, x + dx * d, z + dz * d);
      if (l === null) break;
      if (l > 0) {
        ok = false;
        break;
      }
    }
    if (ok) open++;
  }
  return open / rays;
}

/**
 * The coastline's pieces, each no longer than a cell, with its sea side and
 * its exposure: [{ a: [x, z], b: [x, z], sea: [nx, nz], exposure, key }].
 * @param {{ points: number[][], ids: string[] }[]} chains  coast.js joinCoast()
 */
export function coastPieces(chains, grid, label, from, o = {}) {
  const facingMin = o.facing ?? SURF.facing;
  const out = [];
  for (const c of chains) {
    const pts = c.points;
    for (let q = 0; q + 1 < pts.length; q++) {
      const [ax, az] = pts[q], [bx, bz] = pts[q + 1];
      const L = len(bx - ax, bz - az);
      if (!(L > 0)) continue;
      const m = Math.max(1, Math.ceil(L / grid.cell));
      for (let s = 0; s < m; s++) {
        const a = [ax + ((bx - ax) * s) / m, az + ((bz - az) * s) / m], b = [ax + ((bx - ax) * (s + 1)) / m, az + ((bz - az) * (s + 1)) / m];
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        // the side the grid says is water a cell out
        const left = labelAt(grid, label, mx + uz * grid.cell, mz - ux * grid.cell), right = labelAt(grid, label, mx - uz * grid.cell, mz + ux * grid.cell);
        let sea = null;
        if (left != null && right != null && left < 0 && right > 0) sea = [uz, -ux];
        else if (left != null && right != null && right < 0 && left > 0) sea = [-uz, ux];
        if (!sea) continue;
        const [tx, tz] = toward(from);
        // facing away from the swell: none
        const facing = sea[0] * tx + sea[1] * tz;
        const e = facing <= facingMin ? 0 : exposure(grid, label, mx + sea[0] * grid.cell, mz + sea[1] * grid.cell, from, o);
        out.push({ a, b, sea, exposure: e, key: `${c.ids[0]}#${q}.${s}` });
      }
    }
  }
  return out;
}

/** A string's hash in [0, 1). */
function hashKey(key, seed) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return hash01(h >>> 0, seed);
}

/**
 * The foam along the exposed pieces, as a soup with RGBA colours (linear):
 * { positions, colors (linear RGB), pieces, dashes }. Opaque: each vertex
 * the foam's colour mixed toward `fade` (the water's own grey-green under
 * an overcast) by how far it is from the white of it, so the dashes fade
 * into the sea without blending (a blended soup at the water's surface
 * didn't show in the stage: drawn opaque, it does).
 */
export function surfMesh(pieces, { min = SURF.min, colour = SURF.colour, fade = SURF.fade, y = SURF.y } = {}) {
  const P = [], C = [];
  const white = hexToLinear(colour), sea = hexToLinear(fade);
  const mixed = (w) => [0, 1, 2].map((e) => sea[e] + (white[e] - sea[e]) * w);
  const strip = (a, bb, sea, inner, outer, alphaIn, alphaOut) => {
    const p = (q, d) => [q[0] + sea[0] * d, y, q[1] + sea[1] * d];
    const A0 = p(a, inner), B0 = p(bb, inner), A1 = p(a, outer), B1 = p(bb, outer);
    // up-facing: the sea side is to the right of a→b or the left; wind each triangle up
    const tri = (u, v, w, au, av, aw) => {
      const cross = (v[0] - u[0]) * (w[2] - u[2]) - (v[2] - u[2]) * (w[0] - u[0]);
      const [V, W, aV, aW] = cross < 0 ? [v, w, av, aw] : [w, v, aw, av];
      P.push(...u, ...V, ...W);
      C.push(...mixed(au), ...mixed(aV), ...mixed(aW));
    };
    tri(A0, B0, B1, alphaIn, alphaIn, alphaOut);
    tri(A0, B1, A1, alphaIn, alphaOut, alphaOut);
  };
  const spray = (a, bb, sea, off, top) => {
    const A0 = [a[0] + sea[0] * off, -0.2, a[1] + sea[1] * off], B0 = [bb[0] + sea[0] * off, -0.2, bb[1] + sea[1] * off];
    // leaning a metre onto the rock
    const A1 = [a[0] + sea[0] * (off - 1), top, a[1] + sea[1] * (off - 1)], B1 = [bb[0] + sea[0] * (off - 1), top, bb[1] + sea[1] * (off - 1)];
    P.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
    for (const w of [1, 1, 0.55, 1, 0.55, 0.55]) C.push(...mixed(w));
  };
  let used = 0, dashes = 0;
  for (const pc of pieces) {
    if (pc.exposure < min) continue;
    used++;
    const e = pc.exposure;
    // the piece in two dashes, each there or not by its own hash, and the gap's place
    for (let d = 0; d < 2; d++) {
      const k = `${pc.key}/${d}`;
      if (hashKey(k, 1) > 0.55 + 0.4 * e) continue;
      const t0 = d * 0.5 + 0.1 * hashKey(k, 2), t1 = d * 0.5 + 0.4 + 0.1 * hashKey(k, 3);
      const a = [pc.a[0] + (pc.b[0] - pc.a[0]) * t0, pc.a[1] + (pc.b[1] - pc.a[1]) * t0];
      const bb = [pc.a[0] + (pc.b[0] - pc.a[0]) * t1, pc.a[1] + (pc.b[1] - pc.a[1]) * t1];
      const reachOut = 4 + 12 * e * (0.7 + 0.6 * hashKey(k, 4));
      // the surge, white against the rock, fading out
      strip(a, bb, pc.sea, -1.5, reachOut, 1, 0);
      // the spray standing on it: white at the water, gone at the top
      spray(a, bb, pc.sea, 1 + 2 * e * hashKey(k, 7), 0.5 + 1.5 * e * (0.6 + 0.4 * hashKey(k, 8)));
      dashes++;
      // the lace further out, where it is open
      if (e >= 0.6 && hashKey(k, 5) < e) {
        const at = reachOut + 4 + 8 * hashKey(k, 6);
        strip(a, bb, pc.sea, at, at + 2 + 2 * e, 0.55, 0);
        dashes++;
      }
    }
  }
  return { positions: new Float32Array(P), colors: new Float32Array(C), pieces: used, dashes };
}
