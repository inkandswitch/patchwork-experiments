// scene:source "file-3dm": Rhino .3dm → GLB (Y-up metres), one mesh per layer+colour.
import { encodeGLB, computeBounds, computeNormals } from "./glb.js";

export const RHINO_URL = "https://cdn.jsdelivr.net/npm/rhino3dm@8.35.0/";
let rhinoPromise;
export function loadRhino() {
  rhinoPromise ??= import(/* @vite-ignore */ RHINO_URL + "rhino3dm.module.min.js")
    .then((m) => m.default({ locateFile: (f) => RHINO_URL + f }))
    .catch((e) => { rhinoPromise = null; throw e; });
  return rhinoPromise;
}

const METRES = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
// Metres per unit, keyed by rhino UnitSystem *name*: the numeric values are
// openNURBS's and not in declaration order, so they're looked up at runtime.
// None, CustomUnits and Unset have no scale here (rhino3dm doesn't expose a
// custom unit's scale).
export const RHINO_UNIT_METRES = {
  Angstroms: 1e-10, Nanometers: 1e-9, Microns: 1e-6, Millimeters: 1e-3, Centimeters: 1e-2,
  Decimeters: 0.1, Meters: 1, Dekameters: 10, Hectometers: 100, Kilometers: 1e3,
  Megameters: 1e6, Gigameters: 1e9, Microinches: 2.54e-8, Mils: 2.54e-5, Inches: 0.0254,
  Feet: 0.3048, Yards: 0.9144, Miles: 1609.344, PrinterPoints: 0.0254 / 72, PrinterPicas: 0.0254 / 6,
  NauticalMiles: 1852, AstronomicalUnits: 1.495978707e11, LightYears: 9.4607304725808e15,
  Parsecs: 3.0856775814913673e16,
};
const UNIT_LABEL = { Millimeters: "mm", Centimeters: "cm", Meters: "m", Inches: "in", Feet: "ft", Yards: "yd" };

/** The file's unit system → { metres, label }, or null if it has no known scale. */
export function rhinoUnit(rhino, value) {
  for (const name in RHINO_UNIT_METRES)
    if (enumVal(rhino.UnitSystem?.[name]) === value) return { metres: RHINO_UNIT_METRES[name], label: UNIT_LABEL[name] ?? name.toLowerCase() };
  return null;
}

function fileBytes(doc) {
  const c = doc?.content;
  if (c instanceof Uint8Array) return c;
  if (ArrayBuffer.isView(c)) return new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  if (c instanceof ArrayBuffer) return new Uint8Array(c);
  throw new Error("3dm file has no binary content");
}

const enumVal = (e) => (e && typeof e === "object" && "value" in e ? e.value : e);
const safe = (f) => { try { return f(); } catch { return undefined; } };

/** Grid-tessellate a surface (untrimmed) when the file has no render mesh. */
function sampleSurface(srf, n = 24) {
  const d0 = srf.domain(0), d1 = srf.domain(1);
  const [u0, u1] = Array.isArray(d0) ? d0 : [d0.t0 ?? d0.min, d0.t1 ?? d0.max];
  const [v0, v1] = Array.isArray(d1) ? d1 : [d1.t0 ?? d1.min, d1.t1 ?? d1.max];
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  let o = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const p = srf.pointAt(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * j) / n);
    pos[o++] = p[0] ?? p.x; pos[o++] = p[1] ?? p.y; pos[o++] = p[2] ?? p.z;
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  return { pos, idx };
}

/** Rhino geometry → array of {pos, idx}, plus whether we had to approximate. */
function meshesOf(rhino, geo, stats) {
  const t = enumVal(geo.objectType);
  const OT = rhino.ObjectType;
  const is = (name) => OT && t === enumVal(OT[name]);
  if (is("Mesh")) { const a = meshArrays(geo); return a ? [a] : []; }
  if (is("SubD")) {
    const m = safe(() => rhino.Mesh.createFromSubDControlNet(geo, false));
    const a = m && meshArrays(m); return a ? [a] : [];
  }
  if (is("Extrusion")) {
    const m = safe(() => geo.getMesh(rhino.MeshType.Any));
    const a = m && meshArrays(m);
    if (a) return [a];
    const b = safe(() => geo.toBrep(true));
    return b ? meshesOf(rhino, b, stats) : [];
  }
  if (is("Brep")) {
    const out = [];
    const faces = safe(() => geo.faces());
    if (!faces) return out;
    for (let i = 0; i < faces.count; i++) {
      const f = faces.get(i);
      const m = safe(() => f.getMesh(rhino.MeshType.Any));
      let a = m && meshArrays(m);
      if (!a) { a = safe(() => sampleSurface(f)); if (a) stats.approx++; }
      if (a) out.push(a);
    }
    return out;
  }
  if (is("Surface")) {
    const a = safe(() => sampleSurface(geo));
    if (a) stats.approx++;
    return a ? [a] : [];
  }
  return [];
}

