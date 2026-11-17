// What a bag looks like in a scene: a plain drawstring sack, drawn here
// (art of our own, no texture), standing on y = 0 with its origin at the
// middle of its base. Metres, at real size: `size` is how wide the sack is.
// Pure: a look in, GLB bytes and bounds out.

import { computeBounds, computeNormals, encodeGLB } from "./glb.js";

const SEGMENTS = 28;

/** A turned outline's mesh: [r, y] points revolved about +Y. */
function lathe(profile, segments = SEGMENTS) {
  const positions = [];
  const indices = [];
  const ring = segments + 1;
  for (const [r, y] of profile) {
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(r * Math.cos(a), y, r * Math.sin(a));
    }
  }
  for (let i = 0; i + 1 < profile.length; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * ring + s;
      const b = a + ring;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const p = new Float32Array(positions);
  return { positions: p, indices: new Uint32Array(indices), normals: computeNormals(p, indices) };
}

/** The sack's outline for a width `w`: a full round body, a gathered neck, and the cloth flaring open above the cord. */
export function sackProfile(w) {
  const r = w / 2;
  const pts = [[0, 0], [0.55 * r, 0], [0.82 * r, 0.06 * w]];
  // the body: a bulge, widest a third of the way up
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = -0.6 + t * (Math.PI / 2 + 0.6);
    pts.push([r * (0.3 + 0.7 * Math.cos(a)), w * (0.34 + 0.38 * Math.sin(a) + 0.12 * t)]);
  }
  // the neck, pulled in by the cord, then the mouth
  pts.push([0.26 * r, 0.88 * w], [0.3 * r, 0.93 * w], [0.5 * r, 1.04 * w], [0.56 * r, 1.1 * w], [0.44 * r, 1.07 * w], [0.2 * r, 0.95 * w]);
  // exactly as wide as it says: its widest point is at r
  const widest = Math.max(...pts.map(([x]) => x));
  return pts.map(([x, y]) => [+Math.max(0, (x * r) / widest).toFixed(6), +y.toFixed(6)]);
}

/** The cord round the neck: a thin ring. */
function cordProfile(w) {
  const r = w / 2;
  const c = [0.3 * r, 0.9 * w];
  const t = 0.035 * r;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push([+(c[0] + t * Math.cos(a)).toFixed(5), +(c[1] + t * Math.sin(a)).toFixed(5)]);
  }
  return pts;
}

/**
 * A sack's GLB.
 * @param {{ color: string, size: number }} look  (datatype.js lookOf)
 * @returns {{ glb: Uint8Array, bounds: { min: number[], max: number[] } }}
 */
export function sackGLB(look) {
  const w = look.size;
  const cloth = lathe(sackProfile(w));
  const cord = lathe(cordProfile(w), SEGMENTS);
  const all = new Float32Array(cloth.positions.length + cord.positions.length);
  all.set(cloth.positions);
  all.set(cord.positions, cloth.positions.length);
  const bounds = computeBounds(all);
  const glb = encodeGLB({
    generator: "patchwork bag",
    meshes: [
      { name: "sack", primitives: [{ ...cloth, color: look.color, roughness: 0.95 }] },
      { name: "cord", primitives: [{ ...cord, color: "#e8dcc0", roughness: 0.9 }] },
    ],
  });
  return { glb, bounds };
}

/** Bounds rounded to 10 µm, as a hint carries them. */
export const roundBounds = (b) => (b ? { min: b.min.map((v) => +v.toFixed(5)), max: b.max.map((v) => +v.toFixed(5)) } : null);
