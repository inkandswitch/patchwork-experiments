// A box cut into tetrahedra, shaped exactly like what parseMsh returns
// (src/solver/gmsh.js), for testing what comes after gmsh without gmsh.
//
// The box runs from the origin to (lx, ly, lz), cut into nx × ny × nz cells,
// each cell into the six tetrahedra of Kuhn's split along its main diagonal
// (corner 000 to corner 111): one for each order of stepping in x, y and z.
// Every cell is split the same way, so the faces of neighbouring cells match,
// and each face of a cell is cut along its own diagonal from its lowest
// corner to its highest.
//
// Tetrahedra are positively oriented (corner 3 on the side of 0-1-2 that sees
// them anticlockwise). With order 2, the mid-edge nodes are the edges'
// midpoints, shared between tetrahedra, in gmsh's node order: edges (0,1)
// (1,2) (2,0) (3,0) (2,3) (1,3). Corner nodes are numbered first, then the
// mid-edge nodes, as parseMsh numbers them.
//
// `skin` is the box's boundary triangles (three corners each, wound
// outward), `skinSurface` for each the gmsh surface number it is on: surface
// s is the box face that readPart(box(lx, ly, lz)) numbers s − 1.
// Coordinates are in metres: this is what parseMsh gives after scaling.

import { readPart } from "../part/faces.js";
import { box } from "./shapes.js";

/** The part a list of triangles makes (readPart, passed through). */
export const partOf = (triangles) => readPart(triangles);

/** gmsh's mid-edge order for a ten-node tetrahedron: node 4 + k is on edge k. */
export const GMSH_EDGES = Object.freeze([[0, 1], [1, 2], [2, 0], [3, 0], [2, 3], [1, 3]]);

const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * @param {number} nx @param {number} ny @param {number} nz   cells along each axis
 * @param {number[]} size   [lx, ly, lz], metres
 * @param {1|2} order
 * @returns {{ order: 1|2, nodes: Float64Array, tets: Uint32Array, skin: Uint32Array, skinSurface: Int32Array }}
 */
export function tetBox(nx, ny, nz, [lx, ly, lz], order = 2) {
  const n = [nx, ny, nz], L = [lx, ly, lz];
  const id = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
  const xyz = [];
  for (let k = 0; k <= nz; k++)
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) xyz.push((i / nx) * lx, (j / ny) * ly, (k / nz) * lz);
  const at = (v) => [xyz[v * 3], xyz[v * 3 + 1], xyz[v * 3 + 2]];
  const volume6 = (a, b, c, d) => {
    const [A, B, C, D] = [a, b, c, d].map(at);
    const u = [0, 1, 2].map((k) => B[k] - A[k]), v = [0, 1, 2].map((k) => C[k] - A[k]), w = [0, 1, 2].map((k) => D[k] - A[k]);
    return u[0] * (v[1] * w[2] - v[2] * w[1]) + u[1] * (v[2] * w[0] - v[0] * w[2]) + u[2] * (v[0] * w[1] - v[1] * w[0]);
  };

  const corners = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        for (const p of PERMUTATIONS) {
          const step = [i, j, k];
          const path = [id(...step)];
          for (const axis of p) {
            step[axis]++;
            path.push(id(...step));
          }
          // an odd order of steps gives a tetrahedron inside out: swap two corners
          if (volume6(...path) < 0) [path[1], path[2]] = [path[2], path[1]];
          corners.push(...path);
        }

  const T = corners.length / 4;
  const per = order === 1 ? 4 : 10;
  const tets = new Uint32Array(T * per);
  const corner = xyz.length / 3;
  const mid = new Map();
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 4; k++) tets[t * per + k] = corners[t * 4 + k];
    if (per === 4) continue;
    GMSH_EDGES.forEach(([a, b], e) => {
      const p = corners[t * 4 + a], q = corners[t * 4 + b];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      let m = mid.get(key);
      if (m === undefined) {
        m = corner + mid.size;
        mid.set(key, m);
        const P = at(p), Q = at(q);
        xyz.push((P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2, (P[2] + Q[2]) / 2);
      }
      tets[t * per + 4 + e] = m;
    });
  }

  // the box's faces as readPart numbers them: the face whose normal is ±axis
  const part = readPart(box(lx, ly, lz));
  const faceFacing = (axis, sign) => part.faces.find((f) => Math.abs(f.normal[axis] - sign) < 1e-9).id;

  // each boundary square of a cell, cut along its diagonal from its lowest corner to its highest
  const skin = [], skinSurface = [];
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [0, 1, 2].filter((k) => k !== axis);
    for (const side of [0, 1]) {
      const surface = faceFacing(axis, side ? 1 : -1) + 1;
      for (let a = 0; a < n[u]; a++)
        for (let b = 0; b < n[v]; b++) {
          const corner3 = (du, dv) => {
            const s = [0, 0, 0];
            s[axis] = side * n[axis];
            s[u] = a + du;
            s[v] = b + dv;
            return id(...s);
          };
          const p00 = corner3(0, 0), p10 = corner3(1, 0), p11 = corner3(1, 1), p01 = corner3(0, 1);
          // each triangle wound so its normal points out of the box
          for (const tri of [[p00, p10, p11], [p00, p11, p01]]) {
            const [A, B, C] = tri.map(at);
            const nAxis = (() => {
              const e1 = [0, 1, 2].map((k) => B[k] - A[k]), e2 = [0, 1, 2].map((k) => C[k] - A[k]);
              return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]][axis];
            })();
            const out = side ? nAxis > 0 : nAxis < 0;
            skin.push(...(out ? tri : [tri[0], tri[2], tri[1]]));
            skinSurface.push(surface);
          }
        }
    }
  }

  return { order: per === 4 ? 1 : 2, nodes: Float64Array.from(xyz), tets, skin: Uint32Array.from(skin), skinSurface: Int32Array.from(skinSurface) };
}
