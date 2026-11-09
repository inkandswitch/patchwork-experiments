// A right-triangulated irregular network (RTIN) over a (2^k + 1)² grid, as
// Mapbox's Martini builds one, with two changes that make its error bound
// hold exactly, everywhere:
//
// - A triangle's error is the largest deviation of EVERY grid node inside
//   it (edges included) from its plane, not only its hypotenuse midpoint's
//   from the hypotenuse; and each node's deviation is divided by its own
//   tolerance, so the bound can vary with height (fine at the shore, coarse
//   in deep water). The error kept at a hypotenuse midpoint is the larger of
//   its two triangles' and of their descendants' (Martini's propagation),
//   so splitting is crack-free as in Martini.
// - So every triangle the mesh keeps has error ≤ 1: every node lies within
//   its tolerance of the mesh. checkMesh() verifies that over every node,
//   with the sign: no node of land drawn under the water, or water over it.

/** The triangle hierarchy's coordinates for index i (Martini's implicit binary tree): a, b the hypotenuse, c the right angle. */
function coords(i, T) {
  let id = i + 2;
  let ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
  if (id & 1) bx = by = cx = T;
  else ax = ay = cy = T;
  while ((id >>= 1) > 1) {
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    if (id & 1) {
      bx = ax; by = ay; ax = cx; ay = cy;
    } else {
      ax = bx; ay = by; bx = cx; by = cy;
    }
    cx = mx; cy = my;
  }
  return [ax, ay, bx, by, cx, cy];
}

/**
 * Visit every grid node in the closed triangle, with its plane value:
 * fn(k, planeValue). Exact integer inside test.
 */
function eachNode(n, h, ax, ay, bx, by, cx, cy, fn) {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  const sgn = area > 0 ? 1 : -1;
  const ha = h[ay * n + ax], hb = h[by * n + bx], hc = h[cy * n + cx];
  const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ea = ((bx - x) * (cy - y) - (by - y) * (cx - x)) * sgn;
      if (ea < 0) continue;
      const eb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) * sgn;
      if (eb < 0) continue;
      const ec = area * sgn - ea - eb;
      if (ec < 0) continue;
      fn(y * n + x, (ea * ha + eb * hb + ec * hc) / (area * sgn));
    }
  }
}

/**
 * Each hypotenuse midpoint's error: the worst (deviation / tolerance) of any
 * node in either triangle it splits, or in any of their descendants.
 * @param {number} n  2^k + 1
 * @param {Float32Array | Float64Array} h  heights, row-major
 * @param {Float32Array | Float64Array} tol  each node's tolerance (> 0)
 */
export function rtinErrors(n, h, tol) {
  const T = n - 1;
  if (T < 2 || (T & (T - 1)) !== 0) throw new Error(`An RTIN needs 2^k + 1 nodes a side, not ${n}.`);
  const numTriangles = T * T * 2 - 2;
  const numParents = numTriangles - T * T;
  const errors = new Float32Array(n * n);
  let worst = 0;
  const visit = (k, p) => {
    const d = Math.abs(h[k] - p) / tol[k];
    if (d > worst) worst = d;
  };
  for (let i = numTriangles - 1; i >= 0; i--) {
    const [ax, ay, bx, by, cx, cy] = coords(i, T);
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    worst = 0;
    eachNode(n, h, ax, ay, bx, by, cx, cy, visit);
    let e = worst;
    if (i < numParents) {
      const lc = ((ay + cy) >> 1) * n + ((ax + cx) >> 1);
      const rc = ((by + cy) >> 1) * n + ((bx + cx) >> 1);
      e = Math.max(e, errors[lc], errors[rc]);
    }
    const m = my * n + mx;
    if (e > errors[m]) errors[m] = e;
  }
  return errors;
}

/**
 * The mesh: every triangle whose error is ≤ `limit` (1: within each node's tolerance) is kept whole.
 * @returns {{ nodes: Uint32Array, triangles: Uint32Array }}  nodes: the grid index of each vertex; triangles: vertex indices, three a triangle, wound counter-clockwise seen from above (+Y, with grid x east and grid row south)
 */
export function rtinMesh(n, errors, limit = 1) {
  const T = n - 1;
  const vertexOf = new Int32Array(n * n).fill(-1);
  const nodes = [];
  const tris = [];
  const vert = (x, y) => {
    const k = y * n + x;
    if (vertexOf[k] < 0) {
      vertexOf[k] = nodes.length;
      nodes.push(k);
    }
    return vertexOf[k];
  };
  const process = (ax, ay, bx, by, cx, cy) => {
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * n + mx] > limit) {
      process(cx, cy, ax, ay, mx, my);
      process(bx, by, cx, cy, mx, my);
      return;
    }
    // up is +Y: with x east and the row index south, counter-clockwise from above is a negative cross in (x, row)
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross < 0) tris.push(vert(ax, ay), vert(bx, by), vert(cx, cy));
    else tris.push(vert(ax, ay), vert(cx, cy), vert(bx, by));
  };
  process(0, 0, T, T, T, 0);
  process(T, T, 0, 0, 0, T);
  return { nodes: Uint32Array.from(nodes), triangles: Uint32Array.from(tris) };
}

/**
 * Check a mesh against its grid at every node: each node is covered, lies
 * within its tolerance of the triangle(s) over it, and the mesh there has
 * the node's sign. → { ok, nodes, uncovered, worst, out, flipped, area }.
 */
export function checkMesh(n, h, tol, mesh) {
  const covered = new Uint8Array(n * n);
  let worst = 0, out = 0, flipped = 0, area = 0;
  const { nodes, triangles } = mesh;
  const xy = (v) => [nodes[v] % n, Math.floor(nodes[v] / n)];
  for (let t = 0; t < triangles.length; t += 3) {
    const [ax, ay] = xy(triangles[t]), [bx, by] = xy(triangles[t + 1]), [cx, cy] = xy(triangles[t + 2]);
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    eachNode(n, h, ax, ay, bx, by, cx, cy, (k, p) => {
      covered[k] = 1;
      const d = Math.abs(h[k] - p) / tol[k];
      if (d > worst) worst = d;
      if (d > 1 + 1e-6) out++;
      if (Math.sign(p) !== Math.sign(h[k])) flipped++;
    });
  }
  let uncovered = 0;
  for (let k = 0; k < covered.length; k++) if (!covered[k]) uncovered++;
  const T = n - 1;
  return { ok: !uncovered && !out && !flipped && area === T * T, nodes: n * n, uncovered, worst, out, flipped, area };
}
