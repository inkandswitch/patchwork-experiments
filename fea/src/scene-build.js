// A study or a run as a GLB for the scene. Pure: decoded data in, bytes out.
//
// Frame: a part is kept in the frame its own render has (glTF's: Y up,
// metres), and the mesh and its results are in that frame too. So nothing is
// turned or scaled here, and a study dropped where its part stands lies
// exactly on it.

import { encodeGLB, computeBounds, MODE } from "./glb.js";
import { partGeometry, resultGeometry, modesOf } from "./draw/result.js";
import { setupGlyphs } from "./draw/glyphs.js";
import { num } from "./units.js";

const SUPPORT_COLOR = "#2f7dd1";
const LOAD_COLOR = "#d9432f";
const LAYERS = [
  { id: "part", name: "Part" },
  { id: "supports", name: "Supports" },
  { id: "loads", name: "Loads" },
];

/**
 * @param {object} o
 * @param {object|null} o.layer    a finished run's skin (decodeLayer), or null: no results yet
 * @param {object|null} o.part     the part (decodePart): drawn plain when there is no layer, and where the marks stand
 * @param {object|null} o.setup    normalised: whose supports and loads are marked
 * @param {object} o.params        the scene params (SCENE_PARAMS, coerced)
 * @param {string[]} [o.notes]
 * @returns {{ kind: "glb", glb: Uint8Array, meta: { bounds: object|null, notes: string } }}
 */
export function buildStudyGLB({ layer = null, part = null, setup = null, params = {}, notes = [] }) {
  const meshes = [];
  const nodes = [];
  const said = [...notes];
  const add = (mesh, layerId) => {
    meshes.push(mesh);
    nodes.push({ name: mesh.name, mesh: meshes.length - 1, extras: { layer: layerId } });
  };
  if (layer && part) {
    const modal = modesOf(layer);
    let field = params.show ?? "auto";
    if (modal.length) {
      const mode = modal.includes(params.mode) ? params.mode : modal[0];
      if (mode !== params.mode && params.mode != null && params.mode !== 1) said.push(`the run has no mode ${params.mode}: mode ${mode} is shown`);
      field = field === "plain" ? "plain" : `m${mode}`;
    } else if (field === "auto") field = "vm";
    const g = resultGeometry(layer, { field, deform: params.deform ?? "auto", diagonal: part.diagonal });
    const prim = { positions: g.positions, normals: g.normals, indices: g.indices, roughness: 0.7 };
    if (g.colors) prim.colors = g.colors;
    add({ name: "Result", primitives: [prim], extras: g.legend ? { legend: g.legend } : {} }, "part");
    // (a mode's shape has no size of its own to compare with)
    if (g.scale && g.scale !== 1 && !modal.length) said.push(`drawn moved ${num(g.scale, 2)}× what it really moves`);
  } else if (part) {
    const g = partGeometry(part);
    add({ name: "Part", primitives: [{ positions: g.positions, normals: g.normals, indices: g.indices, roughness: 0.7 }] }, "part");
  }
  if (part && setup && params.marks !== false) {
    const marks = setupGlyphs(part, setup);
    const lines = (name, segments, color, id) => {
      if (!segments.length) return;
      add({ name, primitives: [{ positions: segments, mode: MODE.LINES, color, unlit: true }] }, id);
    };
    lines("Supports", marks.supports, SUPPORT_COLOR, "supports");
    lines("Loads", marks.loads, LOAD_COLOR, "loads");
  }
  const glb = encodeGLB({ meshes, nodes, extras: { layers: LAYERS }, generator: "patchwork fea" });
  let bounds = null;
  for (const m of meshes)
    for (const p of m.primitives) {
      const b = computeBounds(p.positions);
      if (!b) continue;
      bounds = bounds ? { min: bounds.min.map((v, k) => Math.min(v, b.min[k])), max: bounds.max.map((v, k) => Math.max(v, b.max[k])) } : b;
    }
  return { kind: "glb", glb, meta: { bounds, notes: said.join("; ") } };
}
