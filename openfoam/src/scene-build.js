// A finished run as a GLB for the scene. Pure: decoded layers in, bytes out.
//
// Frame: the layers are in the floating frame (x bow, y port, z up, metres);
// glTF is Y-up, so X = x, Y = z, Z = −y (a proper rotation; handedness
// survives). That puts the hull exactly where the hull's own render sits,
// so the results object dropped at the same place lines up with it.
//
// A half model (y ≤ 0, a symmetry plane at y = 0) is mirrored to the full
// hull by reflecting y and reversing each triangle's winding. The centre
// plane is the symmetry plane itself and is never mirrored.

import { encodeGLB, computeNormals, MODE } from "./glb.js";
import { bakeColors, bakeColorsAlpha, robustRange, symmetricRange, legendStops, toLinear, sampleColormap } from "./colormap.js";
import { FIELD_INFO } from "./protocol.js";

/** floating (x, y, z) → glTF (x, z, −y) */
function toGltf(pos) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    out[i] = pos[i];
    out[i + 1] = pos[i + 2];
    out[i + 2] = -pos[i + 1];
  }
  return out;
}

/** A triangle layer, with its mirror image appended when asked. */
export function mirrorTriangles(layer, mirror) {
  const { positions, indices, fields } = layer;
  if (!mirror) return { positions, indices, fields };
  const n = positions.length / 3;
  const pos = new Float32Array(positions.length * 2);
  pos.set(positions);
  for (let i = 0; i < n; i++) {
    pos[(n + i) * 3] = positions[i * 3];
    pos[(n + i) * 3 + 1] = -positions[i * 3 + 1];
    pos[(n + i) * 3 + 2] = positions[i * 3 + 2];
  }
  const idx = new Uint32Array(indices.length * 2);
  idx.set(indices);
  for (let t = 0; t < indices.length; t += 3) {
    // reflected: reverse the winding so normals still face out
    idx[indices.length + t] = n + indices[t];
    idx[indices.length + t + 1] = n + indices[t + 2];
    idx[indices.length + t + 2] = n + indices[t + 1];
  }
  const f = {};
  for (const [k, v] of Object.entries(fields)) {
    const a = new Float32Array(v.length * 2);
    a.set(v);
    a.set(v, v.length);
    f[k] = a;
  }
  return { positions: pos, indices: idx, fields: f };
}

/** Lines (counts of points per polyline) → LINES index pairs, mirrored when asked. */
export function linesGeometry(layer, mirror) {
  const { positions, counts, fields } = layer;
  const n = positions.length / 3;
  const copies = mirror ? 2 : 1;
  const pos = new Float32Array(positions.length * copies);
  pos.set(positions);
  if (mirror)
    for (let i = 0; i < n; i++) {
      pos[(n + i) * 3] = positions[i * 3];
      pos[(n + i) * 3 + 1] = -positions[i * 3 + 1];
      pos[(n + i) * 3 + 2] = positions[i * 3 + 2];
    }
  const idx = [];
  for (let c = 0; c < copies; c++) {
    let start = c * n;
    for (const k of counts) {
      for (let j = 0; j + 1 < k; j++) idx.push(start + j, start + j + 1);
      start += k;
    }
  }
  const f = {};
  for (const [k, v] of Object.entries(fields)) {
    const a = new Float32Array(v.length * copies);
    for (let c = 0; c < copies; c++) a.set(v, c * v.length);
    f[k] = a;
  }
  return { positions: pos, indices: Uint32Array.from(idx), fields: f };
}

/** Drop triangles whose every corner is air (a free-surface run's planes reach above the water). */
export function waterOnly(geom) {
  const a = geom.fields.alpha;
  if (!a) return geom;
  const keep = [];
  for (let t = 0; t < geom.indices.length; t += 3) {
    const i = geom.indices[t], j = geom.indices[t + 1], k = geom.indices[t + 2];
    if (a[i] >= 0.5 || a[j] >= 0.5 || a[k] >= 0.5) keep.push(i, j, k);
  }
  return { ...geom, indices: Uint32Array.from(keep) };
}

/** The colour range for a field: symmetric about 0 for the diverging ones. */
export function fieldRange(name, values) {
  const r = robustRange(values);
  return FIELD_INFO[name]?.diverging ? symmetricRange(r) : r;
}
const mapFor = (name) => (FIELD_INFO[name]?.diverging ? "coolwarm" : "viridis");

function legend(name, range, extra = "") {
  const info = FIELD_INFO[name] ?? { label: name, unit: "" };
  return { title: `${info.label}${extra}`, unit: info.unit, min: range[0], max: range[1], stops: legendStops(mapFor(name), 9) };
}

/**
 * Alpha that fades what the run didn't disturb: values near the field's
 * undisturbed level (0 for Cp and wave height, 1 for speed and u/V) go toward
 * 1 − fade. Distance from it is measured against the range's larger end.
 */
export function fadeAlpha(name, values, range, fade) {
  const base = name === "speed" || name === "ux" ? 1 : 0;
  const span = Math.max(Math.abs(range[0] - base), Math.abs(range[1] - base)) || 1;
  return Float32Array.from(values, (v) => {
    const d = Math.min(1, Math.abs(v - base) / span);
    return 1 - fade * (1 - Math.sqrt(d));
  });
}

