// What is drawn of a part and of a run's results, as plain arrays: positions,
// triangles, normals, colours. Pure, and the one place it is worked out: the
// scene's GLB (src/scene-build.js) and the study's own view (src/view/) both
// draw what this returns, so they can't disagree about a colour or a scale.
//
// Vertices are split along the part's faces, so shading is smooth across a
// curved face and crisp at an edge, on a coarse mesh too.

import { bake, stops } from "./colors.js";
import { DIMENSIONS, prettyUnit } from "../units.js";

/** How far the largest movement is drawn, as a fraction of the part's size, when the scale is automatic. */
export const AUTO_DEFORM = 0.06;

/** Area-weighted vertex normals. */
function normalsOf(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += x;
      n[i + 1] += y;
      n[i + 2] += z;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/**
 * Triangles re-indexed so no vertex is shared between two faces.
 * @returns {{ indices: Uint32Array, from: Uint32Array }}  from: the old vertex each new one was
 */
function splitByFace(indices, faces) {
  const seen = new Map();
  const from = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    // (a million faces at most tell vertices apart; "no face", 0xffffffff, is one of them)
    const key = v * 1048576 + (faces[Math.floor(i / 3)] % 1048576);
    let at = seen.get(key);
    if (at === undefined) {
      at = from.length;
      seen.set(key, at);
      from.push(v);
    }
    out[i] = at;
  }
  return { indices: out, from: Uint32Array.from(from) };
}

/**
 * A kept part, to draw: its triangles as they are.
 * @param {{ positions: ArrayLike<number>, tris: ArrayLike<number>, faceOf: ArrayLike<number> }} part
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array, faces: Uint32Array }}
 *   faces: the part's face each triangle is on
 */
export function partGeometry(part) {
  const faces = Uint32Array.from(part.faceOf);
  const split = splitByFace(part.tris, faces);
  const positions = new Float32Array(split.from.length * 3);
  split.from.forEach((v, i) => positions.set([part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]], i * 3));
  return { positions, indices: split.indices, normals: normalsOf(positions, split.indices), faces };
}

/** The fields a layer can be coloured by, in the order a menu lists them: [{ id, label }]. */
export function fieldChoices(layer) {
  const out = [];
  if (layer?.fields?.vm) out.push({ id: "vm", label: "Stress (von Mises)" });
  if (layer?.fields?.ux) out.push({ id: "u", label: "Displacement" });
  for (const m of modesOf(layer)) out.push({ id: `m${m}`, label: `Mode ${m}` });
  out.push({ id: "plain", label: "Plain" });
  return out;
}

