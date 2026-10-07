/**
 * glb.js — a dependency-free glTF 2.0 binary (GLB) encoder.
 *
 * COPY THIS FILE into your package; do not import it across packages. It has no
 * imports and no DOM use, so it runs anywhere (main thread, worker, node).
 *
 * flow-field's copy (copied from scene/src/glb.js) adds three things: a
 * `colors` primitive field, written as the standard COLOR_0 attribute
 * (FLOAT VEC3 or VEC4, LINEAR 0..1), so baked colormaps show in any glTF
 * viewer without a custom shader (search for "COLOR_0"); `unlit`, which marks
 * the material KHR_materials_unlit so a data plane shows its colours exactly
 * rather than shaded; and `blend`, alphaMode BLEND, for per-vertex alpha.
 *
 * ─── API ──────────────────────────────────────────────────────────────────────
 *
 *   encodeGLB(scene) -> Uint8Array
 *
 *   scene = {
 *     meshes: Mesh[],               // required (may be empty)
 *     nodes?: Node[],               // optional; default = one root node per mesh
 *     extras?: object,              // copied onto the glTF scene's `extras`
 *     generator?: string,           // asset.generator (default "patchwork glb.js")
 *   }
 *
 *   Mesh = {
 *     name?: string,
 *     primitives: Primitive[],      // or put Primitive fields directly on the mesh
 *                                   // for the one-primitive shorthand
 *     extras?: object,
 *   }
 *
 *   Primitive = {
 *     positions: Float32Array | number[],   // xyz xyz …  (Y-up, metres, by convention)
 *     normals?:  Float32Array | number[],   // xyz per vertex, unit length
 *     colors?:   Float32Array | number[] | { array, itemSize: 3 | 4 },
 *                                           // COLOR_0, LINEAR rgb(a) 0..1 per vertex
 *                                           // (flow-field extension; a bare array is rgb)
 *     indices?:  Uint32Array | Uint16Array | number[],  // stored as u16 when they fit
 *     mode?:     number,                    // MODE.TRIANGLES (default), LINES, LINE_STRIP…
 *     attributes?: { [name]: Float32Array | number[] | { array, itemSize } },
 *                                           // custom per-vertex FLOAT attributes; names
 *                                           // must start with "_" (e.g. _ID, _CURVATURE).
 *                                           // A bare array is a scalar (itemSize 1).
 *     color?: [r, g, b] | [r, g, b, a] | "#rrggbb" | "#rrggbbaa",
 *                                           // baseColorFactor. Arrays are LINEAR 0..1;
 *                                           // hex strings are sRGB and get linearised.
 *     metallic?: number,                    // default 0
 *     roughness?: number,                   // default 0.8
 *     doubleSided?: boolean,                // default true
 *     unlit?: boolean,                      // KHR_materials_unlit (flow-field extension)
 *     blend?: boolean,                      // alphaMode BLEND, e.g. for COLOR_0 alpha
 *   }
 *
 *   Node = {
 *     name?: string,
 *     mesh?: number,                        // index into scene.meshes
 *     translation?: [x, y, z],
 *     rotation?: [x, y, z, w],              // unit quaternion
 *     scale?: [x, y, z],
 *     children?: number[],                  // indices into scene.nodes
 *     extras?: object,
 *   }
 *   Nodes that are nobody's child are the scene roots.
 *
 * Helpers (all pure):
 *   MODE                                 { POINTS, LINES, LINE_LOOP, LINE_STRIP, TRIANGLES, … }
 *   computeNormals(positions, indices?)  -> Float32Array   area-weighted vertex normals
 *                                        (flat per-face normals when there are no indices)
 *   computeBounds(positions)             -> { min: [x,y,z], max: [x,y,z] } | null
 *   srgbToLinear(c) / hexToLinear(hex)   colour conversion used for `color`
 *   parseGLB(bytes)                      -> { json, bin }   minimal reader, for tests
 *
 * Behaviour worth knowing:
 *   - Primitives with zero vertices are dropped; a mesh left with no primitives
 *     is dropped too, and any node pointing at it keeps its place but loses `mesh`.
 *     An empty scene still encodes to a valid GLB, so "nothing to show" is not an error.
 *   - POSITION accessors always carry min/max (the spec requires it).
 *   - Every buffer view is 4-byte aligned; the JSON chunk is space-padded and the
 *     BIN chunk zero-padded, as the spec requires.
 *   - Throws on malformed input (lengths not a multiple of 3, index out of range,
 *     custom attribute without a leading "_", …) with a message naming the mesh.
 */

