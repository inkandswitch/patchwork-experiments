// GLB → triangles, in glTF coordinates and metres. Pure, apart from loading
// the meshopt decoder when a GLB needs it.
//
// Copied from flow-field/src/mesh-section.js (its GLB-reading half) and
// flow-field/src/glb.js (parseGLB); packages never import each other. One
// change: glbTriangles() returns glTF X, Y, Z (metres) unmapped, because the
// rig aid maps them with the designer's bow/up frame (naval/hull-frame.js),
// where flow-field fixes the floating frame (x = X, y = −Z, z = Y).
//
// Read like the scene reads it: node transforms applied, line and point
// primitives skipped, KHR_mesh_quantization (normalised integer attributes)
// and EXT_meshopt_compression decoded (vendor/meshopt_decoder.module.js,
// copied whole from three's examples/jsm/libs; meshoptimizer, MIT), and
// EXT_mesh_gpu_instancing expanded to one copy of the mesh per instance, as
// three's GLTFLoader draws it. Draco isn't read. Units: glTF is metres; a GLB
// that declares `asset.extras.units` (the patchwork convention) is scaled from
// those to metres.

/**
 * Minimal GLB reader: validates the header and returns the parsed JSON and the
 * BIN chunk (or null). (flow-field/src/glb.js parseGLB.)
 */
export function parseGLB(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 20) throw new Error("glb: too short");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("glb: bad magic");
  if (dv.getUint32(4, true) !== 2) throw new Error("glb: not version 2");
  const length = dv.getUint32(8, true);
  if (length !== u8.byteLength) throw new Error(`glb: header length ${length} ≠ ${u8.byteLength}`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < length) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const body = u8.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error("glb: no JSON chunk");
  return { json, bin };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const READERS = {
  5120: [1, (dv, o) => dv.getInt8(o)],
  5121: [1, (dv, o) => dv.getUint8(o)],
  5122: [2, (dv, o) => dv.getInt16(o, true)],
  5123: [2, (dv, o) => dv.getUint16(o, true)],
  5125: [4, (dv, o) => dv.getUint32(o, true)],
  5126: [4, (dv, o) => dv.getFloat32(o, true)],
};
/** A normalised integer component → [−1, 1] or [0, 1] (glTF 2.0 §3.11). */
const NORMALIZE = {
  5120: (c) => Math.max(c / 127, -1),
  5121: (c) => c / 255,
  5122: (c) => Math.max(c / 32767, -1),
  5123: (c) => c / 65535,
};

/** Metres per unit (as scene/src/units.js), and the long names a writer might use. */
export const METRES_PER_UNIT = Object.freeze({ m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 });
const LONG_UNITS = {
  metre: "m", metres: "m", meter: "m", meters: "m",
  centimetre: "cm", centimetres: "cm", centimeter: "cm", centimeters: "cm",
  millimetre: "mm", millimetres: "mm", millimeter: "mm", millimeters: "mm",
  inch: "in", inches: "in", foot: "ft", feet: "ft",
};

/**
 * A GLB's length unit: `asset.extras.units` if it names one, else metres (the
 * glTF spec, and the scene's convention). Never guessed from the size.
 * @returns {{ unit: string, scale: number, declared: string|null, known: boolean }}
 *   `scale` is metres per file unit; `known` is false for a declared unit
 *   this can't read (it is then taken as metres).
 */
export function glbUnits(json) {
  const raw = json?.asset?.extras?.units;
  if (raw == null || raw === "") return { unit: "m", scale: 1, declared: null, known: true };
  const s = String(raw).trim().toLowerCase();
  const unit = s in METRES_PER_UNIT ? s : LONG_UNITS[s];
  return unit ? { unit, scale: METRES_PER_UNIT[unit], declared: String(raw), known: true } : { unit: "m", scale: 1, declared: String(raw), known: false };
}

/** Extensions that change the geometry and that this doesn't read. */
const UNREADABLE = {
  KHR_draco_mesh_compression: "Draco compression",
};

/**
 * An error about this peer, not the bytes: the GLB is fine, but this
 * runtime can't decode it (no WebAssembly, the decoder chunk didn't load).
 * Another peer may well read it, so callers treat it as transient.
 */
function peerError(message, cause) {
  const err = new Error(message);
  err.transient = true;
  if (cause !== undefined) err.cause = cause;
  return err;
}

/** Does this GLB carry meshopt-compressed buffer views? */
const usesMeshopt = (json) => (json.bufferViews ?? []).some((v) => v?.extensions?.EXT_meshopt_compression);

