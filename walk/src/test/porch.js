// A small structure for walk's end-to-end test (structure.test.js): a hut on
// a raised porch, railed all round, laid out as a scene doc lays one out. The
// porch is the support; every other part is under it, placed by its own
// transform (the hut turned half round, the rest moved), and drawn as boxes in
// its own frame. Everything the test expects is read off these boxes too
// (boxIn), so the expectations can't drift from what is baked.
//
// In the porch's frame: the slab is 6 × 6 m, its top at y = 0.3, rails 0.7
// high round its edge but where the hut's back wall stands. The hut (walls to
// a roof, a doorway facing +Z) takes the back half's middle; a ceiling fan
// turns in it (the swept part), and its door stands open on the porch (a
// moving part, left out). On the porch: a closed crate taller than a body
// (front left), a low dais (front right), a bench to vault (front middle), a
// doormat (the spawn) before the door, and a ladder over the right-hand rail.

import { boxTriangles } from "../navmesh.js";
import { apply, matrixOf, multiply } from "../frames.js";

/**
 * @typedef {[number[], number[]]} Box  [min, max] in its part's own frame
 * @typedef {{ name: string, parent: string | null, transform?: object, traits?: object, boxes?: Box[] }} Part
 */

/** @type {{ [id: string]: Part }} */
export const PARTS = {
  // its own pose is the stage's business: nothing in the bake or the expectations reads it
  porch: { name: "Porch", parent: null, transform: { position: [12, 0.5, -7], rotation: [0, 0.6, 0] }, traits: { "walk.support": {} }, boxes: [[[-3, 0, -3], [3, 0.3, 3]]] },
  railing: {
    name: "Railing",
    parent: "porch",
    transform: { position: [0, 0.3, 0] },
    boxes: [
      [[-3, 0, -3], [-2.9, 0.7, 3]], // left
      [[2.9, 0, -3], [3, 0.7, 3]], // right
      [[-2.9, 0, 2.9], [2.9, 0.7, 3]], // front
      [[-2.9, 0, -3], [-1.5, 0.7, -2.9]], // back, left of the hut
      [[1.5, 0, -3], [2.9, 0.7, -2.9]], // back, right of the hut
    ],
  },
  // turned half round: in its own frame the doorway is on −Z, on the porch it faces +Z
  hut: {
    name: "Hut",
    parent: "porch",
    transform: { position: [0, 0.3, -1.6], rotation: [0, Math.PI, 0] },
    traits: { "walk.stand": { at: [0.8, 0, 0.8], facing: [0, 0, 0] } },
    boxes: [
      [[-1.5, 2.3, -1.4], [1.5, 2.5, 1.4]], // roof
      [[-1.5, 0, 1.3], [1.5, 2.3, 1.4]], // back wall
      [[-1.5, 0, -1.3], [-1.4, 2.3, 1.3]], // side walls
      [[1.4, 0, -1.3], [1.5, 2.3, 1.3]],
      [[-1.5, 0, -1.4], [-0.5, 2.3, -1.3]], // front wall, either side of the doorway
      [[0.5, 0, -1.4], [1.5, 2.3, -1.3]],
    ],
  },
  fan: { name: "Ceiling fan", parent: "hut", transform: { position: [0, 1.87, 0.4] }, traits: { "walk.moves": { swept: "y" } }, boxes: [[[-0.6, -0.02, -0.06], [0.6, 0.02, 0.06]]] },
  // hinged at the doorway's edge, standing open across the porch; whoever is in the doorway stands for it
  door: {
    name: "Door",
    parent: "hut",
    transform: { position: [-0.5, 0, -1.4] },
    traits: { "walk.moves": { blocks: true }, "walk.stand": { at: [0.5, 0, 0.05], facing: [0.5, 0, 1] } },
    boxes: [[[-0.05, 0, -0.9], [0, 2, 0]]],
  },
  crate: { name: "Crate", parent: "porch", transform: { position: [-2.1, 0.3, 2.1] }, boxes: [[[-0.7, 0, -0.7], [0.7, 2, 0.7]]] },
  dais: { name: "Dais", parent: "porch", transform: { position: [1.4, 0.3, 1.4] }, traits: { "walk.stand": { at: [0, 0.25, 0], facing: [0, 0.25, -1] } }, boxes: [[[-0.6, 0, -0.6], [0.6, 0.25, 0.6]]] },
  bench: { name: "Bench", parent: "porch", transform: { position: [-0.3, 0.3, 1.6] }, traits: { "walk.stand": { at: [0.7, 0, 0] } }, boxes: [[[-0.2, 0, -0.6], [0.2, 0.7, 0.6]]] },
  doormat: { name: "Doormat", parent: "porch", transform: { position: [0, 0.3, 0.6] }, traits: { "walk.spawn": {} } },
  // hung outside the right-hand rail, its top on the porch inboard
  ladder: { name: "Ladder", parent: "porch", transform: { position: [3.05, 0.3, -1] }, traits: { "walk.ladder": { top: [-0.6, 0, 0] } }, boxes: [[[-0.05, -1.7, -0.25], [0.05, 0, 0.25]]] },
};

/** The doc's objects, as the stand-in stage takes them: each part's boxes as its model's triangles. */
export function objects() {
  const out = {};
  for (const [id, { boxes, ...o }] of Object.entries(PARTS)) out[id] = { ...o, ...(boxes ? { tris: boxes.flatMap(([lo, hi]) => boxTriangles(lo, hi)) } : {}) };
  return out;
}

/** A part's frame in the porch's: its transforms from just under the porch down to it. */
export function frameIn(id) {
  let m = matrixOf(null);
  for (let at = id; at !== "porch"; at = PARTS[at].parent) m = multiply(matrixOf(PARTS[at].transform), m);
  return m;
}

/** A point in a part's frame, in the porch's. */
export const pointIn = (id, p) => apply(frameIn(id), p);

/**
 * A part's box i in the porch's frame, [min, max] (every turn here is a half
 * turn about Y, so a box stays a box; rounded to 1e-9, which takes off the
 * turn's rounding and nothing else).
 */
export function boxIn(id, i = 0) {
  const [lo, hi] = PARTS[id].boxes[i];
  const m = frameIn(id);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
    const p = apply(m, [x, y, z]);
    for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], p[k])), (max[k] = Math.max(max[k], p[k]));
  }
  const r9 = (v) => Math.round(v * 1e9) / 1e9;
  return [min.map(r9), max.map(r9)];
}

/** Is plan point (x, z) over a box (porch frame), within `pad`? */
export const over = ([lo, hi], x, z, pad = 0) => x >= lo[0] - pad && x <= hi[0] + pad && z >= lo[2] - pad && z <= hi[2] + pad;
