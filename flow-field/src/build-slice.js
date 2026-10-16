// scene:source "flow-field-slice": a horizontal plane through the flow,
// coloured by Cp or speed. Pure; scene-slice.js wraps it for the host.

import { velocityAt, cpFromSpeed, referenceSpeed } from "./field.js";
import { compileFlow } from "./flow.js";
import { bodyNote } from "./body-notes.js";
import { withBodyModel } from "./body.js";
import { isInsideBody } from "./integrate.js";
import { sliceGrid, coarseMask } from "./geometry.js";
import { autoColormap, bakeColors, bakeColorsAlpha, resolveRange, isDiverging, legendFor } from "./colormap.js";
import { toGltfInPlace, boxToGltf } from "./coords.js";
import { encodeGLB, computeBounds } from "./glb.js";
import { SLICE_PARAMS, coerceParams, paramDefaults, paramSpec } from "./params.js";

export const SLICE_DEFAULTS = Object.freeze(paramDefaults(SLICE_PARAMS));

/**
 * The build runs synchronously on the scene's main thread and each result is
 * stored as a doc, so this is capped: 160 cells is ~0.8 MB and well under a
 * second even with the mask. It is the declared max in params.js.
 */
export const MAX_SLICE_RESOLUTION = paramSpec(SLICE_PARAMS, "resolution").max;

/** Params with defaults filled and clamped exactly as the scene host does (params.js). */
export function sliceParams(params = {}) {
  return coerceParams(SLICE_PARAMS, params);
}

/**
 * The sampled grid, in the document frame.
 * @param {object} [ctx]  { section } for a linked body (see section.js); without one the doc's own flow
 */
export function computeSlice(doc, params = {}, ctx = {}) {
  const p = sliceParams(params);
  const field = compileFlow(withBodyModel(doc, p.bodyModel), ctx.section ?? null);
  const { min, max } = field.domain;
  const z = Math.min(max[2], Math.max(min[2], p.height));
  const cell = Math.max(max[0] - min[0], max[1] - min[1]) / p.resolution;
  const hasEmitters = field.elements.some((e) => e.kind !== "vortex-line");
  const body = field.body ?? null;
  const V = [0, 0, 0];
  // The mask traces upstream from every vertex, which is the expensive part:
  // trace a coarser lattice and only fill in vertex by vertex along edges.
  const opts = { step: Math.max(0.05, cell), maxSteps: 600 };
  const k = Math.max(1, Math.ceil(p.resolution / 60));
  const masking = p.mask && (hasEmitters || !!body);
  // a linked body is exact geometry; only the doc's own emitters need a trace
  const insideAt = (x, y) => !!body?.contains(x, y, z) || (hasEmitters && isInsideBody(field, [x, y, z], opts));
  const mask = masking ? (nx, ny, xAt, yAt) => coarseMask(nx, ny, k, (i, j) => insideAt(xAt(i), yAt(j))) : null;
  // where a grid edge crosses a body's outline: bisect between the stream end
  // (a) and the body end (b), to 1/32 of a cell
  const edge = masking
    ? (ax, ay, bx, by) => {
        let lo = 0;
        let hi = 1;
        for (let n = 0; n < 5; n++) {
          const t = (lo + hi) / 2;
          if (insideAt(ax + t * (bx - ax), ay + t * (by - ay))) hi = t;
          else lo = t;
        }
        return (lo + hi) / 2;
      }
    : null;
  const grid = sliceGrid(
    field.domain,
    z,
    p.resolution,
    ["speed", "cp"],
    (x, y, zz) => {
      velocityAt(field, x, y, zz, V);
      const speed = Math.hypot(V[0], V[1], V[2]);
      return { values: { speed, cp: cpFromSpeed(field, speed) }, masked: false };
    },
    // the outline's own vertices take the value at their stream-side grid
    // vertex: on the outline a panel body's velocity is singular (a panel's
    // ends, the transom corners: Cp −20 and worse), which drew specks
    { mask, edge, edgeSample: 0 },
  );
  return { field, params: p, z, grid };
}