export const MODE = Object.freeze({
  POINTS: 0,
  LINES: 1,
  LINE_LOOP: 2,
  LINE_STRIP: 3,
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6,
});

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TYPE_BY_SIZE = { 1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4" };

const PRIMITIVE_KEYS = ["positions", "normals", "colors", "indices", "mode", "attributes", "color"];

/** sRGB channel (0..1) → linear. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** "#rgb", "#rrggbb" or "#rrggbbaa" (sRGB) → linear [r, g, b, a]. */
export function hexToLinear(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`glb: bad colour "${hex}"`);
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [srgbToLinear(n(0)), srgbToLinear(n(2)), srgbToLinear(n(4)), h.length === 8 ? n(6) : 1];
}

function toColor(color) {
  if (color == null) return null;
  if (typeof color === "string") return hexToLinear(color);
  if (Array.isArray(color) && (color.length === 3 || color.length === 4)) {
    const c = color.map(Number);
    if (c.some((v) => !Number.isFinite(v))) throw new Error("glb: colour has a non-number channel");
    return c.length === 3 ? [...c, 1] : c;
  }
  throw new Error("glb: colour must be [r,g,b(,a)] or a hex string");
}

/** Axis-aligned bounds of an xyz array, or null when it is empty. */
export function computeBounds(positions) {
  const n = positions.length;
  if (n < 3) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Vertex normals. With indices: area-weighted average of the faces sharing a
 * vertex. Without: flat, one face normal per triangle (positions are a triangle soup).
 */
export function computeNormals(positions, indices) {
  const count = positions.length / 3;
  const out = new Float32Array(positions.length);
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(count / 3);
  for (let t = 0; t < triCount; t++) {
    const a = indices ? indices[t * 3] : t * 3;
    const b = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const c = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    // cross(u, v): length = 2 × area, so summing unnormalised crosses area-weights
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v * 3] += nx;
      out[v * 3 + 1] += ny;
      out[v * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.hypot(out[i], out[i + 1], out[i + 2]);
    if (len > 0) {
      out[i] /= len;
      out[i + 1] /= len;
      out[i + 2] /= len;
    } else {
      out[i + 1] = 1; // degenerate: point up rather than emit a zero normal
    }
  }
  return out;
}

function asFloat32(arr, what) {
  if (arr instanceof Float32Array) return arr;
  if (Array.isArray(arr) || ArrayBuffer.isView(arr)) return Float32Array.from(arr);
  throw new Error(`glb: ${what} must be a Float32Array or number[]`);
}

function checkFinite(arr, what) {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`glb: ${what} contains a non-finite value at ${i}`);
  }
}

class BinWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.views = [];
  }
  /** Append a typed array as a new bufferView, 4-byte aligned. Returns its index. */
  add(typed, target) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.parts.push(new Uint8Array(pad));
      this.length += pad;
    }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const view = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.parts.push(bytes);
    this.length += bytes.byteLength;
    this.views.push(view);
    return this.views.length - 1;
  }
  bytes() {
    const total = this.length + ((4 - (this.length % 4)) % 4);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of this.parts) {
      out.set(p, off);
      off += p.byteLength;
    }
    return out;
  }
}

function normalizeMesh(mesh, i) {
  if (!mesh || typeof mesh !== "object") throw new Error(`glb: mesh ${i} is not an object`);
  if (Array.isArray(mesh.primitives)) return mesh;
  if (mesh.positions) {
    const prim = {};
    for (const k of PRIMITIVE_KEYS.concat(["metallic", "roughness", "doubleSided", "unlit", "blend"])) {
      if (mesh[k] !== undefined) prim[k] = mesh[k];
    }
    return { name: mesh.name, extras: mesh.extras, primitives: [prim] };
  }
  throw new Error(`glb: mesh ${i} (${mesh.name ?? "unnamed"}) has neither primitives nor positions`);
}

/**
 * Encode a scene as a GLB. See the API notes at the top of this file.
 * @returns {Uint8Array}
 */