/**
 * Parse a GLB, refusing what can't be read. Trailing bytes after the length
 * in the header (padding some writers leave) are ignored.
 * @returns {{ json: object, bin: Uint8Array|null, views: null }}
 */
export function readGLB(bytes) {
  let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength >= 12) {
    const length = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(8, true);
    if (length >= 20 && length < u8.byteLength) u8 = u8.subarray(0, length);
  }
  const { json, bin } = parseGLB(u8);
  for (const ext of json.extensionsRequired ?? [])
    if (UNREADABLE[ext]) throw new Error(`glb: uses ${UNREADABLE[ext]} (${ext}), which can't be read here`);
  return { json, bin, views: null };
}

/**
 * Parse a GLB and decode any meshopt-compressed buffer views (loading the
 * decoder only then). The result is what glbTriangles() and meshSection()
 * take in place of bytes.
 * @returns {Promise<{ json: object, bin: Uint8Array|null, views: Map<number, Uint8Array>|null }>}
 */
export async function decodeGLB(bytes) {
  const g = readGLB(bytes);
  if (!usesMeshopt(g.json)) return g;
  let MeshoptDecoder;
  try {
    ({ MeshoptDecoder } = await import("./vendor/meshopt_decoder.module.js"));
  } catch (err) {
    throw peerError(`glb: meshopt-compressed, and the decoder couldn't be loaded here (${err?.message ?? err})`, err);
  }
  if (!MeshoptDecoder?.supported) throw peerError("glb: meshopt-compressed, and WebAssembly isn't available here to decode it");
  try {
    await MeshoptDecoder.ready;
  } catch (err) {
    throw peerError(`glb: meshopt-compressed, and the decoder didn't start here (${err?.message ?? err})`, err);
  }
  const views = new Map();
  g.json.bufferViews.forEach((view, i) => {
    const ext = view?.extensions?.EXT_meshopt_compression;
    if (!ext) return;
    if ((ext.buffer ?? 0) !== 0 || !g.bin) throw new Error("glb: meshopt data outside the BIN chunk");
    const source = g.bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    const target = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, source, ext.mode, ext.filter ?? "NONE");
    views.set(i, target);
  });
  return { ...g, views };
}

/**
 * An accessor's elements as a flat array (strides and offsets honoured,
 * normalised integers mapped to their float range). `views` holds decoded
 * (meshopt) buffer views by index, which replace the view's bytes.
 */
