// A setup's supports and loads, on a mesh: which nodes are held, and the
// force at every node that stands for each load.
//
// A load on a face is a traction over its skin triangles. The nodal forces
// that do the same work are ∫ Nᵢ t dA over each triangle (the "consistent"
// loads), integrated here rather than left to the solver, so that every kind
// of load takes one path and its total can be checked: the shape functions
// sum to one, so the nodal forces of a triangle sum to ∫ t dA exactly.
//
//   force     a total, in a direction: t = F / A, A the area the load's faces
//             have on this mesh. The nodal forces sum to F to rounding.
//   pressure  t = −p n, n the outward normal at each point: it pushes in, and
//             follows a curved face round.
//   gravity   isn't a face load: the solver applies it to every element.
//
// On a six-node triangle a uniform load puts NOTHING on the corners and a
// third on each mid-edge node; that is what the integral gives, and why
// loads aren't shared out by hand.

/** Degree-5 quadrature on the unit triangle (Radon's seven points); weights sum to ½. */
const A1 = 0.470142064105115, B1 = 0.05971587178977, A2 = 0.101286507323456, B2 = 0.797426985353087;
const W1 = 0.0661970763942531, W2 = 0.0629695902724136;
const GAUSS = [
  [1 / 3, 1 / 3, 0.1125],
  [A1, A1, W1], [B1, A1, W1], [A1, B1, W1],
  [A2, A2, W2], [B2, A2, W2], [A2, B2, W2],
];

/** Shape functions and their ξ, η derivatives at a point of the unit triangle, for 3 or 6 nodes. */
function shape(per, xi, eta) {
  const l1 = 1 - xi - eta, l2 = xi, l3 = eta;
  if (per === 3) return { N: [l1, l2, l3], dXi: [-1, 1, 0], dEta: [-1, 0, 1] };
  return {
    N: [l1 * (2 * l1 - 1), l2 * (2 * l2 - 1), l3 * (2 * l3 - 1), 4 * l1 * l2, 4 * l2 * l3, 4 * l3 * l1],
    dXi: [1 - 4 * l1, 4 * l2 - 1, 0, 4 * (l1 - l2), 4 * l3, -4 * l3],
    dEta: [1 - 4 * l1, 0, 4 * l3 - 1, -4 * l2, 4 * l2, 4 * (l1 - l3)],
  };
}

/**
 * One skin triangle's integrals: ∫ Nᵢ dA (a number a node) and ∫ Nᵢ n dA (a
 * vector a node, n the outward unit normal), and its area and ∫ n dA.
 * @param {Float64Array} X      node coordinates
 * @param {ArrayLike<number>} tri   its 3 or 6 nodes, corners outward-ordered first
 */
export function triangleIntegrals(X, tri) {
  const per = tri.length;
  const scalar = new Float64Array(per);
  const vector = new Float64Array(per * 3);
  let area = 0;
  const normal = [0, 0, 0];
  for (const [xi, eta, w] of GAUSS) {
    const { N, dXi, dEta } = shape(per, xi, eta);
    let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
    for (let i = 0; i < per; i++) {
      const p = tri[i] * 3;
      ax += dXi[i] * X[p];
      ay += dXi[i] * X[p + 1];
      az += dXi[i] * X[p + 2];
      bx += dEta[i] * X[p];
      by += dEta[i] * X[p + 1];
      bz += dEta[i] * X[p + 2];
    }
    // x_ξ × x_η: the outward normal times the area element
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const dA = Math.hypot(nx, ny, nz);
    area += w * dA;
    normal[0] += w * nx;
    normal[1] += w * ny;
    normal[2] += w * nz;
    for (let i = 0; i < per; i++) {
      scalar[i] += w * N[i] * dA;
      vector[i * 3] += w * N[i] * nx;
      vector[i * 3 + 1] += w * N[i] * ny;
      vector[i * 3 + 2] += w * N[i] * nz;
    }
  }
  return { scalar, vector, area, normal };
}

/** The skin triangles on any of these faces. */
export function skinOn(skin, faces) {
  const want = new Set(faces);
  const out = [];
  for (let s = 0; s < skin.count; s++) if (want.has(skin.face[s])) out.push(s);
  return out;
}

/** The nodes of these skin triangles, each once, ascending. */
export function nodesOf(skin, triangles) {
  const seen = new Set();
  for (const s of triangles) for (let k = 0; k < skin.per; k++) seen.add(skin.nodes[s * skin.per + k]);
  return Uint32Array.from(seen).sort();
}

/**
 * How much of the solid's volume each node stands for under a load spread
 * evenly through it (gravity): ∫ Nᵢ dV, summed over its tetrahedra. For a
 * straight ten-node tetrahedron that is −V/20 at each corner and V/5 at each
 * mid-edge node (yes, negative at the corners); for a four-node one, V/4 each.
 * The shares sum to the volume.
 * @returns {Float64Array} one a node (m³)
 */