export function encodeGLB(scene) {
  if (!scene || !Array.isArray(scene.meshes)) throw new Error("glb: encodeGLB needs { meshes: [] }");
  const bin = new BinWriter();
  const accessors = [];
  const materials = [];
  const materialKeys = new Map();
  const gltfMeshes = [];
  const meshRemap = new Map(); // input mesh index → output mesh index

  const material = (prim) => {
    const color = toColor(prim.color);
    if (!color && prim.metallic == null && prim.roughness == null) return undefined;
    const m = {
      pbrMetallicRoughness: {
        baseColorFactor: color ?? [1, 1, 1, 1],
        metallicFactor: prim.metallic ?? 0,
        roughnessFactor: prim.roughness ?? 0.8,
      },
      doubleSided: prim.doubleSided ?? true,
    };
    if (m.pbrMetallicRoughness.baseColorFactor[3] < 1 || prim.blend) m.alphaMode = "BLEND";
    if (prim.unlit) m.extensions = { KHR_materials_unlit: {} };
    const key = JSON.stringify(m);
    if (!materialKeys.has(key)) {
      materialKeys.set(key, materials.length);
      materials.push(m);
    }
    return materialKeys.get(key);
  };

  scene.meshes.forEach((rawMesh, mi) => {
    const mesh = normalizeMesh(rawMesh, mi);
    const label = `mesh ${mi}${mesh.name ? ` (${mesh.name})` : ""}`;
    const prims = [];
    mesh.primitives.forEach((prim, pi) => {
      const where = `${label} primitive ${pi}`;
      if (!prim || !prim.positions) throw new Error(`glb: ${where} has no positions`);
      const positions = asFloat32(prim.positions, `${where} positions`);
      if (positions.length % 3) throw new Error(`glb: ${where} positions length is not a multiple of 3`);
      const count = positions.length / 3;
      if (count === 0) return; // empty primitive: dropped
      checkFinite(positions, `${where} positions`);

      const attributes = {};
      const b = computeBounds(positions);
      accessors.push({
        bufferView: bin.add(positions, ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: "VEC3",
        min: b.min,
        max: b.max,
      });
      attributes.POSITION = accessors.length - 1;

      if (prim.normals) {
        const normals = asFloat32(prim.normals, `${where} normals`);
        if (normals.length !== positions.length) throw new Error(`glb: ${where} normals length ≠ positions length`);
        checkFinite(normals, `${where} normals`);
        accessors.push({ bufferView: bin.add(normals, ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3" });
        attributes.NORMAL = accessors.length - 1;
      }

      // flow-field extension: per-vertex colours as the standard COLOR_0
      if (prim.colors) {
        const spec = prim.colors;
        const isObj = !Array.isArray(spec) && !ArrayBuffer.isView(spec);
        const itemSize = isObj ? spec.itemSize ?? 3 : 3;
        if (itemSize !== 3 && itemSize !== 4) throw new Error(`glb: ${where} colors itemSize must be 3 or 4`);
        const arr = asFloat32(isObj ? spec.array : spec, `${where} colors`);
        if (arr.length !== count * itemSize) {
          throw new Error(`glb: ${where} colors has ${arr.length} values, expected ${count * itemSize}`);
        }
        checkFinite(arr, `${where} colors`);
        accessors.push({
          bufferView: bin.add(arr, ARRAY_BUFFER),
          componentType: FLOAT,
          count,
          type: TYPE_BY_SIZE[itemSize],
        });
        attributes.COLOR_0 = accessors.length - 1;
      }

      for (const [name, spec] of Object.entries(prim.attributes ?? {})) {
        if (!name.startsWith("_")) throw new Error(`glb: ${where} custom attribute "${name}" must start with "_"`);
        const isObj = spec && !Array.isArray(spec) && !ArrayBuffer.isView(spec);
        const itemSize = isObj ? spec.itemSize ?? 1 : 1;
        if (!TYPE_BY_SIZE[itemSize]) throw new Error(`glb: ${where} attribute ${name} itemSize must be 1–4`);
        const arr = asFloat32(isObj ? spec.array : spec, `${where} attribute ${name}`);
        if (arr.length !== count * itemSize) {
          throw new Error(`glb: ${where} attribute ${name} has ${arr.length} values, expected ${count * itemSize}`);
        }
        checkFinite(arr, `${where} attribute ${name}`);
        accessors.push({
          bufferView: bin.add(arr, ARRAY_BUFFER),
          componentType: FLOAT,
          count,
          type: TYPE_BY_SIZE[itemSize],
        });
        attributes[name] = accessors.length - 1;
      }

      const out = { attributes, mode: prim.mode ?? MODE.TRIANGLES };
      if (prim.indices) {
        const src = prim.indices;
        let max = 0;
        for (let i = 0; i < src.length; i++) {
          const v = src[i];
          if (!Number.isInteger(v) || v < 0 || v >= count) {
            throw new Error(`glb: ${where} index ${v} at ${i} is out of range (0..${count - 1})`);
          }
          if (v > max) max = v;
        }
        if (src.length > 0) {
          const typed = max < 65536 ? Uint16Array.from(src) : src instanceof Uint32Array ? src : Uint32Array.from(src);
          accessors.push({
            bufferView: bin.add(typed, ELEMENT_ARRAY_BUFFER),
            componentType: typed instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT,
            count: typed.length,
            type: "SCALAR",
          });
          out.indices = accessors.length - 1;
        }
      }
      const mat = material(prim);
      if (mat !== undefined) out.material = mat;
      prims.push(out);
    });
    if (prims.length === 0) return; // empty mesh: dropped
    const m = { primitives: prims };
    if (mesh.name) m.name = String(mesh.name);
    if (mesh.extras) m.extras = mesh.extras;
    meshRemap.set(mi, gltfMeshes.length);
    gltfMeshes.push(m);
  });

  // Nodes: explicit, or one per (input) mesh.
  const inputNodes = scene.nodes ?? scene.meshes.map((m, i) => ({ name: m?.name, mesh: i }));
  const childOf = new Set();
  const nodes = inputNodes.map((n, ni) => {
    const node = {};
    if (n.name) node.name = String(n.name);
    if (n.mesh != null) {
      if (!Number.isInteger(n.mesh) || n.mesh < 0 || n.mesh >= scene.meshes.length) {
        throw new Error(`glb: node ${ni} points at mesh ${n.mesh}, which does not exist`);
      }
      if (meshRemap.has(n.mesh)) node.mesh = meshRemap.get(n.mesh);
    }
    if (n.translation) node.translation = n.translation.map(Number);
    if (n.rotation) node.rotation = n.rotation.map(Number);
    if (n.scale) node.scale = n.scale.map(Number);
    if (n.children?.length) {
      for (const c of n.children) {
        if (!Number.isInteger(c) || c < 0 || c >= inputNodes.length || c === ni) {
          throw new Error(`glb: node ${ni} has a bad child ${c}`);
        }
        childOf.add(c);
      }
      node.children = [...n.children];
    }
    if (n.extras) node.extras = n.extras;
    return node;
  });
  const roots = nodes.map((_, i) => i).filter((i) => !childOf.has(i));

  const gltf = {
    asset: { version: "2.0", generator: scene.generator ?? "patchwork glb.js" },
    scene: 0,
    scenes: [{ nodes: roots, ...(scene.extras ? { extras: scene.extras } : {}) }],
  };
  if (nodes.length) gltf.nodes = nodes;
  if (gltfMeshes.length) gltf.meshes = gltfMeshes;
  if (materials.length) gltf.materials = materials;
  if (materials.some((m) => m.extensions?.KHR_materials_unlit)) gltf.extensionsUsed = ["KHR_materials_unlit"];
  if (accessors.length) gltf.accessors = accessors;
  const binBytes = bin.bytes();
  if (bin.views.length) {
    gltf.bufferViews = bin.views;
    gltf.buffers = [{ byteLength: binBytes.byteLength }];
  }

  const jsonRaw = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = jsonRaw.byteLength + ((4 - (jsonRaw.byteLength % 4)) % 4);
  const hasBin = binBytes.byteLength > 0;
  const total = 12 + 8 + jsonLen + (hasBin ? 8 + binBytes.byteLength : 0);

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonRaw, 20);
  out.fill(0x20, 20 + jsonRaw.byteLength, 20 + jsonLen);
  if (hasBin) {
    const at = 20 + jsonLen;
    dv.setUint32(at, binBytes.byteLength, true);
    dv.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
    out.set(binBytes, at + 8);
  }
  return out;
}

/**
 * Minimal GLB reader: validates the header and returns the parsed JSON and the
 * BIN chunk (or null). Enough for tests and for sniffing a file; not a loader.
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