/** rhino Transform → row-major 16 numbers. */
function xformArray(t) {
  if (!t) return null;
  const a = safe(() => t.toFloatArray(true));
  if (a && a.length === 16) return Array.from(a);
  const r = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r.push(t[`m${i}${j}`] ?? (i === j ? 1 : 0));
  return r;
}
const mul = (A, B) => {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += A[i * 4 + k] * B[k * 4 + j];
  return r;
};
function applyXform(p, M) {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const w = M[12] * x + M[13] * y + M[14] * z + M[15] || 1;
    out[i] = (M[0] * x + M[1] * y + M[2] * z + M[3]) / w;
    out[i + 1] = (M[4] * x + M[5] * y + M[6] * z + M[7]) / w;
    out[i + 2] = (M[8] * x + M[9] * y + M[10] * z + M[11]) / w;
  }
  return out;
}

function meshArrays(mesh) {
  safe(() => mesh.faces().convertQuadsToTriangles());
  const j = mesh.toThreejsJSON();
  const data = j.data ?? j;
  const pos = data.attributes?.position?.array;
  const idx = data.index?.array;
  if (!pos || !pos.length) return null;
  return { pos, idx };
}

/** Walk the top-level chunks; return a message if the file is cut short. */
function truncation(c) {
  if (c.length < 32 || new TextDecoder().decode(c.subarray(0, 24)) !== "3D Geometry File Format ") return "this is not a Rhino .3dm file";
  const dv = new DataView(c.buffer, c.byteOffset, c.byteLength);
  let off = 32;
  while (off + 12 <= c.length) {
    const tc = dv.getUint32(off, true);
    const len = Number(dv.getBigInt64(off + 4, true));
    if (tc === 0x00007fff) return null; // end-of-file chunk
    if (tc & 0x80000000) { off += 12; continue; }
    if (len < 0 || off + 12 + len > c.length) {
      const mb = (n) => (n / 1048576).toFixed(1) + " MB";
      return `the file is truncated: it needs at least ${mb(off + 12 + len)} but only ${mb(c.length)} is here. Re-upload it.`;
    }
    off += 12 + len;
  }
  return "the file is truncated (no end-of-file marker). Re-upload it.";
}