export function volumeShares({ nodes: X, tets, per }) {
  const out = new Float64Array(X.length / 3);
  for (let o = 0; o < tets.length; o += per) {
    const a = tets[o] * 3, b = tets[o + 1] * 3, c = tets[o + 2] * 3, d = tets[o + 3] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
    const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const wx = X[d] - X[a], wy = X[d + 1] - X[a + 1], wz = X[d + 2] - X[a + 2];
    const V = (ux * (vy * wz - vz * wy) + uy * (vz * wx - vx * wz) + uz * (vx * wy - vy * wx)) / 6;
    if (per === 4) for (let k = 0; k < 4; k++) out[tets[o + k]] += V / 4;
    else {
      for (let k = 0; k < 4; k++) out[tets[o + k]] -= V / 20;
      for (let k = 4; k < 10; k++) out[tets[o + k]] += V / 5;
    }
  }
  return out;
}

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : null;
};

/**
 * @param {ReturnType<import("./mesh.js").finishMesh>} mesh
 * @param {{ supports: object[], loads: object[] }} model  the setup in SI (src/setup.js, solverModel):
 *   supports: [{ id, name, kind: "fixed" | "slide", faces: number[] }]
 *   loads: [{ id, name, kind: "force", faces, force: [x, y, z] }            newtons, the total
 *           { id, name, kind: "pressure", faces, pressure }                 pascals, pushing in
 *           { id, name, kind: "gravity", acceleration: [x, y, z] }]         m/s²
 * @returns {{
 *   supports: { id: string, name: string, kind: string, nodes: Uint32Array, area: number, normal: number[]|null }[],
 *   nodal: Map<number, number[]>,      // node → the force on it (N), every face load summed
 *   loads: { id: string, name: string, kind: string, area: number, total: number[] }[],
 *   gravity: number[]|null,            // the summed acceleration, or null
 *   problems: string[] }}
 *   A load's `total` is the sum of the nodal forces it made (a pressure's is ∫ −p n dA).
 */
export function applySetup(mesh, model) {
  const { skin, nodes: X } = mesh;
  const problems = [];
  const nodal = new Map();
  const add = (node, fx, fy, fz) => {
    const f = nodal.get(node);
    if (f) {
      f[0] += fx;
      f[1] += fy;
      f[2] += fz;
    } else nodal.set(node, [fx, fy, fz]);
  };
  const cache = new Map();
  const integrals = (s) => {
    let v = cache.get(s);
    if (!v) cache.set(s, (v = triangleIntegrals(X, skin.nodes.subarray(s * skin.per, (s + 1) * skin.per))));
    return v;
  };

  const supports = [];
  for (const sup of model.supports ?? []) {
    const on = skinOn(skin, sup.faces ?? []);
    if (!on.length) {
      problems.push(`the support “${sup.name}” is on no face of the mesh`);
      continue;
    }
    let area = 0;
    const n = [0, 0, 0];
    for (const s of on) {
      const I = integrals(s);
      area += I.area;
      for (let k = 0; k < 3; k++) n[k] += I.normal[k];
    }
    // a slide needs one direction to hold: its faces' common normal
    const mean = Math.hypot(n[0], n[1], n[2]) > 0.999 * area ? unit(n) : null;
    if (sup.kind === "slide" && !mean) {
      problems.push(`the support “${sup.name}” slides, so its faces must be flat and face one way`);
      continue;
    }
    supports.push({ id: sup.id, name: sup.name, kind: sup.kind === "slide" ? "slide" : "fixed", nodes: nodesOf(skin, on), area, normal: mean });
  }

  const loads = [];
  let gravity = null;
  for (const load of model.loads ?? []) {
    if (load.kind === "gravity") {
      gravity ??= [0, 0, 0];
      for (let k = 0; k < 3; k++) gravity[k] += load.acceleration[k];
      loads.push({ id: load.id, name: load.name, kind: "gravity", area: 0, total: [0, 0, 0] });
      continue;
    }
    const on = skinOn(skin, load.faces ?? []);
    if (!on.length) {
      problems.push(`the load “${load.name}” is on no face of the mesh`);
      continue;
    }
    let area = 0;
    for (const s of on) area += integrals(s).area;
    const total = [0, 0, 0];
    for (const s of on) {
      const I = integrals(s);
      for (let i = 0; i < skin.per; i++) {
        let fx, fy, fz;
        if (load.kind === "pressure") {
          fx = -load.pressure * I.vector[i * 3];
          fy = -load.pressure * I.vector[i * 3 + 1];
          fz = -load.pressure * I.vector[i * 3 + 2];
        } else {
          const w = I.scalar[i] / area;
          fx = load.force[0] * w;
          fy = load.force[1] * w;
          fz = load.force[2] * w;
        }
        add(skin.nodes[s * skin.per + i], fx, fy, fz);
        total[0] += fx;
        total[1] += fy;
        total[2] += fz;
      }
    }
    loads.push({ id: load.id, name: load.name, kind: load.kind, area, total });
  }
  if (gravity && Math.hypot(...gravity) === 0) gravity = null;
  return { supports, nodal, loads, gravity, problems };
}
