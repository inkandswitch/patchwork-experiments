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
// - Where the exposure is at least `min`, a ribbon of foam lies along the
//   shore on the water, continuous along each run of exposed pieces (both
//   pieces sharing an end agree on its width and direction: endOf), 2 to 12
//   m wide by the exposure and a hash of the point, tapering to nothing at
//   a run's ends, white to under half its width and fading to the sea's
//   grey-green in two steps; a sheet of spray stands along it, white at the
//   water and greying by its top, 0.4 to 2 m up (a flat band alone is a
//   hairline from a boat a few hundred metres off: surf is seen by its
//   height); and a fainter, broken line of lace further out where the
//   exposure is high.
// - Over the shallows (under 2.5 m) where the swell gets in, irregular
//   patches of white water (reefPatches); black boulders at the waterline
//   of the most exposed shore (boulders).
//
// Every number is art direction; every choice is a function of a piece and
// its ends, or of a node, alone, so the surf of the whole coast is the
// union of its pieces' (tested).
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
 * The coastline's pieces, each no longer than a cell, with its sea side,
 * its exposure and its neighbours along the coast (the pieces before and
 * after it on its chain, a closed chain's last running on to its first; null
 * where there is none, or none with a sea side): [{ a: [x, z], b: [x, z],
 * sea: [nx, nz], exposure, key, prev, next }], prev and next each
 * { exposure, sea } or null.
 * @param {{ points: number[][], ids: string[], closed?: boolean }[]} chains  coast.js joinCoast()
 */
export function coastPieces(chains, grid, label, from, o = {}) {
  const facingMin = o.facing ?? SURF.facing;
  const out = [];
  for (const c of chains) {
    const pts = c.points;
    const along = [];
    const segs = c.closed && pts.length >= 3 ? pts.length : pts.length - 1;
    for (let q = 0; q < segs; q++) {
      const [ax, az] = pts[q], [bx, bz] = pts[(q + 1) % pts.length];
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
        if (!sea) {
          along.push(null);
          continue;
        }
        const [tx, tz] = toward(from);
        // facing away from the swell: none
        const facing = sea[0] * tx + sea[1] * tz;
        const e = facing <= facingMin ? 0 : exposure(grid, label, mx + sea[0] * grid.cell, mz + sea[1] * grid.cell, from, o);
        along.push({ a, b, sea, exposure: e, key: `${c.ids[0]}#${q}.${s}`, prev: null, next: null });
      }
    }
    const ring = c.closed && along.length > 2;
    along.forEach((p, q) => {
      if (!p) return;
      const before = q > 0 ? along[q - 1] : ring ? along.at(-1) : null, after = q + 1 < along.length ? along[q + 1] : ring ? along[0] : null;
      p.prev = before ? { exposure: before.exposure, sea: before.sea } : null;
      p.next = after ? { exposure: after.exposure, sea: after.sea } : null;
      out.push(p);
    });
  }
  return out;
}

/** A string's hash in [0, 1). */
function hashKey(key, seed) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return hash01(h >>> 0, seed);
}

/** A point's key, to the decimetre: the same for both pieces that share it. */
const pointKey = ([x, z]) => `${Math.round(x * 10)},${Math.round(z * 10)}`;

/**
 * Where a piece's end stands in the foam: its exposure (the mean of the two
 * pieces that share it, both at least `min`; 0 where the neighbour isn't, so
 * a run of foam tapers to a point at its ends), the direction it is pushed
 * out to sea (the two pieces' sea sides averaged) and how much further a
 * point goes along it so the band keeps its width round a bend (at most
 * 1.5×), and two hashes of the point. Both pieces that share an end get the
 * same answer: the foam is one ribbon along the shore, not dashes.
 */
export function endOf(pc, end, min = SURF.min) {
  const other = end === "a" ? pc.prev : pc.next;
  const p = end === "a" ? pc.a : pc.b;
  const joined = other && other.exposure >= min;
  const sx = joined ? pc.sea[0] + other.sea[0] : pc.sea[0], sz = joined ? pc.sea[1] + other.sea[1] : pc.sea[1];
  const l = len(sx, sz) || 1;
  const nrm = [sx / l, sz / l];
  const miter = Math.min(1.5, 1 / Math.max(1e-6, nrm[0] * pc.sea[0] + nrm[1] * pc.sea[1]));
  const key = pointKey(p);
  return { p, nrm, miter, e: joined ? (pc.exposure + other.exposure) / 2 : 0, u: hashKey(key, 11), v: hashKey(key, 12) };
}

/** The foam's width at an end: 0 at a run's tip, else 2 to 12 m by its exposure and its hash. */
export const widthAt = (end) => (end.e > 0 ? 2 + 10 * Math.min(1, end.e * (0.5 + end.u)) : 0);

