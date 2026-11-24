// scene:source "flow-field-streamlines": a seed rake → RK4 streamlines → GLB.
// Pure (doc + params in, bytes out); scene-streamlines.js wraps it for the host.

import { referenceSpeed } from "./field.js";
import { compileFlow } from "./flow.js";
import { bodyNote } from "./body-notes.js";
import { rakeSeeds, traceStreamline, bodyHugSeeds, traceThrough, widenAcross } from "./integrate.js";
import { withBodyModel } from "./body.js";
import { dedupePolyline, simplifyPolyline, linesMesh, tubesMesh, capPoints } from "./geometry.js";
import { autoColormap, bakeColors, resolveRange, isDiverging, legendFor } from "./colormap.js";
import { toGltfInPlace, boxToGltf } from "./coords.js";
import { encodeGLB, computeBounds, MODE } from "./glb.js";
import { STREAMLINE_PARAMS, coerceParams, paramDefaults, paramSpec } from "./params.js";

export const STREAMLINE_DEFAULTS = Object.freeze(paramDefaults(STREAMLINE_PARAMS));

/**
 * Each result is stored as a doc (and the build may fall back to the main
 * thread when no worker can be started), so the mesh is capped at about 2.5 MB: past this many
 * vertices the tubes go from 6 sides to 4, and then the lines are thinned.
 * The seed limits are the declared maxima in params.js.
 */
export const MAX_MESH_VERTICES = 48000;
export const MAX_SEEDS_PER_ROW = paramSpec(STREAMLINE_PARAMS, "seedCount").max;
export const MAX_RAKE_ROWS = paramSpec(STREAMLINE_PARAMS, "rakeRows").max;
export const MAX_HUG_LINES = paramSpec(STREAMLINE_PARAMS, "hugLines").max;

const finite = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * Params with defaults filled and clamped exactly as the scene host does
 * (params.js), so the declared metadata is the only source of bounds.
 */
export function streamlineParams(params = {}) {
  return coerceParams(STREAMLINE_PARAMS, params);
}

/**
 * The streamlines themselves, in the document frame.
 * @param {object} [ctx]  { section } for a linked body (see section.js)
 */
export function computeStreamlines(doc, params = {}, ctx = {}) {
  const p = streamlineParams(params);
  const field = compileFlow(withBodyModel(doc, p.bodyModel), ctx.section ?? null);
  // A waterplane body is a 2D flow: trace in each row's plane. (A slender body,
  // like the doc's own elements, is 3D.)
  const planar = field.body?.model === "waterplane-2d";
  const docCount = Math.max(1, Math.min(MAX_SEEDS_PER_ROW, Math.floor(finite(doc?.seeds?.count, 15))));
  const count = p.seedCount > 0 ? p.seedCount : docCount;
  const seeds = rakeSeeds(field, { count, height: p.seedHeight, rows: p.rakeRows, rowSpacing: p.rowSpacing });
  // traced in a domain widened across the stream, so a line the body pushes
  // out sideways still reaches the downstream face instead of stopping short
  const opts = { step: p.step, maxSteps: p.maxSteps, planar, domain: widenAcross(field) };
  // A slender body is a double body: its section plane (the waterline) is a
  // plane of symmetry, where the vertical velocity is zero, as it is at a free
  // surface. A seed a few centimetres off that plane (lifted so its tube clears
  // a slice drawn in it) would drift up over the fictitious upper half of the
  // body of revolution and through the real hull above the water, so it is
  // held level instead.
  const onPlane = (z) =>
    field.body?.model === "slender-body-3d" && Math.abs(z - (field.body.z0 ?? 0)) <= Math.max(0.05, 2 * p.tubeRadius);
  const optsAt = (seed) => (onPlane(seed[2]) ? { ...opts, planar: true } : opts);
  const lines = [];
  const keep = (tr, extra = {}) => {
    const d = dedupePolyline(tr.points, { speed: tr.speeds, cp: tr.cps });
    const s = simplifyPolyline(d.points, d.fields, { maxTurnDeg: 2, maxSegment: Math.max(0.4, 3 * p.step) });
    if (s.points.length >= 2) lines.push({ ...s, end: tr.end, ...extra });
  };
  for (const seed of seeds) keep(traceStreamline(field, seed, optsAt(seed)));
  // and a few that pass right by a linked body (the rake's seeds are too far
  // apart to); with tubes, the closest one's surface a tube radius clear of it
  const hug = p.hugLines
    ? bodyHugSeeds(field, { count: p.hugLines, height: p.seedHeight, first: p.tubes ? 2 * p.tubeRadius : undefined })
    : [];
  for (const h of hug) keep(traceThrough(field, h.seed, { ...optsAt(h.seed), maxSteps: 2 * p.maxSteps }), { hug: h.offset });
  return { field, params: p, seeds, hug, lines };
}

