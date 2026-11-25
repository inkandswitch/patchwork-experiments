// From the solver's fields to what a run keeps: the figures (how far it
// moved, how hard it is worked, whether the forces balance) and the skin of
// the mesh with its fields, for drawing. Pure.

import { volumeShares } from "./loads.js";

/** Von Mises stress at every node, from six stress components a node (xx yy zz xy yz zx). */
export function vonMises(S) {
  const n = S.length / 6;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const a = S[o] - S[o + 1], b = S[o + 1] - S[o + 2], c = S[o + 2] - S[o];
    out[i] = Math.sqrt(0.5 * (a * a + b * b + c * c) + 3 * (S[o + 3] ** 2 + S[o + 4] ** 2 + S[o + 5] ** 2));
  }
  return out;
}

const at = (X, n) => [X[n * 3], X[n * 3 + 1], X[n * 3 + 2]];

/** The value a given fraction of the way up a list, sorted (0.99: all but the top hundredth are at or under it). */
function quantile(values, q) {
  const sorted = Float64Array.from(values).sort();
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN;
}

/**
 * A static run's figures.
 * @param {object} o
 * @param {ReturnType<import("./mesh.js").finishMesh>} o.mesh
 * @param {Float64Array} o.U        displacement, 3 a node (m)
 * @param {Float64Array} o.S        stress, 6 a node (Pa)
 * @param {ReturnType<import("./loads.js").applySetup>} o.applied
 * @param {{ id: string, set: string }[]} o.sets      from writeDeck
 * @param {ReturnType<import("./frd.js").readDat>} o.dat
 * @param {{ density: number, yield: number|null }} o.material   SI
 */
export function summarizeStatic({ mesh, U, S, applied, sets, dat, material }) {
  const N = mesh.nodes.length / 3;
  const vm = vonMises(S);
  let uMax = -1, uNode = 0, sMax = -1, sNode = 0;
  for (let n = 0; n < N; n++) {
    const u = Math.hypot(U[n * 3], U[n * 3 + 1], U[n * 3 + 2]);
    if (u > uMax) [uMax, uNode] = [u, n];
    if (vm[n] > sMax) [sMax, sNode] = [vm[n], n];
  }
  const held = new Set();
  for (const s of applied.supports) for (const n of s.nodes) held.add(n);
  let freeMax = 0;
  for (let n = 0; n < N; n++) if (!held.has(n) && vm[n] > freeMax) freeMax = vm[n];
  const mass = material.density * mesh.volume;
  const weight = applied.gravity ? applied.gravity.map((g) => g * mass) : [0, 0, 0];
  const pushed = [...weight];
  for (const l of applied.loads) for (let k = 0; k < 3; k++) pushed[k] += l.total[k];
  // CalculiX's total for a support's nodes is the force inside the part there. Whatever load sits
  // on those very nodes (a share of the weight, a load on a held face) goes straight into the
  // support without stressing anything, and isn't in that total: it is added here, so a
  // support's reaction is everything it carries.
  const share = applied.gravity ? volumeShares(mesh) : null;
  /** The load on one node: its share of every face load and of the weight. */
  const loadOn = (n) => {
    const face = applied.nodal.get(n);
    const f = face ? [...face] : [0, 0, 0];
    if (share) for (let k = 0; k < 3; k++) f[k] += material.density * share[n] * applied.gravity[k];
    return f;
  };
  const direct = (s) => {
    const f = [0, 0, 0];
    for (const n of s.nodes) {
      const on = loadOn(n);
      for (let k = 0; k < 3; k++) f[k] += on[k];
    }
    return f;
  };
  // the work the loads did getting it there: ½ Σ f·u
  let work = 0;
  if (share) for (let n = 0; n < N; n++) {
    const f = loadOn(n);
    work += 0.5 * (f[0] * U[n * 3] + f[1] * U[n * 3 + 1] + f[2] * U[n * 3 + 2]);
  }
  else for (const [n, f] of applied.nodal) work += 0.5 * (f[0] * U[n * 3] + f[1] * U[n * 3 + 1] + f[2] * U[n * 3 + 2]);
  const bySet = new Map(dat.forces.map((f) => [f.set, f.force]));
  const reactions = applied.supports.map((s) => {
    const set = sets.find((x) => x.id === s.id)?.set;
    const inside = bySet.get(set) ?? null;
    const on = direct(s);
    return { id: s.id, name: s.name, kind: s.kind, force: inside ? inside.map((v, k) => v - on[k]) : null };
  });
  // a node on two supports is in both sets' totals, so the supports' totals can't simply be added: the check is only made when none is shared
  const seen = new Set();
  let shared = false;
  for (const s of applied.supports) for (const n of s.nodes) shared ||= seen.size === seen.add(n).size;
  const held3 = [0, 0, 0];
  let known = reactions.length > 0;
  for (const r of reactions) {
    if (!r.force) known = false;
    else for (let k = 0; k < 3; k++) held3[k] += r.force[k];
  }
  const size = Math.hypot(...pushed);
  const off = Math.hypot(pushed[0] + held3[0], pushed[1] + held3[1], pushed[2] + held3[2]);
  return {
    kind: "static",
    displacement: { max: uMax, at: at(mesh.nodes, uNode), vector: at(U, uNode) },
    // (in an even field every node is the highest: the peak is "at a support" only where it stands clear of
    // everything that isn't held)
    stress: { max: sMax, at: at(mesh.nodes, sNode), atSupport: held.has(sNode) && sMax > 1.05 * freeMax, p99: quantile(vm, 0.99) },
    safety: material.yield > 0 && sMax > 0 ? material.yield / sMax : null,
    loads: applied.loads.map((l) => ({ id: l.id, name: l.name, kind: l.kind, area: l.area, total: l.kind === "gravity" ? null : l.total })),
    weight: applied.gravity ? weight : null,
    pushed,
    reactions,
    // how far the supports' forces are from answering the loads, as a fraction of the loads (null: can't be told)
    balance: known && !shared && size > 0 ? off / size : null,
    // Two ways to the same number: the strain energy CalculiX adds up from its stresses, and the
    // work done by the loads, from its displacements. In a right answer they agree; `adrift` is how
    // far apart they are, as a fraction (null: no energy was printed).
    energy: dat.energy,
    work,
    adrift: dat.energy != null && work > 0 ? Math.abs(dat.energy - work) / work : null,
    mass,
    volume: mesh.volume,
  };
}