/**
 * @param {object} [ctx]  { section, result } from section.js when doc.body is set;
 *                        `result` only feeds the notes
 */
export function buildSlice(doc, params = {}, ctx = {}) {
  const { field, params: p, z, grid } = computeSlice(doc, params, ctx);
  const values = p.colorBy === "speed" ? grid.fields.speed : grid.fields.cp;
  // range over the cells actually drawn: masked (inside-body) samples sit next
  // to singularities and would only stretch it
  const shown = [];
  for (let i = 0; i < values.length; i++) if (!grid.masked[i]) shown.push(values[i]);
  const cmap = p.colormap === "auto" ? autoColormap(p.colorBy) : p.colormap;
  const range = resolveRange(shown.length ? shown : values, {
    ...p,
    symmetric: p.colorBy === "cp" && isDiverging(cmap), // undisturbed stream (Cp = 0) is neutral
  });
  const alpha = p.fade > 0 ? fadeAlpha(grid, values, range, field, p) : null;
  const colors = alpha ? { array: bakeColorsAlpha(values, range, cmap, alpha), itemSize: 4 } : bakeColors(values, range, cmap);
  const positions = toGltfInPlace(grid.positions);
  const normals = toGltfInPlace(grid.normals);
  // no dots: three.js strips them from node names ("1.50" would read "150")
  const name = `Slice z = ${Math.round(z * 100)} cm`;
  const glb = encodeGLB({
    generator: "flow-field",
    meshes: [
      {
        name,
        extras: { colorBy: p.colorBy, colormap: cmap, range, height: z, legend: legendFor(p.colorBy, range, cmap) },
        primitives: [
          {
            positions,
            normals,
            indices: grid.indices,
            colors,
            attributes: { _SPEED: grid.fields.speed, _CP: grid.fields.cp },
            color: [1, 1, 1, 1],
            roughness: 0.9,
            doubleSided: true,
            // a data plane: show the colormap as baked, not shaded by the scene's lights
            unlit: true,
            blend: !!alpha,
          },
        ],
      },
    ],
  });
  const bounds = computeBounds(positions) ?? boxToGltf(field.domain);
  let maskedCount = 0;
  for (const m of grid.masked) maskedCount += m;
  const notes =
    `${grid.nx}×${grid.ny} cells at z = ${z.toFixed(2)} m; ${p.colorBy === "cp" ? "Cp" : "speed"} ` +
    `${range[0].toFixed(2)}–${range[1].toFixed(2)}${p.colorBy === "cp" ? "" : " m/s"} (${cmap})` +
    (maskedCount ? `; ${maskedCount} samples inside bodies masked` : "") +
    (p.fade > 0 ? `; undisturbed flow faded ${Math.round(p.fade * 100)}%` : "") +
    bodyNote(withBodyModel(doc, p.bodyModel), field, ctx.result);
  return { glb, meta: { bounds, notes }, grid, range };
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Per-vertex alpha for `fade`: the undisturbed stream (Cp = 0, or the
 * free-stream speed) and the edges of the domain fade toward 1 − fade, so what
 * stays opaque is where the body disturbs the flow, and the plane has no hard
 * rectangular edge. Full opacity from 60% of the way to the range's extreme.
 */
export function fadeAlpha(grid, values, range, field, p) {
  const neutral = p.colorBy === "cp" ? 0 : referenceSpeed(field);
  const reach = Math.max(Math.abs(range[0] - neutral), Math.abs(range[1] - neutral)) || 1;
  const { min, max } = field.domain;
  const margin = 0.15 * Math.min(max[0] - min[0], max[1] - min[1]);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const d = Math.min(1, Math.abs(values[i] - neutral) / reach);
    const x = grid.positions[i * 3];
    const y = grid.positions[i * 3 + 1];
    const edge = Math.min(x - min[0], max[0] - x, y - min[1], max[1] - y);
    const a = smoothstep(0, 0.6, d) * smoothstep(0, margin, edge);
    out[i] = 1 - p.fade * (1 - a);
  }
  return out;
}