/**
 * @param {object} [ctx]  { section, result } from section.js when doc.body is set;
 *                        `result` only feeds the notes
 */
export function buildStreamlines(doc, params = {}, ctx = {}) {
  const { field, params: p, seeds, hug, lines: traced } = computeStreamlines(doc, params, ctx);
  const names = ["speed", "cp"];
  const points = traced.reduce((a, l) => a + l.points.length, 0);
  const sides = points * 6 <= MAX_MESH_VERTICES ? 6 : 4;
  const lines = capPoints(traced, p.tubes ? Math.floor(MAX_MESH_VERTICES / sides) : MAX_MESH_VERTICES);
  const thinned = lines !== traced;
  const mesh = p.tubes ? tubesMesh(lines, names, { radius: p.tubeRadius, sides }) : linesMesh(lines, names);
  const colorValues = p.colorBy === "cp" ? mesh.fields.cp : mesh.fields.speed;
  const cmap = p.colormap === "auto" ? autoColormap(p.colorBy) : p.colormap;
  // Cp on a diverging map: centre on 0 so the undisturbed stream is neutral
  const range = resolveRange(colorValues, { ...p, symmetric: p.colorBy === "cp" && isDiverging(cmap) });
  const colors = bakeColors(colorValues, range, cmap);

  const positions = toGltfInPlace(mesh.positions);
  const prim = {
    positions,
    indices: mesh.indices,
    mode: p.tubes ? MODE.TRIANGLES : MODE.LINES,
    colors,
    attributes: { _SPEED: mesh.fields.speed, _CP: mesh.fields.cp },
    color: [1, 1, 1, 1], // white base so COLOR_0 shows as baked
    roughness: 0.6,
  };
  if (mesh.normals) prim.normals = toGltfInPlace(mesh.normals);

  const name = p.tubes ? "Streamlines (tubes)" : "Streamlines";
  const extras = {
    colorBy: p.colorBy,
    colormap: cmap,
    range,
    referenceSpeed: referenceSpeed(field),
    streamlines: lines.length,
    legend: legendFor(p.colorBy, range, cmap),
  };
  const glb = encodeGLB({
    generator: "flow-field",
    meshes: [{ name, extras, primitives: [prim] }],
  });
  const bounds = computeBounds(positions) ?? boxToGltf(field.domain);
  const unit = p.colorBy === "cp" ? "" : " m/s";
  const notes =
    `${lines.length} streamline${lines.length === 1 ? "" : "s"} from ${seeds.length} seed${seeds.length === 1 ? "" : "s"}` +
    (hug.length ? ` and ${hug.length} passing the body ${fmtOffsets(hug)} off` : "") +
    "; " +
    `${p.colorBy === "cp" ? "Cp" : "speed"} ${range[0].toFixed(2)}–${range[1].toFixed(2)}${unit} (${cmap})` +
    (thinned ? `; thinned to ${MAX_MESH_VERTICES} vertices` : "") +
    bodyNote(withBodyModel(doc, p.bodyModel), field, ctx.result);
  return { glb, meta: { bounds, notes }, lines, range };
}

function fmtOffsets(hug) {
  const ds = [...new Set(hug.map((h) => Math.round(h.offset * 1000)))].sort((a, b) => a - b);
  return ds.map((d) => (d < 1000 ? `${d} mm` : `${(d / 1000).toFixed(2)} m`)).join(", ");
}
