// The volume mesh, made ready to solve on: tetrahedra in CalculiX's node
// order and all the right way out, their skin found from the tetrahedra
// themselves, and every skin triangle given the face of the part it lies on.
//
// A tetrahedron's nodes (C3D4 / C3D10, numbered from 0 here):
//
//   corners 0 1 2 3, with 3 on the side of 0-1-2 that sees them anticlockwise
//   mid-edge 4:(0,1) 5:(1,2) 6:(2,0) 7:(0,3) 8:(1,3) 9:(2,3)
//
// gmsh numbers the last two the other way round.

/** A tetrahedron's four faces, corners in the order that makes the normal point OUT, then the mid-edge nodes between them. */
export const TET_FACES = Object.freeze([
  [0, 2, 1, 6, 5, 4],
  [0, 1, 3, 4, 8, 7],
  [1, 2, 3, 5, 9, 8],
  [0, 3, 2, 7, 9, 6],
]);

/** A tetrahedron's six edges as corner pairs, in mid-edge node order (node 4 + k is on edge k). */
export const TET_EDGES = Object.freeze([[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]]);

const signedVolume = (X, a, b, c, d) => {
  const ax = X[b * 3] - X[a * 3], ay = X[b * 3 + 1] - X[a * 3 + 1], az = X[b * 3 + 2] - X[a * 3 + 2];
  const bx = X[c * 3] - X[a * 3], by = X[c * 3 + 1] - X[a * 3 + 1], bz = X[c * 3 + 2] - X[a * 3 + 2];
  const cx = X[d * 3] - X[a * 3], cy = X[d * 3 + 1] - X[a * 3 + 1], cz = X[d * 3 + 2] - X[a * 3 + 2];
  return (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
};

/**
 * @param {ReturnType<import("./gmsh.js").parseMsh>} parsed
 * @param {object} o
 * @param {"faces"|"angle"} o.method   how gmsh was asked (src/solver/gmsh.js)
 * @param {{ positions: Float64Array, tris: Uint32Array, faceOf: Uint32Array, faces: object[] }} o.part
 * @returns {{
 *   order: 1|2, nodes: Float64Array, tets: Uint32Array, per: 4|10,
 *   skin: { nodes: Uint32Array, per: 3|6, tet: Uint32Array, local: Uint8Array, face: Int32Array, count: number },
 *   volume: number, quality: { worst: number, poor: number }, turned: number, unplaced: number }}
 *   skin.nodes: each skin triangle's corners (outward) then mid-edge nodes; skin.face: the part's face it is on (−1: none found)
 *   quality: each tetrahedron scored 6√2·V / (longest edge)³, 1 for a regular one; `poor` counts those under 0.02
 *   turned: tetrahedra that came inside out and were turned; unplaced: skin triangles on no face of the part
 */
export function finishMesh(parsed, { method, part }) {
  const { order, nodes } = parsed;
  const per = order === 1 ? 4 : 10;
  const tets = Uint32Array.from(parsed.tets);
  const T = tets.length / per;
  let volume = 0, worst = Infinity, poor = 0, turned = 0;
  for (let t = 0; t < T; t++) {
    const o = t * per;
    if (per === 10) {
      const s = tets[o + 8];
      tets[o + 8] = tets[o + 9];
      tets[o + 9] = s;
    }
    let v = signedVolume(nodes, tets[o], tets[o + 1], tets[o + 2], tets[o + 3]);
    if (v < 0) {
      // swap corners 0 and 1; the mid-edge nodes follow their edges
      const swap = (i, j) => {
        const s = tets[o + i];
        tets[o + i] = tets[o + j];
        tets[o + j] = s;
      };
      swap(0, 1);
      if (per === 10) {
        swap(5, 6);
        swap(7, 8);
      }
      v = -v;
      turned++;
    }
    volume += v;
    let longest = 0;
    for (const [a, b] of TET_EDGES) {
      const p = tets[o + a] * 3, q = tets[o + b] * 3;
      const l = Math.hypot(nodes[p] - nodes[q], nodes[p + 1] - nodes[q + 1], nodes[p + 2] - nodes[q + 2]);
      if (l > longest) longest = l;
    }
    const score = longest > 0 ? (6 * Math.SQRT2 * v) / longest ** 3 : 0;
    if (score < worst) worst = score;
    if (score < 0.02) poor++;
  }

  // the skin: every tetrahedron face no other tetrahedron shares
  const N = nodes.length / 3;
  const pairs = new Map(); // lowest two corners → [third, tet·4 + local, …]
  for (let t = 0; t < T; t++)
    for (let l = 0; l < 4; l++) {
      const F = TET_FACES[l];
      let a = tets[t * per + F[0]], b = tets[t * per + F[1]], c = tets[t * per + F[2]];
      if (a > b) [a, b] = [b, a];
      if (b > c) [b, c] = [c, b];
      if (a > b) [a, b] = [b, a];
      const key = a * N + b;
      const list = pairs.get(key);
      if (!list) {
        pairs.set(key, [c, t * 4 + l]);
        continue;
      }
      // the list is (third corner, owner) pairs: look for the corner at the even places only
      let at = -1;
      for (let i = 0; i < list.length && at < 0; i += 2) if (list[i] === c) at = i;
      if (at >= 0) list.splice(at, 2);
      else list.push(c, t * 4 + l);
    }
  const owners = [];
  for (const list of pairs.values()) for (let i = 1; i < list.length; i += 2) owners.push(list[i]);
  owners.sort((x, y) => x - y);
  const count = owners.length;
  const sper = per === 4 ? 3 : 6;
  const skin = { nodes: new Uint32Array(count * sper), per: sper, tet: new Uint32Array(count), local: new Uint8Array(count), face: new Int32Array(count).fill(-1), count };
  owners.forEach((owner, s) => {
    const t = owner >> 2, l = owner & 3;
    skin.tet[s] = t;
    skin.local[s] = l;
    for (let k = 0; k < sper; k++) skin.nodes[s * sper + k] = tets[t * per + TET_FACES[l][k]];
  });

  // which face of the part each skin triangle is on
  let unplaced = 0;
  if (method === "faces") {
    const surfaceOf = new Map();
    const key3 = (a, b, c) => {
      if (a > b) [a, b] = [b, a];
      if (b > c) [b, c] = [c, b];
      if (a > b) [a, b] = [b, a];
      return `${a},${b},${c}`;
    };
    for (let i = 0; i < parsed.skinSurface.length; i++) surfaceOf.set(key3(parsed.skin[i * 3], parsed.skin[i * 3 + 1], parsed.skin[i * 3 + 2]), parsed.skinSurface[i]);
    const faces = part.faces.length;
    for (let s = 0; s < count; s++) {
      const surface = surfaceOf.get(key3(skin.nodes[s * sper], skin.nodes[s * sper + 1], skin.nodes[s * sper + 2]));
      const face = surface === undefined ? -1 : surface - 1;
      if (face >= 0 && face < faces) skin.face[s] = face;
      else unplaced++;
    }
  } else {
    const near = nearestFace(part);
    for (let s = 0; s < count; s++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        const p = skin.nodes[s * sper + k] * 3;
        x += nodes[p] / 3;
        y += nodes[p + 1] / 3;
        z += nodes[p + 2] / 3;
      }
      skin.face[s] = near(x, y, z);
    }
  }
  return { order, nodes, tets, per, skin, volume, quality: { worst: T ? worst : 0, poor }, turned, unplaced };
}