/**
 * @param {object} o
 * @param {Record<string, object>} o.layers   decoded layers by name (decodeLayer)
 * @param {object} o.params                    the scene params (SCENE_PARAMS, coerced)
 * @param {"double-body"|"free-surface"} o.mode
 * @param {Float64Array|null} [o.hullTriangles] the frozen hull (floating frame), drawn plain while a run has no results
 * @param {string[]} [o.notes]
 * @returns {{ kind: "glb", glb: Uint8Array, meta: { bounds: object|null, notes: string } }}
 */
export function buildResultsGLB({ layers, params, mode, hullTriangles = null, notes = [] }) {
  const meshes = [];
  const said = [...notes];
  const free = mode === "free-surface";

  const surfaceMesh = (name, geom, field, { lit = false, fade = 0, exaggerate = 1, label = "" } = {}) => {
    const values = geom.fields[field];
    if (!values) {
      said.push(`${name} has no ${field}`);
      return null;
    }
    let positions = geom.positions;
    if (exaggerate !== 1 && field === "eta") {
      positions = Float32Array.from(positions);
      for (let i = 2; i < positions.length; i += 3) positions[i] *= exaggerate;
    }
    const range = fieldRange(field, values);
    const pos = toGltf(positions);
    const prim = {
      positions: pos,
      indices: geom.indices,
      normals: computeNormals(pos, geom.indices),
      unlit: !lit,
      roughness: 0.6,
    };
    if (fade > 0) {
      prim.colors = { array: bakeColorsAlpha(values, range, mapFor(field), fadeAlpha(field, values, range, fade)), itemSize: 4 };
      prim.blend = true;
    } else prim.colors = bakeColors(values, range, mapFor(field));
    return { name, primitives: [prim], extras: { legend: legend(field, range, label) } };
  };

  const mirrorOf = (layer) => params.mirror !== false && layer.half;

  // the hull
  const hull = layers.hull;
  if (hull && params.hull !== "off") {
    const g = mirrorTriangles(hull, mirrorOf(hull));
    if (params.hull === "plain") {
      const pos = toGltf(g.positions);
      meshes.push({ name: "Hull", primitives: [{ positions: pos, indices: g.indices, normals: computeNormals(pos, g.indices) }] });
    } else {
      const m = surfaceMesh("Hull", g, params.hull === "Cf" ? "Cf" : "Cp", { lit: true });
      if (m) meshes.push(m);
    }
  } else if (!hull && hullTriangles?.length) {
    // no results yet: the hull as it was frozen for the run
    const pos = toGltf(Float32Array.from(hullTriangles));
    meshes.push({ name: "Hull (no results yet)", primitives: [{ positions: pos, normals: computeNormals(pos) }] });
  }

  // the water surface: the wave pattern, or a double body's waterplane
  const surfName = free ? "freeSurface" : "waterplane";
  const surf = layers[surfName];
  if (surf && params.surface !== "off") {
    const field = params.surface === "auto" ? (free ? "eta" : "Cp") : params.surface;
    const g = mirrorTriangles(surf, mirrorOf(surf));
    const m = surfaceMesh(free ? "Free surface" : "Waterplane", g, field, {
      fade: params.fade ?? 0,
      exaggerate: params.exaggerate ?? 1,
      lit: field === "eta",
      label: field === "eta" && (params.exaggerate ?? 1) !== 1 ? ` (heights ×${params.exaggerate})` : "",
    });
    if (m) meshes.push(m);
  }

  for (const [key, name, field] of [
    ["wake", "Wake plane", "ux"],
    ["centreplane", "Centre plane", "ux"],
  ]) {
    const L = layers[key];
    if (!L || !params[key]) continue;
    const g = waterOnly(mirrorTriangles(L, mirrorOf(L)));
    const m = surfaceMesh(name, g, field, { fade: Math.min(params.fade ?? 0, 0.6) });
    if (m) meshes.push(m);
  }

  const sl = layers.streamlines;
  if (sl && params.streamlines !== false) {
    const g = linesGeometry(sl, mirrorOf(sl));
    const values = g.fields.speed;
    if (values) {
      const range = fieldRange("speed", values);
      meshes.push({
        name: "Streamlines",
        primitives: [{ positions: toGltf(g.positions), indices: g.indices, mode: MODE.LINES, colors: bakeColors(values, range, "viridis"), unlit: true }],
        extras: { legend: legend("speed", range) },
      });
    }
  }

  const glb = encodeGLB({ meshes, generator: "patchwork openfoam" });
  let bounds = null;
  for (const m of meshes)
    for (const p of m.primitives) {
      for (let i = 0; i < p.positions.length; i += 3) {
        if (!bounds) bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let k = 0; k < 3; k++) {
          bounds.min[k] = Math.min(bounds.min[k], p.positions[i + k]);
          bounds.max[k] = Math.max(bounds.max[k], p.positions[i + k]);
        }
      }
    }
  // the scene contract's BuildResult: kind is required (the host refuses a result without it)
  return { kind: "glb", glb, meta: { bounds, notes: said.join("; ") } };
}

// for the 2D views, which colour the same way
export { mapFor, toLinear, sampleColormap };
