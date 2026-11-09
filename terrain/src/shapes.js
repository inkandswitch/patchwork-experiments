// Small solids for harbour structures and marks, gathered into one
// flat-shaded, vertex-coloured triangle soup per kind of thing (so a
// harbour of 150 floats is one mesh, not 150).

import earcut from "earcut";
import { hexToLinear } from "./glb.js";

export function soup() {
  const pos = [], col = [];
  const tri = (a, b, c, rgb) => {
    pos.push(...a, ...b, ...c);
    col.push(...rgb, ...rgb, ...rgb);
  };
  return {
    tri,
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
    const l = Math.hypot(dx, dz);
    dirs.push([dx / l, dz / l]);
  }
  const left = [], right = [];
  for (let k = 0; k < pts.length; k++) {
    const a = dirs[Math.max(0, k - 1)], b = dirs[Math.min(dirs.length - 1, k)];
    // a normal of each direction, and their mitre
    const na = [-a[1], a[0]], nb = [-b[1], b[0]];
    let mx = na[0] + nb[0], mz = na[1] + nb[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-9) {
      mx = nb[0];
      mz = nb[1];
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = mx * nb[0] + mz * nb[1];
    const len = Math.min(r / Math.max(cos, 1e-6), 3 * r);
    left.push([pts[k][0] + mx * len, pts[k][1] + mz * len]);
    right.push([pts[k][0] - mx * len, pts[k][1] - mz * len]);
  }
  return [...left, ...right.reverse()];
}

/** A cylinder (or a cone, with r1 0) about (x, z) from y0 to y1, `seg` sides, capped. */
export function cylinder(s, x, z, y0, y1, r0, r1, hex, seg = 12) {
  const c = rgb(hex);
  const side = c.map((v) => v * 0.9);
  const at = (k, y, r) => [x + r * Math.cos((2 * Math.PI * k) / seg), y, z - r * Math.sin((2 * Math.PI * k) / seg)];
  for (let k = 0; k < seg; k++) {
    const a0 = at(k, y0, r0), b0 = at(k + 1, y0, r0), a1 = at(k, y1, r1), b1 = at(k + 1, y1, r1);
    if (r1 > 0) s.quad(a0, b0, b1, a1, side);
    else s.tri(a0, b0, a1, side);
    if (r1 > 0) s.tri([x, y1, z], a1, b1, c);
    s.tri([x, y0, z], b0, a0, c);
  }
}