/** The squared distance from a point to a triangle. */
export function pointTriangle2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  // Ericson, Real-Time Collision Detection, 5.1.5
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) [qx, qy, qz] = [ax, ay, az];
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) [qx, qy, qz] = [bx, by, bz];
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        [qx, qy, qz] = [ax + v * abx, ay + v * aby, az + v * abz];
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) [qx, qy, qz] = [cx, cy, cz];
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            [qx, qy, qz] = [ax + w * acx, ay + w * acy, az + w * acz];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              [qx, qy, qz] = [bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)];
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom, w = vc * denom;
              [qx, qy, qz] = [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
            }
          }
        }
      }
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/**
 * A function from a point to the face of the part nearest it: the part's
 * triangles binned in a grid, searched outward a shell of cells at a time
 * until nothing nearer can be left.
 */
export function nearestFace({ positions, tris, faceOf }) {
  const T = tris.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (positions[i + k] < min[k]) min[k] = positions[i + k];
      if (positions[i + k] > max[k]) max[k] = positions[i + k];
    }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const res = Math.max(1, Math.min(64, Math.round(Math.cbrt(T))));
  const cell = span / res;
  const dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((max[k] - min[k]) / cell + 1e-9)));
  const at = (v, k) => Math.max(0, Math.min(dims[k] - 1, Math.floor((v - min[k]) / cell)));
  const bins = new Map();
  for (let t = 0; t < T; t++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) {
        const v = positions[tris[t * 3 + j] * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    for (let x = at(lo[0], 0); x <= at(hi[0], 0); x++)
      for (let y = at(lo[1], 1); y <= at(hi[1], 1); y++)
        for (let z = at(lo[2], 2); z <= at(hi[2], 2); z++) {
          const key = (x * dims[1] + y) * dims[2] + z;
          const b = bins.get(key);
          if (b) b.push(t);
          else bins.set(key, [t]);
        }
  }
  const reach = Math.max(...dims);
  return (px, py, pz) => {
    const c = [at(px, 0), at(py, 1), at(pz, 2)];
    let best = Infinity, bestT = -1;
    for (let r = 0; r <= reach; r++) {
      // every cell at Chebyshev distance r from the point's own
      for (let x = c[0] - r; x <= c[0] + r; x++) {
        if (x < 0 || x >= dims[0]) continue;
        for (let y = c[1] - r; y <= c[1] + r; y++) {
          if (y < 0 || y >= dims[1]) continue;
          const edge = Math.abs(x - c[0]) === r || Math.abs(y - c[1]) === r;
          for (let z = c[2] - r; z <= c[2] + r; z += edge ? 1 : Math.max(1, 2 * r)) {
            if (z < 0 || z >= dims[2]) continue;
            const b = bins.get((x * dims[1] + y) * dims[2] + z);
            if (!b) continue;
            for (const t of b) {
              const A = tris[t * 3] * 3, B = tris[t * 3 + 1] * 3, C = tris[t * 3 + 2] * 3;
              const d = pointTriangle2(px, py, pz, positions[A], positions[A + 1], positions[A + 2], positions[B], positions[B + 1], positions[B + 2], positions[C], positions[C + 1], positions[C + 2]);
              if (d < best) {
                best = d;
                bestT = t;
              }
            }
          }
        }
      }
      // anything in a farther shell is at least r cells away from the point's cell: (r) · cell from the point at worst case 0
      if (bestT >= 0 && best <= (r * cell) ** 2) break;
    }
    return bestT < 0 ? -1 : faceOf[bestT];
  };
}
