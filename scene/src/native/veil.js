// The veil: the stand-in the stage draws for an object whose look says
// `veil: true` (STAGE.md, "Lenses"): "what this is, is kept from you". One
// drawing for any shape, made from the object's bounds alone, so nothing of
// what it stands in for can reach it: a frosted box filling the bounds, a
// pale padlock on its two largest faces, both sides alike (a veiled thing
// turned over never shows a bare side).
//
// Two levels a face, never more: the core, and one layer of decals DECAL
// proud of it that never overlap each other, so no two faces are nearer
// than DECAL and the depth buffer tells them apart from across a table.
//
// Pure, but for veilGLB's encoding.

import { encodeGLB } from "../glb.js";

/** How far the decals stand proud of the core: 0.2 mm, or a third of a thinner thing. */
export const DECAL = 0.0002;
/** The bounds a veil is drawn to when the object has none to go by: a 5 cm cube standing on its origin. */
export const DEFAULT_BOUNDS = Object.freeze({ min: Object.freeze([-0.025, 0, -0.025]), max: Object.freeze([0.025, 0.05, 0.025]) });

// Colours no piece's own: a hueless mid grey, a pale lock, a dark keyhole.
const FROST = "#7d8892";
const LOCK = "#f1f3f5";
const KEYHOLE = "#2b3036";

const finite3 = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => Number.isFinite(Number(x)));

/** Bounds a veil can be drawn to: the given ones if they make a box with some size on every axis, else null. */
export function veilBounds(b) {
  if (!finite3(b?.min) || !finite3(b?.max)) return null;
  const min = b.min.slice(0, 3).map(Number);
  const max = b.max.slice(0, 3).map(Number);
  return max.every((v, k) => v > min[k]) ? { min, max } : null;
}

/** A key for a veil's drawing: its bounds to 10 µm. */
export const veilKey = (b) => [...b.min, ...b.max].map((v) => Math.round(Number(v) * 1e5)).join(",");

/** Rectangles [u0, v0, u1, v1] that tile `rect` less every one of `holes` (cells of their edges, merged along u). Pure. */
export function cutRects(rect, holes) {
  const [x0, z0, x1, z1] = rect;
  const xs = new Set([x0, x1]);
  const zs = new Set([z0, z1]);
  for (const h of holes) {
    for (const x of [h[0], h[2]]) if (x > x0 && x < x1) xs.add(x);
    for (const z of [h[1], h[3]]) if (z > z0 && z < z1) zs.add(z);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Z = [...zs].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j + 1 < Z.length; j++) {
    const zm = (Z[j] + Z[j + 1]) / 2;
    let run = null;
    for (let i = 0; i + 1 < X.length; i++) {
      const xm = (X[i] + X[i + 1]) / 2;
      const hidden = holes.some((h) => xm > h[0] && xm < h[2] && zm > h[1] && zm < h[3]);
      if (hidden) run = null;
      else if (run) run[2] = X[i + 1];
      else out.push((run = [X[i], Z[j], X[i + 1], Z[j + 1]]));
    }
  }
  return out;
}

/**
 * The axes of a veil: `n` the thinnest (the two largest faces are across
 * it; a tie goes to Y, then Z, so a square card lying flat is veiled on its
 * top and bottom), `v` the way the padlock stands up in the face (Y when the
 * face is upright, else Z: read from across a table), `u` the other.
 * @returns {{ n: 0 | 1 | 2, u: 0 | 1 | 2, v: 0 | 1 | 2 }}
 */
export function veilAxes(bounds) {
  const size = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]);
  let n = 1;
  for (const k of [2, 0]) if (size[k] < size[n] - 1e-12) n = k;
  const v = n === 1 ? 2 : 1;
  const u = 3 - n - v;
  return { n, u, v };
}

/**
 * The veil as boxes filling `bounds` exactly: [{ min, max, color, name }].
 * The core, then on each of the two largest faces a padlock (body, shackle,
 * keyhole) as decals, the second face the first mirrored through the
 * middle.
 * @param {{ min: number[], max: number[] }} bounds
 */