/**
 * The foam along the exposed pieces, as a soup with RGB colours (linear):
 * { positions, colors, pieces, runs }. Along every piece exposed at least
 * `min`, a band on the water from 1.5 m inside the shore out to its width
 * (widthAt, at each end: the band is continuous along a run of exposed
 * pieces, its width varying along it); white to just under half of it,
 * then through the sea's grey-green in two steps (0.55 of the way to white
 * at three quarters, the sea's at the edge), so the foam fades into the
 * water. A sheet of spray stands along it, leaning onto the rock, white at
 * the water and greying by its top, 0.4 + 1.6·exposure metres by hash (a
 * flat band alone is a hairline from a boat a few hundred metres off: surf
 * is seen by its height); and a fainter line of lace further out, broken by
 * hash, where the exposure is 0.6 or more. Opaque: blending at the water's
 * surface didn't show in the stage. Each piece's foam is its own and its
 * ends' (endOf), so the surf of the whole coast is the union of its
 * pieces'.
 */
export function surfMesh(pieces, { min = SURF.min, colour = SURF.colour, fade = SURF.fade, y = SURF.y } = {}) {
  const P = [], C = [];
  const white = hexToLinear(colour), sea = hexToLinear(fade);
  const mixed = (w) => [0, 1, 2].map((e) => sea[e] + (white[e] - sea[e]) * w);
  // up-facing: wind each triangle so it faces up
  const tri = (u, v, w, cu, cv, cw) => {
    const cross = (v[0] - u[0]) * (w[2] - u[2]) - (v[2] - u[2]) * (w[0] - u[0]);
    const [V, W, aV, aW] = cross < 0 ? [v, w, cv, cw] : [w, v, cw, cv];
    P.push(...u, ...V, ...W);
    C.push(...mixed(cu), ...mixed(aV), ...mixed(aW));
  };
  const at = (end, d, yy = y) => [end.p[0] + end.nrm[0] * d * end.miter, yy, end.p[1] + end.nrm[1] * d * end.miter];
  // a band between two ends: offsets (one list a row, the same length for both ends) and each row's whiteness
  const band = (A, B, da, db, ws) => {
    for (let r = 0; r + 1 < ws.length; r++) {
      const A0 = at(A, da[r]), B0 = at(B, db[r]), A1 = at(A, da[r + 1]), B1 = at(B, db[r + 1]);
      tri(A0, B0, B1, ws[r], ws[r], ws[r + 1]);
      tri(A0, B1, A1, ws[r], ws[r + 1], ws[r + 1]);
    }
  };
  let used = 0, runs = 0;
  for (const pc of pieces) {
    if (pc.exposure < min) continue;
    used++;
    const A = endOf(pc, "a", min), B = endOf(pc, "b", min);
    if (!(A.e > 0)) runs++;
    const wa = widthAt(A), wb = widthAt(B);
    const rows = (w) => [-1.5, 0.45 * w, 0.75 * w, w];
    // the surge, white against the rock, fading out in two steps
    band(A, B, rows(wa), rows(wb), [1, 1, 0.55, 0]);
    // the spray standing on it, leaning a metre onto the rock: white at the water, greying at the top
    const top = (end) => (end.e > 0 ? 0.4 + 1.6 * end.e * (0.6 + 0.4 * end.v) : -0.2);
    const A0 = at(A, 1, -0.2), B0 = at(B, 1, -0.2), A1 = at(A, 0, top(A)), B1 = at(B, 0, top(B));
    P.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
    for (const w of [1, 1, 0.55, 1, 0.55, 0.55]) C.push(...mixed(w));
    // the lace further out where it is open, broken by hash
    if (pc.exposure >= 0.6 && hashKey(pc.key, 5) < pc.exposure) {
      const lace = (end, w) => {
        const at0 = w + 4 + 4 * end.v;
        return [at0, at0 + 1 + 3 * end.e * end.u];
      };
      const la = lace(A, wa), lb = lace(B, wb);
      band(A, B, la, lb, [0.45, 0]);
    }
  }
  return { positions: new Float32Array(P), colors: new Float32Array(C), pieces: used, runs };
}

/**
 * White water over the shallows where the swell breaks: on water nodes
 * between `depth` and 0.2 m under mean water whose exposure (at the node)
 * is at least `reef` and whose hash passes `chance`, an irregular patch: a
 * fan of seven triangles round a point jittered within the cell, its rim
 * 3 to 8 m out by hash a corner, at its middle 0.3 + 0.4·exposure of the
 * way to white (less by hash: broken water, never a slab of foam), the
 * sea's colour at the rim. Each patch is its node's alone (nodes
 * [k0, k1)): the whole is the union of its tiles'. → { positions, colors, patches }.
 * @param {Float32Array} heights  metres about mean water, a node each
 */