export async function convert3dm(bytes, params = {}, name = "3DM") {
  const rhino = await loadRhino();
  const file = rhino.File3dm.fromByteArray(bytes);
  if (!file) throw new Error("Couldn't read .3dm: " + (safe(() => truncation(bytes)) ?? "rhino3dm rejected it (maybe from a newer Rhino version?)"));
  try {
    const fileUnit = rhinoUnit(rhino, enumVal(safe(() => file.settings().modelUnitSystem)));
    const forced = params.unit && params.unit !== "auto" ? params.unit : null;
    const scale = forced ? METRES[forced] : fileUnit?.metres ?? 0.001;
    const layers = file.layers();
    const layerInfo = [];
    for (let i = 0; i < layers.count; i++) {
      const l = layers.get(i);
      layerInfo.push({ name: l.fullPath || l.name, visible: l.visible !== false, color: l.color });
    }
    const groups = new Map(); // key → {name, color, pos: number[][], idx: number[][], n}
    let objects = 0, skipped = 0, triangles = 0;
    const stats = { approx: 0 };

    const shown = (a) => a.visible !== false && layerInfo[a.layerIndex]?.visible !== false;
    const BY_PARENT = enumVal(rhino.ObjectColorSource?.ColorFromParent);
    // An object's display colour. A block's parts keep their own colour
    // unless they're set to "by parent", when they take the block's.
    const colorOf = (attrs, parentColor) =>
      (parentColor && BY_PARENT != null && enumVal(attrs?.colorSource) === BY_PARENT ? parentColor : null) ??
      safe(() => attrs.drawColor(file)) ??
      layerInfo[attrs?.layerIndex]?.color ??
      { r: 200, g: 200, b: 200 };
    let idefById = null;
    const objTable = file.objects();

    const add = (geo, attrs, xform, depth, parentColor) => {
      const t = enumVal(geo.objectType);
      if (enumVal(rhino.ObjectType?.InstanceReference) === t) {
        if (depth > 8) return;
        if (!idefById) {
          idefById = new Map();
          const idefs = file.instanceDefinitions();
          for (let i = 0; i < idefs.count; i++) { const d = idefs.get(i); idefById.set(d.id, d); }
        }
        const def = idefById.get(geo.parentIdefId);
        if (!def) { skipped++; return; }
        const x = xformArray(geo.xform);
        const combined = xform && x ? mul(xform, x) : x ?? xform;
        const blockColor = colorOf(attrs, parentColor);
        for (const oid of def.getObjectIds()) {
          const o = objTable.findId(oid);
          if (!o) continue;
          // each part keeps its own layer, colour and visibility
          const own = o.attributes();
          if (!params.hidden && !shown(own)) continue;
          add(o.geometry(), own, combined, depth + 1, blockColor);
        }
        return;
      }
      const meshes = meshesOf(rhino, geo, stats);
      if (!meshes.length) { skipped++; return; }
      objects++;
      const li = attrs?.layerIndex ?? 0;
      const layer = layerInfo[li] ?? { name: "Default" };
      const c = colorOf(attrs, parentColor);
      const hex = "#" + [c.r, c.g, c.b].map((v) => (v | 0).toString(16).padStart(2, "0")).join("");
      const key = li + hex;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { name: layer.name, color: hex, pos: [], idx: [], n: 0 }));
      for (const a of meshes) {
        let pos = a.pos;
        if (xform) pos = applyXform(pos, xform);
        const base = g.n;
        g.pos.push(pos);
        const vcount = pos.length / 3;
        if (a.idx) { const ix = new Uint32Array(a.idx.length); for (let i = 0; i < ix.length; i++) ix[i] = a.idx[i] + base; g.idx.push(ix); triangles += ix.length / 3; }
        else { const ix = new Uint32Array(vcount); for (let i = 0; i < vcount; i++) ix[i] = base + i; g.idx.push(ix); triangles += vcount / 3; }
        g.n += vcount;
      }
    };

    for (let i = 0; i < objTable.count; i++) {
      const o = objTable.get(i);
      const attrs = o.attributes();
      if (attrs.isInstanceDefinitionObject) continue; // drawn through their references
      if (!params.hidden && !shown(attrs)) continue;
      try { add(o.geometry(), attrs, null, 0, null); } catch { skipped++; }
    }

    const meshes = [];
    for (const g of groups.values()) {
      if (!g.n) continue;
      const positions = new Float32Array(g.n * 3);
      let o = 0;
      for (const p of g.pos) {
        for (let i = 0; i < p.length; i += 3) {
          // Rhino is Z-up; scene is Y-up metres
          positions[o++] = p[i] * scale;
          positions[o++] = p[i + 2] * scale;
          positions[o++] = -p[i + 1] * scale;
        }
      }
      const total = g.idx.reduce((s, a) => s + a.length, 0);
      const indices = new Uint32Array(total);
      let k = 0;
      for (const a of g.idx) { indices.set(a, k); k += a.length; }
      meshes.push({ name: g.name, positions, indices, normals: computeNormals(positions, indices), color: g.color, roughness: 0.6 });
    }
    const glb = encodeGLB({ meshes, generator: "rhino-3dm-scene" });
    let bounds = null;
    for (const m of meshes) {
      const b = computeBounds(m.positions);
      if (!b) continue;
      if (!bounds) bounds = b;
      else for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i], b.min[i]); bounds.max[i] = Math.max(bounds.max[i], b.max[i]); }
    }
    const u = forced ?? fileUnit?.label ?? "no known units; read as mm, set File units to change";
    return {
      kind: "glb",
      glb,
      meta: {
        ...(bounds ? { bounds } : {}),
        notes: `${objects} object${objects === 1 ? "" : "s"}, ${Math.round(triangles).toLocaleString()} triangles, ${meshes.length} layer group${meshes.length === 1 ? "" : "s"} (${u})` + (skipped ? `; ${skipped} curves/points/unsupported skipped` : "") + (stats.approx ? `; ${stats.approx} surfaces had no render mesh and were approximated (untrimmed)` : ""),
      },
    };
  } finally {
    safe(() => file.delete());
  }
}

export default {
  async build({ doc, params }) {
    const name = String(doc?.name ?? "3DM").replace(/\.[^.]+$/, "");
    return convert3dm(fileBytes(doc), params ?? {}, name);
  },
};