export function veilParts(bounds) {
  const { n, u, v } = veilAxes(bounds);
  const lo = bounds.min;
  const hi = bounds.max;
  const t = hi[n] - lo[n];
  const d = Math.min(DECAL, t / 3);
  const cu = (lo[u] + hi[u]) / 2;
  const cv = (lo[v] + hi[v]) / 2;
  const s = Math.min(hi[u] - lo[u], hi[v] - lo[v]);
  const parts = [];
  const box = (ru, rv, rn, color, name) => {
    const min = [0, 0, 0];
    const max = [0, 0, 0];
    [min[u], max[u]] = ru;
    [min[v], max[v]] = rv;
    [min[n], max[n]] = rn;
    parts.push({ min, max, color, name });
  };
  box([lo[u], hi[u]], [lo[v], hi[v]], [lo[n] + d, hi[n] - d], FROST, "core");

  // the padlock, in the face: its body below the middle, its shackle above (toward +v)
  const rect = (x, z, sx, sz) => [x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2];
  const bw = s * 0.56;
  const bl = s * 0.42;
  const bz = cv - s * 0.12;
  const bar = s * 0.1;
  const sh = s * 0.28;
  const top = bz + bl / 2;
  const body = rect(cu, bz, bw, bl);
  const legs = [-1, 1].map((k) => rect(cu + k * bw * 0.3, top + (sh - bar) / 2, bar, sh - bar));
  const crown = rect(cu, top + sh - bar / 2, bw * 0.6 + bar, bar);
  const kz = bz + s * 0.03;
  const keyhole = [rect(cu, kz, s * 0.12, s * 0.08), rect(cu, kz, s * 0.08, s * 0.12), rect(cu, bz - s * 0.06, s * 0.045, s * 0.11)];
  const decals = [];
  // the field round the lock, level with it, so the lock isn't a raised island that catches the light alone
  const face = [lo[u], lo[v], hi[u], hi[v]];
  for (const r of cutRects(face, [body, ...legs, crown])) decals.push([r, FROST, "frost"]);
  for (const r of cutRects(body, keyhole)) decals.push([r, LOCK, "lock"]);
  for (const r of [...legs, crown]) decals.push([r, LOCK, "shackle"]);
  // the keyhole's crossed bars overlap: cut each by those before it
  keyhole.forEach((k, i) => {
    for (const r of cutRects(k, keyhole.slice(0, i))) decals.push([r, KEYHOLE, "keyhole"]);
  });
  for (const [[u0, v0, u1, v1], color, name] of decals) {
    box([u0, u1], [v0, v1], [hi[n] - d, hi[n]], color, name);
    // the far face: the same, seen from the other side (mirrored across u, so it reads the right way round there too)
    box([2 * cu - u1, 2 * cu - u0], [v0, v1], [lo[n], lo[n] + d], color, name);
  }
  return parts;
}

const FACES = [
  // each: the fixed axis, its side, and the corner order that winds outward
  [0, 1, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [0, 0, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [1, 1, [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [2, 1, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [2, 0, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

/** The veil for these bounds as a GLB: one mesh, a primitive per colour, flat shaded. */
export function veilGLB(bounds) {
  const byColor = new Map();
  for (const p of veilParts(bounds)) {
    let prim = byColor.get(p.color);
    if (!prim) byColor.set(p.color, (prim = { positions: [], normals: [], indices: [], color: p.color, roughness: 0.9, metallic: 0, doubleSided: false }));
    for (const [axis, side, corners] of FACES) {
      const base = prim.positions.length / 3;
      for (const c of corners) {
        prim.positions.push(...c.map((k, i) => (k ? p.max[i] : p.min[i])));
        prim.normals.push(...[0, 1, 2].map((i) => (i === axis ? (side ? 1 : -1) : 0)));
      }
      prim.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return encodeGLB({ meshes: [{ name: "veil", primitives: [...byColor.values()] }], generator: "scene veil" });
}
