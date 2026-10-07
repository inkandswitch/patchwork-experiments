// How far a point is from an object's geometry: triangles, line segments or
// bare points, as flat arrays in one frame. Pure (no three.js), so it can be
// tested; the viewport feeds it each object's GLB in object-local coordinates.
//
// Used to tell when a dimension's anchor has come off its object: anchors are
// fixed points in the object's frame (SCENE-CONTRACT: they follow the object's
// transform, not its geometry), so when the object is rebuilt with different
// geometry an anchor that sat on the old surface can end up in mid-air or
// inside the new one, and the dimension silently measures the old shape.

/** Squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriangleDist2(p, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const q = (x, y, z) => (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
  if (d1 <= 0 && d2 <= 0) return q(a[0], a[1], a[2]);
  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return q(b[0], b[1], b[2]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return q(a[0] + v * abx, a[1] + v * aby, a[2] + v * abz);
  }
  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return q(c[0], c[1], c[2]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return q(a[0] + w * acx, a[1] + w * acy, a[2] + w * acz);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return q(b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2]));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return q(a[0] + abx * v + acx * w, a[1] + aby * v + acy * w, a[2] + abz * v + acz * w);
}

/** Squared distance from p to segment ab. */
export function pointSegmentDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = dx * dx + dy * dy + dz * dz;
  let t = L > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2 + (p[2] - a[2] - t * dz) ** 2;
}

/**
 * The nearest distance from `point` to a set of primitives.
 * @param {{ positions: ArrayLike<number>, index?: ArrayLike<number> | null, mode: number }[]} prims
 *   glTF modes: 4 triangles, 5 strip, 6 fan, 1 lines, 3 line strip, 2 loop, 0 points
 * @param {number[]} point
 * @returns {number} Infinity when there is nothing
 */
export function distanceToPrimitives(prims, point) {
  let best = Infinity;
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  const at = (P, i, out) => {
    out[0] = P[i * 3];
    out[1] = P[i * 3 + 1];
    out[2] = P[i * 3 + 2];
    return out;
  };
  // cheap reject: the squared distance to the box around a triangle/segment
  const boxD2 = (...vs) => {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      let lo = Infinity, hi = -Infinity;
      for (const v of vs) {
        if (v[k] < lo) lo = v[k];
        if (v[k] > hi) hi = v[k];
      }
      const x = point[k];
      if (x < lo) d += (lo - x) ** 2;
      else if (x > hi) d += (x - hi) ** 2;
    }
    return d;
  };
  for (const pr of prims ?? []) {
    const P = pr.positions;
    const n = pr.index ? pr.index.length : P.length / 3;
    const idx = pr.index ? (i) => pr.index[i] : (i) => i;
    const mode = pr.mode ?? 4;
    const tri = (i, j, k) => {
      at(P, idx(i), A);
      at(P, idx(j), B);
      at(P, idx(k), C);
      if (boxD2(A, B, C) >= best) return;
      best = Math.min(best, pointTriangleDist2(point, A, B, C));
    };
    const seg = (i, j) => {
      at(P, idx(i), A);
      at(P, idx(j), B);
      if (boxD2(A, B) >= best) return;
      best = Math.min(best, pointSegmentDist2(point, A, B));
    };
    if (mode === 4) for (let i = 0; i + 2 < n; i += 3) tri(i, i + 1, i + 2);
    else if (mode === 5) for (let i = 0; i + 2 < n; i++) tri(i, i + 1, i + 2);
    else if (mode === 6) for (let i = 1; i + 1 < n; i++) tri(0, i, i + 1);
    else if (mode === 1) for (let i = 0; i + 1 < n; i += 2) seg(i, i + 1);
    else if (mode === 3 || mode === 2) {
      for (let i = 0; i + 1 < n; i++) seg(i, i + 1);
      if (mode === 2 && n > 2) seg(n - 1, 0);
    } else
      for (let i = 0; i < n; i++) {
        at(P, idx(i), A);
        best = Math.min(best, (point[0] - A[0]) ** 2 + (point[1] - A[1]) ** 2 + (point[2] - A[2]) ** 2);
      }
  }
  return Math.sqrt(best);
}

/**
 * How far an anchor may be from the surface and still count as on it: a
 * millimetre, or 0.02% of the object's size (float precision, and a rebuild
 * at a different tessellation moving a curved surface by a chord's sag).
 */
export function onSurfaceTolerance(diagonal) {
  return Math.max(0.001, 2e-4 * (Number.isFinite(diagonal) ? diagonal : 0));
}