export function readAccessor(json, bin, index, views = null) {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`glb: no accessor ${index}`);
  const comps = COMPONENTS[acc.type] ?? 1;
  const reader = READERS[acc.componentType];
  if (!reader) throw new Error(`glb: unsupported component type ${acc.componentType}`);
  const [size, raw] = reader;
  const norm = acc.normalized ? NORMALIZE[acc.componentType] : null;
  const read = norm ? (dv, o) => norm(raw(dv, o)) : raw;
  const out = new Float64Array(acc.count * comps);
  if (acc.bufferView == null) return out; // all zeros, per the spec (sparse accessors aren't read)
  const view = json.bufferViews?.[acc.bufferView];
  if (!view) throw new Error(`glb: no buffer view ${acc.bufferView}`);
  let data;
  let base;
  const decoded = views?.get?.(acc.bufferView);
  if (decoded) {
    data = decoded;
    base = acc.byteOffset ?? 0;
  } else {
    if (view.extensions?.EXT_meshopt_compression) throw new Error("glb: meshopt-compressed (decode it with decodeGLB first)");
    if ((view.buffer ?? 0) !== 0 || !bin) throw new Error("glb: accessor outside the BIN chunk");
    data = bin;
    base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const stride = view.byteStride || comps * size;
  for (let i = 0; i < acc.count; i++)
    for (let c = 0; c < comps; c++) out[i * comps + c] = read(dv, base + i * stride + c * size);
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4 × 4 product a · b. */
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

function nodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.map(Number);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Column-major T · R · S (three's Matrix4.compose). */
function compose([tx, ty, tz], [qx, qy, qz, qw], [sx, sy, sz]) {
  return nodeMatrix({ translation: [tx, ty, tz], rotation: [qx, qy, qz, qw], scale: [sx, sy, sz] });
}

const isTriangleMode = (mode) => mode == null || mode === 4 || mode === 5 || mode === 6;

/**
 * A node's EXT_mesh_gpu_instancing transforms, or null when it draws its mesh
 * once. As three's GLTFLoader (what the scene uses): the extension on the
 * node counts whether or not it is in extensionsRequired; with no attributes,
 * or a mesh that has any line or point primitive, it is ignored; the count is
 * the first attribute's; each instance is TRANSLATION · ROTATION · SCALE, in
 * the node's own frame.
 */
function nodeInstances(json, bin, views, node) {
  const attrs = node?.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (!attrs || node.mesh == null) return null;
  const mesh = json.meshes?.[node.mesh];
  if (!mesh || !(mesh.primitives ?? []).every((p) => isTriangleMode(p.mode))) return null;
  const read = {};
  for (const key of Object.keys(attrs)) read[key] = readAccessor(json, bin, attrs[key], views);
  const keys = Object.keys(read);
  if (!keys.length) return null;
  const first = keys[0];
  const count = json.accessors[attrs[first]].count;
  const T = read.TRANSLATION;
  const R = read.ROTATION;
  const S = read.SCALE;
  const out = [];
  for (let i = 0; i < count; i++)
    out.push(
      compose(
        T ? [T[i * 3], T[i * 3 + 1], T[i * 3 + 2]] : [0, 0, 0],
        R ? [R[i * 4], R[i * 4 + 1], R[i * 4 + 2], R[i * 4 + 3]] : [0, 0, 0, 1],
        S ? [S[i * 3], S[i * 3 + 1], S[i * 3 + 2]] : [1, 1, 1],
      ),
    );
  return out;
}

/**
 * Every triangle of a GLB, in glTF coordinates (Y up) and metres, as a flat
 * array of 9 numbers per triangle. Node transforms are applied (and GPU
 * instances expanded), then the GLB's units; line and point primitives are
 * skipped; strips and fans are unrolled.
 * @param {Uint8Array|ArrayBuffer|{ json, bin, views }} input  GLB bytes, or decodeGLB()'s result
 * @returns {{ triangles: Float64Array, meshes: string[], units: ReturnType<typeof glbUnits>, instances: number }}
 */
export function glbTriangles(input) {
  const { json, bin, views } = input?.json ? input : readGLB(input);
  const units = glbUnits(json);
  const k = units.scale;
  const out = [];
  const names = [];
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];

  let instances = 0;
  /** Emit a mesh once per matrix in Ms (reading its accessors once). */
  const emitMesh = (mi, Ms) => {
    const mesh = meshes[mi];
    if (!mesh) return;
    let used = false;
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (!isTriangleMode(mode)) continue;
      if (prim.attributes?.POSITION == null) continue;
      const pos = readAccessor(json, bin, prim.attributes.POSITION, views);
      const count = pos.length / 3;
      const idx = prim.indices != null ? readAccessor(json, bin, prim.indices, views) : null;
      const at = (i) => (idx ? idx[i] : i);
      const n = idx ? idx.length : count;
      const tri = [];
      if (mode === 4) for (let i = 0; i + 2 < n; i += 3) tri.push(at(i), at(i + 1), at(i + 2));
      else if (mode === 5) for (let i = 0; i + 2 < n; i++) tri.push(at(i), at(i + 1), at(i + 2));
      else for (let i = 1; i + 1 < n; i++) tri.push(at(0), at(i), at(i + 1));
      for (const M of Ms)
        for (const v of tri) {
          if (!(v >= 0 && v < count)) continue;
          const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
          out.push(
            k * (M[0] * x + M[4] * y + M[8] * z + M[12]),
            k * (M[1] * x + M[5] * y + M[9] * z + M[13]),
            k * (M[2] * x + M[6] * y + M[10] * z + M[14]),
          );
        }
      used = true;
    }
    if (used) names.push(mesh.name ?? `mesh ${mi}`);
  };

  const walk = (ni, parent, seen) => {
    const node = nodes[ni];
    if (!node || seen.has(ni)) return;
    seen.add(ni);
    const M = mul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      const inst = nodeInstances(json, bin, views, node);
      if (inst) instances += inst.length;
      emitMesh(node.mesh, inst ? inst.map((I) => mul(M, I)) : [M]);
    }
    for (const c of node.children ?? []) walk(c, M, seen);
  };

  const scene = json.scenes?.[json.scene ?? 0];
  if (scene?.nodes) {
    const seen = new Set();
    for (const ni of scene.nodes) walk(ni, IDENTITY, seen);
  } else if (nodes.length) {
    const children = new Set(nodes.flatMap((n) => n.children ?? []));
    const seen = new Set();
    nodes.forEach((_, ni) => !children.has(ni) && walk(ni, IDENTITY, seen));
  } else meshes.forEach((_, mi) => emitMesh(mi, [IDENTITY]));
  // a triangle list has 9 numbers per triangle; drop a dangling partial one
  const len = out.length - (out.length % 9);
  return { triangles: Float64Array.from(out.slice(0, len)), meshes: names, units, instances };
}
