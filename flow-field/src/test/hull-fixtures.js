// Test fixtures: a hull-ish waterline, and GLBs of prisms built from it the
// way a scene provider would (glTF Y-up: X = x, Y = z, Z = −y).
import { encodeGLB } from "../glb.js";

export const halfBreadth = (x) => 0.8 * (1 - (x / 10) ** 2) + 0.5 * Math.sin((Math.PI * x) / 10) * (1 - x / 10);

/** Counter-clockwise waterline of a 10 m hull: transom 1.6 m wide at x = 0, stem at x = 10. */
export function transomWaterline(n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([(10 * i) / n, -halfBreadth((10 * i) / n)]);
  pts.push([10, 0]);
  for (let i = n - 1; i >= 0; i--) pts.push([(10 * i) / n, halfBreadth((10 * i) / n)]);
  return pts;
}

export const circleLoop = (n, R = 1) =>
  Array.from({ length: n }, (_, i) => [R * Math.cos((2 * Math.PI * i) / n), R * Math.sin((2 * Math.PI * i) / n)]);

const gl = (x, y, z) => [x, z, 0 - y];

/**
 * A vertical prism over a floating-frame loop, z from zLo to zHi, as a GLB.
 * @param {object} [o]
 * @param {boolean} [o.caps=true]      close the top and bottom (fan: the loop must be star-shaped from its centroid)
 * @param {number[]} [o.levels]        z levels (rings) instead of [zLo, zHi]
 * @param {boolean} [o.indexed=true]   false: every triangle gets its own vertices (seams everywhere)
 * @param {number[]} [o.translation]   put the mesh under a node with this translation (glTF frame)
 * @param {number[]} [o.skipEdges]     loop edges to leave out of the side (an open shell)
 */
export function prismGLB(loop, { levels = [-1, 0.5], caps = true, indexed = true, translation, skipEdges = [] } = {}) {
  const n = loop.length;
  const positions = [];
  const indices = [];
  const vert = (x, y, z) => {
    positions.push(...gl(x, y, z));
    return positions.length / 3 - 1;
  };
  const tri = (a, b, c) => {
    if (indexed) indices.push(a, b, c);
    else {
      const p = (i) => positions.slice(i * 3, i * 3 + 3);
      const [A, B, C] = [p(a), p(b), p(c)];
      nonIndexed.push(...A, ...B, ...C);
    }
  };
  const nonIndexed = [];
  const rings = levels.map((z) => loop.map(([x, y]) => vert(x, y, z)));
  for (let r = 0; r + 1 < rings.length; r++)
    for (let i = 0; i < n; i++) {
      if (skipEdges.includes(i)) continue;
      const j = (i + 1) % n;
      tri(rings[r][i], rings[r][j], rings[r + 1][j]);
      tri(rings[r][i], rings[r + 1][j], rings[r + 1][i]);
    }
  if (caps) {
    const cx = loop.reduce((s, p) => s + p[0], 0) / n;
    const cy = loop.reduce((s, p) => s + p[1], 0) / n;
    for (const [ri, z] of [[0, levels[0]], [rings.length - 1, levels.at(-1)]]) {
      const c = vert(cx, cy, z);
      for (let i = 0; i < n; i++) tri(c, rings[ri][i], rings[ri][(i + 1) % n]);
    }
  }
  const prim = indexed ? { positions, indices } : { positions: nonIndexed };
  const meshes = [{ name: "Hull", primitives: [prim, { positions: [0, 0, 0, 1, 0, 0], mode: 1 }] }];
  const nodes = translation ? [{ name: "root", children: [1], translation }, { name: "hull", mesh: 0 }] : undefined;
  return encodeGLB({ meshes, nodes });
}