export function reefPatches(grid, heights, label, from, { depth = 2.5, reef = 0.55, chance = 0.6, colour = SURF.colour, fade = SURF.fade, y = SURF.y, ...o } = {}, k0 = 0, k1 = grid.n * grid.n) {
  const { n, cell, x0, z0 } = grid;
  const white = hexToLinear(colour), sea = hexToLinear(fade);
  const mixed = (w) => [0, 1, 2].map((e) => sea[e] + (white[e] - sea[e]) * w);
  const P = [], C = [];
  let patches = 0;
  for (let k = k0; k < k1; k++) {
    if (label[k] >= 0 || !(heights[k] < -0.2 && heights[k] >= -depth) || hash01(k, 300) >= chance) continue;
    const i = k % n, j = (k - i) / n;
    const x = x0 + i * cell, z = z0 + j * cell;
    const e = exposure(grid, label, x, z, from, o);
    if (e < reef) continue;
    patches++;
    const cx = x + (hash01(k, 301) - 0.5) * 0.6 * cell, cz = z + (hash01(k, 302) - 0.5) * 0.6 * cell;
    const mid = [cx, y + 0.02, cz];
    const rim = Array.from({ length: 7 }, (_, q) => {
      const a = ((q + 0.4 * hash01(k, 310 + q)) * 2 * Math.PI) / 7, r = 3 + 5 * hash01(k, 320 + q);
      return [cx + r * dcos(a), y + 0.02, cz - r * dsin(a)];
    });
    // never full white: broken water over a reef, not a slab of foam
    const w = (0.3 + 0.4 * e) * (0.6 + 0.4 * hash01(k, 303));
    for (let q = 0; q < 7; q++) {
      const u = rim[q], v = rim[(q + 1) % 7];
      // facing up, as the foam's triangles do
      const up = (u[0] - mid[0]) * (v[2] - mid[2]) - (u[2] - mid[2]) * (v[0] - mid[0]) < 0;
      P.push(...mid, ...(up ? u : v), ...(up ? v : u));
      C.push(...mixed(w), ...mixed(0), ...mixed(0));
    }
  }
  return { positions: new Float32Array(P), colors: new Float32Array(C), patches };
}

/** The boulders' colours: wet black rock. */
export const BOULDER = Object.freeze({ colour: "#2a2927", exposure: 0.6, chance: 0.3 });

/**
 * Black boulders at the waterline of the most exposed shore: on a piece
 * exposed `exposure` or more whose hash passes `chance`, one boulder, a
 * squat six-sided bicone 1.2 to 3.2 m across its middle, standing 0.6 to
 * 2 m out of the water, 1 to 4 m out from the shore, turned by hash.
 * Dressing, assumed (the place's rock benches, not mapped). Each piece's
 * own. → { positions, colors, boulders }.
 */
export function boulders(pieces, { exposure: emin = BOULDER.exposure, chance = BOULDER.chance, colour = BOULDER.colour } = {}) {
  const base = hexToLinear(colour).slice(0, 3);
  const P = [], C = [];
  let count = 0;
  for (const pc of pieces) {
    if (pc.exposure < emin || hashKey(pc.key, 20) >= chance) continue;
    count++;
    const t = 0.2 + 0.6 * hashKey(pc.key, 21), off = 1 + 3 * hashKey(pc.key, 22);
    const cx = pc.a[0] + (pc.b[0] - pc.a[0]) * t + pc.sea[0] * off, cz = pc.a[1] + (pc.b[1] - pc.a[1]) * t + pc.sea[1] * off;
    const r = 0.6 + hashKey(pc.key, 23), top = 0.6 + 1.4 * hashKey(pc.key, 24), turn = hashKey(pc.key, 25) * Math.PI;
    const ring = (yy, rr, q) => [cx + rr * dcos(turn + (q * Math.PI) / 3), yy, cz - rr * dsin(turn + (q * Math.PI) / 3)];
    for (let q = 0; q < 6; q++) {
      const shade = base.map((c) => c * (0.8 + 0.25 * ((q * 0.43) % 1)));
      // the lower cone from under the water to the waist, the upper to its top
      P.push(...ring(-1.2, r * 0.8, q), ...ring(-1.2, r * 0.8, q + 1), ...ring(top * 0.45, r, q + 1));
      P.push(...ring(-1.2, r * 0.8, q), ...ring(top * 0.45, r, q + 1), ...ring(top * 0.45, r, q));
      P.push(...ring(top * 0.45, r, q), ...ring(top * 0.45, r, q + 1), cx, top, cz);
      for (let v = 0; v < 9; v++) C.push(...shade);
    }
  }
  return { positions: new Float32Array(P), colors: new Float32Array(C), boulders: count };
}
