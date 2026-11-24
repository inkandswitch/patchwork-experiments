// Test fixtures: a hull-ish waterline, and GLBs of prisms built from it the
// way a scene provider would (glTF Y-up: X = x, Y = z, Z = −y).
import { encodeGLB, parseGLB } from "../glb.js";

export const halfBreadth = (x) => 0.8 * (1 - (x / 10) ** 2) + 0.5 * Math.sin((Math.PI * x) / 10) * (1 - x / 10);

/** Counter-clockwise waterline of a 10 m hull: transom 1.6 m wide at x = 0, stem at x = 10. */
export function transomWaterline(n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([(10 * i) / n, -halfBreadth((10 * i) / n)]);
  pts.push([10, 0]);
  for (let i = n - 1; i >= 0; i--) pts.push([(10 * i) / n, halfBreadth((10 * i) / n)]);
  return pts;
}

export const circleLoop = (n, R = 1) =>
  Array.from({ length: n }, (_, i) => [R * Math.cos((2 * Math.PI * i) / n), R * Math.sin((2 * Math.PI * i) / n)]);

const gl = (x, y, z) => [x, z, 0 - y];

/**
 * A vertical prism over a floating-frame loop, z from zLo to zHi, as a GLB.
 * @param {object} [o]
 * @param {boolean} [o.caps=true]      close the top and bottom (fan: the loop must be star-shaped from its centroid)
 * @param {number[]} [o.levels]        z levels (rings) instead of [zLo, zHi]
 * @param {boolean} [o.indexed=true]   false: every triangle gets its own vertices (seams everywhere)
 * @param {number[]} [o.translation]   put the mesh under a node with this translation (glTF frame)
 * @param {number[]} [o.skipEdges]     loop edges to leave out of the side (an open shell)
 * @param {string} [o.units]           asset.extras.units (the coordinates are in these)
 */
export function prismGLB(loop, { levels = [-1, 0.5], caps = true, indexed = true, translation, skipEdges = [], units } = {}) {
  const n = loop.length;
  const positions = [];
  const indices = [];
  const vert = (x, y, z) => {
    positions.push(...gl(x, y, z));
    return positions.length / 3 - 1;
  };
  const tri = (a, b, c) => {
    if (indexed) indices.push(a, b, c);
    else {
      const p = (i) => positions.slice(i * 3, i * 3 + 3);
      const [A, B, C] = [p(a), p(b), p(c)];
      nonIndexed.push(...A, ...B, ...C);
    }
  };
  const nonIndexed = [];
  const rings = levels.map((z) => loop.map(([x, y]) => vert(x, y, z)));
  for (let r = 0; r + 1 < rings.length; r++)
    for (let i = 0; i < n; i++) {
      if (skipEdges.includes(i)) continue;
      const j = (i + 1) % n;
      tri(rings[r][i], rings[r][j], rings[r + 1][j]);
      tri(rings[r][i], rings[r + 1][j], rings[r + 1][i]);
    }
  if (caps) {
    const cx = loop.reduce((s, p) => s + p[0], 0) / n;
    const cy = loop.reduce((s, p) => s + p[1], 0) / n;
    for (const [ri, z] of [[0, levels[0]], [rings.length - 1, levels.at(-1)]]) {
      const c = vert(cx, cy, z);
      for (let i = 0; i < n; i++) tri(c, rings[ri][i], rings[ri][(i + 1) % n]);
    }
  }
  const prim = indexed ? { positions, indices } : { positions: nonIndexed };
  const meshes = [{ name: "Hull", primitives: [prim, { positions: [0, 0, 0, 1, 0, 0], mode: 1 }] }];
  const nodes = translation ? [{ name: "root", children: [1], translation }, { name: "hull", mesh: 0 }] : undefined;
  return encodeGLB({ meshes, nodes, ...(units ? { units } : {}) });
}

/** GLB bytes from a glTF json and its BIN chunk. */
export function writeGLB(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jl = Math.ceil(text.length / 4) * 4;
  const bl = bin ? Math.ceil(bin.byteLength / 4) * 4 : 0;
  const total = 12 + 8 + jl + (bin ? 8 + bl : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl);
  out.set(text, 20);
  if (bin) {
    dv.setUint32(20 + jl, bl, true);
    dv.setUint32(24 + jl, 0x004e4942, true);
    out.set(bin, 28 + jl);
  }
  return out;
}

/**
 * A prism GLB whose hull node carries EXT_mesh_gpu_instancing.
 * @param {object} attrs  { TRANSLATION?: number[][], ROTATION?: number[][], SCALE?: number[][] } (glTF frame)
 * @param {object} [o]
 * @param {boolean} [o.required]  list the extension in extensionsRequired too (else extensionsUsed only)
 * @param {boolean} [o.lines]     keep prismGLB's line primitive (three then ignores the instancing)
 */
export function instancedPrismGLB(loop, attrs, { required = false, lines = false } = {}) {
  const { json, bin } = parseGLB(prismGLB(loop));
  if (!lines) json.meshes[0].primitives = json.meshes[0].primitives.filter((p) => (p.mode ?? 4) === 4);
  const chunks = [];
  let offset = Math.ceil((bin?.byteLength ?? 0) / 4) * 4;
  const ext = {};
  for (const [key, rows] of Object.entries(attrs)) {
    const data = new Float32Array(rows.flat());
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count: rows.length, type: rows[0].length === 4 ? "VEC4" : "VEC3" });
    ext[key] = json.accessors.length - 1;
    chunks.push([offset, data]);
    offset += data.byteLength;
  }
  const nb = new Uint8Array(offset);
  if (bin) nb.set(bin);
  for (const [o, d] of chunks) nb.set(new Uint8Array(d.buffer), o);
  json.buffers[0].byteLength = nb.byteLength;
  const hull = json.nodes.findIndex((n) => n.mesh != null);
  json.nodes[hull].extensions = { EXT_mesh_gpu_instancing: { attributes: ext } };
  json.extensionsUsed = [...(json.extensionsUsed ?? []), "EXT_mesh_gpu_instancing"];
  if (required) json.extensionsRequired = [...(json.extensionsRequired ?? []), "EXT_mesh_gpu_instancing"];
  return writeGLB(json, nb);
}
