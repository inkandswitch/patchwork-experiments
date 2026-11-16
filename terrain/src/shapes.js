// Small solids for harbour structures and marks, gathered into one
// flat-shaded, vertex-coloured triangle soup per kind of thing (so a
// harbour of 150 floats is one mesh, not 150).

import earcut from "earcut";
import { dsin, dcos, len } from "./detmath.js";
import { hexToLinear } from "./glb.js";

export function soup() {
  const pos = [], col = [];
  const tri = (a, b, c, rgb) => {
    pos.push(...a, ...b, ...c);
    col.push(...rgb, ...rgb, ...rgb);
  };
  return {
    tri,
    /** a triangle with a colour at each corner */
    triC(a, b, c, ca, cb, cc) {
      pos.push(...a, ...b, ...c);
      col.push(...ca, ...cb, ...cc);
    },
    /** quad a b c d, counter-clockwise seen from where it faces */
    quad(a, b, c, d, rgb) {
      tri(a, b, c, rgb);
      tri(a, c, d, rgb);
    },
    get count() {
      return pos.length / 3;
    },
    done() {
      return { positions: new Float32Array(pos), colors: new Float32Array(col) };
    },
  };
}

export const rgb = (hex) => hexToLinear(hex).slice(0, 3);

/** Twice the signed area of a ring in (x, z), positive when it runs counter-clockwise seen from above (+Y). */
export function ringArea2(ring) {
  let s = 0;
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k], [x2, z2] = ring[(k + 1) % ring.length];
    s += x1 * z2 - x2 * z1;
  }
  // x east, z south: counter-clockwise from above is clockwise in (x, z)
  return -s;
}

/**
 * A prism: the ring (x, z; not repeating its first point) from y0 to y1,
 * top, bottom and walls. → false if the ring can't be triangulated.
 */
export function prism(s, ring, y0, y1, hex, { bottom = true } = {}) {
  let pts = ring.filter((p, k) => k === 0 || p[0] !== ring[k - 1][0] || p[1] !== ring[k - 1][1]);
  if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts = pts.slice(0, -1);
  if (pts.length < 3) return false;
  if (ringArea2(pts) < 0) pts = pts.slice().reverse();
  const c = rgb(hex);
  const flat = pts.flatMap((p) => p);
  const ids = earcut(flat);
  if (!ids.length) return false;
  const top = (k) => [pts[k][0], y1, pts[k][1]];
  const bot = (k) => [pts[k][0], y0, pts[k][1]];
  for (let t = 0; t < ids.length; t += 3) {
    let [a, b, d] = [ids[t], ids[t + 1], ids[t + 2]];
    // face up: (b − a) × (d − a) has +Y
    const ny = (pts[b][1] - pts[a][1]) * (pts[d][0] - pts[a][0]) - (pts[b][0] - pts[a][0]) * (pts[d][1] - pts[a][1]);
    if (ny < 0) [b, d] = [d, b];
    s.tri(top(a), top(b), top(d), c);
    if (bottom) s.tri(bot(a), bot(d), bot(b), c);
  }
  const wall = c.map((v) => v * 0.8);
  for (let k = 0; k < pts.length; k++) {
    const j = (k + 1) % pts.length;
    s.quad(bot(k), bot(j), top(j), top(k), wall);
  }
  return true;
}

/**
 * A polyline (x, z) widened to a ring `width` across, mitred at its bends
 * (a mitre is held to 3 half-widths, so a hairpin doesn't spike).
 */
export function widen(line, width) {
  const pts = line.filter((p, k) => k === 0 || p[0] !== line[k - 1][0] || p[1] !== line[k - 1][1]);
  if (pts.length < 2) return null;
  const r = width / 2;
  const dirs = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const dx = pts[k + 1][0] - pts[k][0], dz = pts[k + 1][1] - pts[k][1];
    const l = len(dx, dz);
    dirs.push([dx / l, dz / l]);
  }
  const left = [], right = [];
  for (let k = 0; k < pts.length; k++) {
    const a = dirs[Math.max(0, k - 1)], b = dirs[Math.min(dirs.length - 1, k)];
    // a normal of each direction, and their mitre
    const na = [-a[1], a[0]], nb = [-b[1], b[0]];
    let mx = na[0] + nb[0], mz = na[1] + nb[1];
    const ml = len(mx, mz);
    if (ml < 1e-9) {
      mx = nb[0];
      mz = nb[1];
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = mx * nb[0] + mz * nb[1];
    const reach = Math.min(r / Math.max(cos, 1e-6), 3 * r);
    left.push([pts[k][0] + mx * reach, pts[k][1] + mz * reach]);
    right.push([pts[k][0] - mx * reach, pts[k][1] - mz * reach]);
  }
  return [...left, ...right.reverse()];
}

/** A cylinder (or a cone, with r1 0) about (x, z) from y0 to y1, `seg` sides, capped. */
export function cylinder(s, x, z, y0, y1, r0, r1, hex, seg = 12) {
  const c = rgb(hex);
  const side = c.map((v) => v * 0.9);
  const at = (k, y, r) => [x + r * dcos((2 * Math.PI * k) / seg), y, z - r * dsin((2 * Math.PI * k) / seg)];
  for (let k = 0; k < seg; k++) {
    const a0 = at(k, y0, r0), b0 = at(k + 1, y0, r0), a1 = at(k, y1, r1), b1 = at(k + 1, y1, r1);
    if (r1 > 0) s.quad(a0, b0, b1, a1, side);
    else s.tri(a0, b0, a1, side);
    if (r1 > 0) s.tri([x, y1, z], a1, b1, c);
    s.tri([x, y0, z], b0, a0, c);
  }
}

/**
 * A log: a `seg`-sided prism of radius r from a to b ([x, y, z], any
 * direction but straight up), its ends capped; its sides shaded by which
 * way they face (up lighter, down darker), so a pile reads without normals.
 * `hex` a colour or [r, g, b] linear.
 */
export function log(s, a, b, r, hex, seg = 6, capHex = null) {
  const c = Array.isArray(hex) ? hex : rgb(hex);
  const cap = capHex == null ? c.map((v) => v * 0.9) : Array.isArray(capHex) ? capHex : rgb(capHex);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  const u = [d[0] / l, d[1] / l, d[2] / l];
  // a side vector level and square to the axis, and the third square to both
  const h = Math.hypot(u[0], u[2]) || 1;
  const p = [-u[2] / h, 0, u[0] / h];
  const q = [u[1] * p[2] - u[2] * p[1], u[2] * p[0] - u[0] * p[2], u[0] * p[1] - u[1] * p[0]];
  const ring = (o, k) => {
    const t = (2 * Math.PI * k) / seg, cs = dcos(t), sn = dsin(t);
    return [o[0] + r * (p[0] * cs + q[0] * sn), o[1] + r * (p[1] * cs + q[1] * sn), o[2] + r * (p[2] * cs + q[2] * sn)];
  };
  for (let k = 0; k < seg; k++) {
    const t = (2 * Math.PI * (k + 0.5)) / seg;
    const up = q[1] * dsin(t) + p[1] * dcos(t);
    const shade = c.map((v) => v * (0.82 + 0.25 * Math.max(-0.6, Math.min(1, up))));
    s.quad(ring(a, k), ring(a, k + 1), ring(b, k + 1), ring(b, k), shade);
    s.tri(a, ring(a, k + 1), ring(a, k), cap);
    s.tri(b, ring(b, k), ring(b, k + 1), cap);
  }
}