/** The mode numbers a modal layer holds, ascending. */
export function modesOf(layer) {
  return Object.keys(layer?.fields ?? {})
    .map((k) => k.match(/^m(\d+)x$/)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * A run's skin, to draw.
 * @param {ReturnType<import("../protocol.js").decodeLayer>} layer
 * @param {object} o
 * @param {string} [o.field]     "vm", "u", "m<n>" (a mode's shape) or "plain"; default: the first the layer has
 * @param {"auto"|"true"|"none"|number} [o.deform]  how far it is drawn moved: so the largest movement shows as
 *   AUTO_DEFORM of the part's size; as it really moved; not at all; or that many times what it really moved
 * @param {number} o.diagonal    the part's size (m), for the automatic scale
 * @param {number|null} [o.top]  the value the colours' top end is (Pa or m); default: the field's largest
 * @returns {{ positions: Float32Array, rest: Float32Array, indices: Uint32Array, normals: Float32Array, colors: Float32Array|null, faces: Uint32Array|null,
 *   field: string, scale: number, legend: { title: string, unit: string, min: number, max: number, stops: string[] } | null,
 *   range: [number, number] | null }}
 *   rest: the same points where they were before it moved;
 *   colors: linear RGB a vertex (null: plain); scale: how many times its real movement it is drawn at;
 *   legend: in a unit people read (the scene's `extras.legend`); range: the same ends in SI
 */
export function resultGeometry(layer, { field = null, deform = "auto", diagonal, top = null } = {}) {
  const choices = fieldChoices(layer);
  const chosen = choices.some((c) => c.id === field) ? field : choices[0].id;
  const mode = chosen.match(/^m(\d+)$/)?.[1] ?? null;
  // what moves it: its displacement, or the chosen mode's shape (a modal layer shown plain or by another field moves by its first mode)
  const moveBy = layer.fields.ux ? "u" : mode ? `m${mode}` : modesOf(layer).length ? `m${modesOf(layer)[0]}` : null;
  const move = moveBy ? [layer.fields[`${moveBy}x`], layer.fields[`${moveBy}y`], layer.fields[`${moveBy}z`]] : null;
  const P = layer.positions.length / 3;
  let largest = 0;
  if (move) for (let i = 0; i < P; i++) largest = Math.max(largest, Math.hypot(move[0][i], move[1][i], move[2][i]));
  // a mode's shape has no size of its own: it is always drawn at the automatic scale, unless not at all
  let scale = 0;
  if (move && largest > 0 && deform !== "none") {
    const auto = (AUTO_DEFORM * diagonal) / largest;
    if (deform === "auto" || moveBy !== "u") scale = auto;
    else if (deform === "true") scale = 1;
    else if (Number.isFinite(deform)) scale = deform;
    else scale = auto;
  }
  let values = null, dimension = null, title = "";
  if (chosen === "vm") [values, dimension, title] = [layer.fields.vm, "pressure", "Von Mises stress"];
  else if (chosen === "u" || mode) {
    const f = mode ? `m${mode}` : "u";
    const [x, y, z] = [layer.fields[`${f}x`], layer.fields[`${f}y`], layer.fields[`${f}z`]];
    values = Float32Array.from({ length: P }, (_, i) => Math.hypot(x[i], y[i], z[i]));
    [dimension, title] = mode ? [null, `Mode ${mode}: how much each part moves`] : ["length", "Displacement"];
  }
  const faces = layer.faces ?? new Uint32Array(layer.indices.length / 3);
  const split = splitByFace(layer.indices, faces);
  const V = split.from.length;
  const positions = new Float32Array(V * 3);
  const rest = new Float32Array(V * 3);
  for (let i = 0; i < V; i++) {
    const v = split.from[i];
    for (let k = 0; k < 3; k++) {
      rest[i * 3 + k] = layer.positions[v * 3 + k];
      positions[i * 3 + k] = rest[i * 3 + k] + (scale ? scale * move[k][v] : 0);
    }
  }
  let colors = null, legend = null, range = null;
  if (values) {
    let hi = 0;
    for (const v of values) if (v > hi) hi = v;
    if (Number.isFinite(top) && top > 0) hi = top;
    range = [0, hi || 1];
    colors = bake(Float32Array.from(split.from, (v) => values[v]), range);
    if (dimension) {
      const unit = prettyUnit(range[1], dimension);
      const k = DIMENSIONS[dimension].units[unit];
      legend = { title, unit, min: 0, max: range[1] / k, stops: stops(9) };
    } else legend = { title, unit: "of the most", min: 0, max: 1, stops: stops(9) };
  }
  return { positions, rest, indices: split.indices, normals: normalsOf(positions, split.indices), colors, faces: layer.faces ? Uint32Array.from(faces) : null, field: chosen, scale, legend, range };
}

/**
 * The lines between a part's faces: every edge whose two triangles are on
 * different faces, as segments (six numbers each). Drawn over the part, they
 * are what makes its faces read as faces.
 * @param {{ positions: ArrayLike<number>, tris: ArrayLike<number>, faceOf: ArrayLike<number> }} part
 * @returns {Float32Array}
 */
export function faceEdges(part) {
  const V = part.positions.length / 3;
  const first = new Map();
  const out = [];
  const push = (a, b) => out.push(part.positions[a * 3], part.positions[a * 3 + 1], part.positions[a * 3 + 2], part.positions[b * 3], part.positions[b * 3 + 1], part.positions[b * 3 + 2]);
  for (let h = 0; h < part.tris.length; h++) {
    const t = h - (h % 3);
    const a = part.tris[h], b = part.tris[t + ((h + 1) % 3)];
    const key = a < b ? a * V + b : b * V + a;
    const face = part.faceOf[t / 3];
    const other = first.get(key);
    if (other === undefined) first.set(key, face);
    else if (other !== face) push(a, b);
  }
  return Float32Array.from(out);
}