/** A modal run's figures: each mode's frequency. */
export function summarizeModal({ mesh, dat, material, modes }) {
  return {
    kind: "modal",
    modes: modes.map((m) => ({ mode: m.mode, hz: dat.frequencies.find((f) => f.mode === m.mode)?.hz ?? null })),
    mass: material.density * mesh.volume,
    volume: mesh.volume,
  };
}

/**
 * The mesh's skin with fields at its points, ready to keep and to draw: a
 * six-node triangle is cut into four, so the mid-edge values show.
 * @param {ReturnType<import("./mesh.js").finishMesh>} mesh
 * @param {{ [name: string]: Float64Array }} scalars   a value a mesh node
 * @param {{ [name: string]: Float64Array }} vectors   three a mesh node
 * @returns {{ positions: Float32Array, indices: Uint32Array, faces: Uint32Array, fields: { [name: string]: Float32Array } }}
 *   faces: the part's face each drawn triangle is on (0xffffffff: none); a vector `u` gives fields `ux`, `uy`, `uz`
 */
export function skinLayer(mesh, { scalars = {}, vectors = {} } = {}) {
  const { skin, nodes } = mesh;
  const local = new Int32Array(nodes.length / 3).fill(-1);
  const order = [];
  for (let i = 0; i < skin.nodes.length; i++) {
    const n = skin.nodes[i];
    if (local[n] < 0) {
      local[n] = order.length;
      order.push(n);
    }
  }
  const positions = new Float32Array(order.length * 3);
  order.forEach((n, i) => positions.set([nodes[n * 3], nodes[n * 3 + 1], nodes[n * 3 + 2]], i * 3));
  const cut = skin.per === 6 ? [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]] : [[0, 1, 2]];
  const indices = new Uint32Array(skin.count * cut.length * 3);
  const faces = new Uint32Array(skin.count * cut.length);
  let o = 0;
  for (let s = 0; s < skin.count; s++)
    for (const [a, b, c] of cut) {
      faces[o / 3] = skin.face[s] < 0 ? 0xffffffff : skin.face[s];
      indices[o++] = local[skin.nodes[s * skin.per + a]];
      indices[o++] = local[skin.nodes[s * skin.per + b]];
      indices[o++] = local[skin.nodes[s * skin.per + c]];
    }
  const fields = {};
  for (const [name, v] of Object.entries(scalars)) fields[name] = Float32Array.from(order, (n) => v[n]);
  for (const [name, v] of Object.entries(vectors)) "xyz".split("").forEach((axis, k) => (fields[name + axis] = Float32Array.from(order, (n) => v[n * 3 + k])));
  return { positions, indices, faces, fields };
}

/**
 * What a person should know before trusting a static run's figures: each a
 * sentence. The checks are the ones the figures allow by themselves.
 * @param {ReturnType<typeof summarizeStatic>} summary
 * @param {{ diagonal: number, yield: number|null, poor: number }} o   the part's size (m), the yield strength (Pa), badly shaped elements
 */
export function staticNotes(summary, { diagonal, yield: yieldAt, poor = 0 }) {
  const notes = [];
  const moved = summary.displacement.max / diagonal;
  if (!(moved < 10)) notes.push(`It moved ${moved >= 1000 ? "thousands of" : Math.round(moved)} times its own size: something isn't held. Supports that only slide must between them stop it moving and turning every way.`);
  else if (moved > 0.05) notes.push(`It moves ${Math.round(moved * 100)}% of its own size. This analysis assumes small movements, so past a few percent read it as a guide.`);
  if (yieldAt > 0 && summary.stress.max > yieldAt && moved < 10) notes.push("The highest stress is past the material's yield strength. Past yield a material stops springing back, and this analysis, which assumes it always does, stops describing it.");
  if (summary.stress.atSupport) notes.push("The highest stress is where a support holds the part. A fixed face stops its edge from thinning as real fixings would let it, so the stress right there climbs as the mesh gets finer: read the stress a little way off.");
  if (summary.balance != null && summary.balance > 0.01) notes.push(`The supports' forces are ${(summary.balance * 100).toFixed(1)}% off answering the loads; they should cancel.`);
  if (poor > 0) notes.push(`${poor} element${poor === 1 ? " is" : "s are"} badly shaped (nearly flat), which can spoil the stress near ${poor === 1 ? "it" : "them"}. A finer mesh usually has none.`);
  return notes;
}
