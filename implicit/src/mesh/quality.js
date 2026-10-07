// Mesh quality checks, used by the tests: non-manifold edges and vertex
// normals that point against their face.

/**
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 * @param {Float32Array} [normals]  per-vertex normals, same indexing as positions
 * @returns {{ nonManifoldEdges: number, opposedCorners: number, corners: number, volume: number }}
 */
export function meshQuality(positions, indices, normals) {
  const edges = new Map();
  const nv = positions.length / 3;
  let opposed = 0;
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? u * nv + v : v * nv + u;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    if (normals) {
      for (const v of [a, b, c]) {
        if (fx * normals[v * 3] + fy * normals[v * 3 + 1] + fz * normals[v * 3 + 2] < 0) opposed++;
      }
    }
  }
  let nonManifold = 0;
  for (const n of edges.values()) if (n !== 2) nonManifold++;
  return { nonManifoldEdges: nonManifold, opposedCorners: opposed, corners: indices.length, volume };
}
