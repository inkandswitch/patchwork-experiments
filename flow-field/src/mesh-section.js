// A section of a GLB: slice its triangles with a horizontal plane.
// Pure, apart from loading the meshopt decoder when a GLB needs it.
//
// Every linked body is cut here, whatever it is: a scene render's GLB, a GLB
// file doc, or the in-memory build of a doc some scene:source provider can
// build (section.js). The GLB is glTF Y-up; the section is in the floating
// frame, which the contract puts at x = X, y = −Z, z = Y (v2 §3).
//
// Read like the scene reads it: node transforms applied, line and point
// primitives skipped, KHR_mesh_quantization (normalised integer attributes)
// and EXT_meshopt_compression decoded (src/vendor/meshopt_decoder.module.js,
// copied whole from three's examples/jsm/libs; meshoptimizer, MIT), and
// EXT_mesh_gpu_instancing expanded to one copy of the mesh per instance, as
// three's GLTFLoader draws it (whether or not the GLB lists the extension as
// required). Draco isn't read (the scene doesn't show it either). Units: glTF
// is metres; a GLB that declares `asset.extras.units` (the patchwork
// convention, written by scene/src/glb.js) is scaled from those to metres.
// The scene itself takes every GLB as metres, so for a GLB that declares
// another unit the two disagree (the section notes say so).

import { parseGLB } from "./glb.js";

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
 * Every triangle of a GLB, in the FLOATING frame and in metres, as a flat
 * array of 9 numbers per triangle. Node transforms are applied (and GPU
 * instances expanded), then the GLB's units; line and point primitives are
 * skipped; strips and fans are unrolled.
 * @param {Uint8Array|ArrayBuffer|{ json, bin, views }} input  GLB bytes, or decodeGLB()'s result
 * @returns {{ triangles: Float64Array, meshes: string[], units: ReturnType<typeof glbUnits>, zMin: number, zMax: number, instances: number }}
 *   zMin / zMax: the triangles' extent up the floating z (null with no triangles).
 *   instances: how many copies GPU-instanced nodes drew (0 with none).
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
          const X = M[0] * x + M[4] * y + M[8] * z + M[12];
          const Y = M[1] * x + M[5] * y + M[9] * z + M[13];
          const Z = M[2] * x + M[6] * y + M[10] * z + M[14];
          // glTF (Y-up, file units) → floating frame in metres: x = X, y = −Z, z = Y
          out.push(k * X, 0 - k * Z, k * Y);
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
  const triangles = Float64Array.from(out.slice(0, len));
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 2; i < triangles.length; i += 3) {
    if (triangles[i] < zMin) zMin = triangles[i];
    if (triangles[i] > zMax) zMax = triangles[i];
  }
  if (!triangles.length) zMin = zMax = null;
  return { triangles, meshes: names, units, zMin, zMax, instances };
}

/**
 * Welds nearly-equal points (within `tol`) to one id, with a grid hash that
 * checks the neighbouring cells so points either side of a cell edge still meet.
 */
function welder(tol) {
  const cells = new Map();
  const pts = [];
  const key = (i, j) => `${i},${j}`;
  return {
    pts,
    id(x, y) {
      const ci = Math.floor(x / tol);
      const cj = Math.floor(y / tol);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const list = cells.get(key(ci + di, cj + dj));
          if (!list) continue;
          for (const id of list) {
            const p = pts[id];
            if (Math.abs(p[0] - x) <= tol && Math.abs(p[1] - y) <= tol) return id;
          }
        }
      const id = pts.length;
      pts.push([x, y]);
      const k = key(ci, cj);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(id);
      return id;
    },
  };
}

/** Lexicographic order of two 3D points, so an edge is always cut from the same end. */
function before(t, a, b) {
  for (let k = 0; k < 3; k++) {
    if (t[a + k] < t[b + k]) return true;
    if (t[a + k] > t[b + k]) return false;
  }
  return true;
}

/**
 * Cut triangles (floating frame, 9 numbers each) with the plane z = z0 and
 * chain the cuts into loops.
 *
 * Robustness: a vertex exactly on the plane counts as above it, so every
 * triangle that straddles the plane is cut on exactly two edges and a
 * triangle lying in the plane is not cut at all. Each edge is cut from its
 * lexicographically-first end, so the two triangles sharing an edge (even
 * across a seam of duplicated vertices) compute bit-identical points, and the
 * points are then welded within a tolerance. Chains are walked through the
 * welded graph; open chains whose ends nearly meet are joined, and any chain
 * still open is closed straight across its ends (a hull shell without a
 * transom face slices to a U; closing it draws the transom).
 * @returns {{ loops: { points: number[][], closed: boolean }[], segments: number, closedAcross: number }}
 */
export function sliceTriangles(t, z0) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < t.length; i += 3) {
    if (t[i] < minx) minx = t[i];
    if (t[i] > maxx) maxx = t[i];
    if (t[i + 1] < miny) miny = t[i + 1];
    if (t[i + 1] > maxy) maxy = t[i + 1];
  }
  const diag = Math.hypot(maxx - minx, maxy - miny) || 1;
  const W = welder(1e-7 * diag);
  const segs = [];
  const seen = new Set();
  const cut = (a, b) => {
    const [p, q] = before(t, a, b) ? [a, b] : [b, a];
    const dz = t[q + 2] - t[p + 2];
    const s = dz !== 0 ? (z0 - t[p + 2]) / dz : 0;
    return W.id(t[p] + s * (t[q] - t[p]), t[p + 1] + s * (t[q + 1] - t[p + 1]));
  };
  for (let i = 0; i + 8 < t.length; i += 9) {
    const v = [i, i + 3, i + 6];
    const up = v.map((o) => t[o + 2] >= z0);
    if (up[0] === up[1] && up[1] === up[2]) continue;
    const ids = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      if (up[e] !== up[(e + 1) % 3]) ids.push(cut(a, b));
    }
    if (ids.length !== 2 || ids[0] === ids[1]) continue;
    const k = ids[0] < ids[1] ? `${ids[0]}:${ids[1]}` : `${ids[1]}:${ids[0]}`;
    if (seen.has(k)) continue; // the same cut from a duplicated (e.g. double-sided) face
    seen.add(k);
    segs.push(ids);
  }

  // adjacency
  const adj = new Map();
  segs.forEach(([a, b], s) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(s);
    adj.get(b).push(s);
  });
  const used = new Uint8Array(segs.length);
  const next = (p) => {
    for (const s of adj.get(p) ?? []) if (!used[s]) {
      used[s] = 1;
      const [a, b] = segs[s];
      return a === p ? b : a;
    }
    return -1;
  };
  let chains = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const [a, b] = segs[s];
    const fwd = [a, b];
    let closed = false;
    for (;;) {
      const n = next(fwd[fwd.length - 1]);
      if (n < 0) break;
      if (n === fwd[0]) {
        closed = true;
        break;
      }
      fwd.push(n);
    }
    if (!closed) {
      const back = [];
      let p = a;
      for (;;) {
        const n = next(p);
        if (n < 0) break;
        back.push(n);
        p = n;
      }
      chains.push({ ids: back.reverse().concat(fwd), closed: false });
    } else chains.push({ ids: fwd, closed: true });
  }

  // join open chains whose ends nearly meet (a gap in the mesh)
  const P = W.pts;
  const gap = 1e-3 * diag;
  const d = (i, j) => Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
  for (let changed = true; changed; ) {
    changed = false;
    const open = chains.filter((c) => !c.closed);
    outer: for (let i = 0; i < open.length; i++)
      for (let j = i + 1; j < open.length; j++) {
        const A = open[i].ids;
        const B = open[j].ids;
        const options = [
          [d(A.at(-1), B[0]), () => A.concat(B)],
          [d(A.at(-1), B.at(-1)), () => A.concat([...B].reverse())],
          [d(A[0], B.at(-1)), () => B.concat(A)],
          [d(A[0], B[0]), () => [...A].reverse().concat(B)],
        ].filter(([dist]) => dist <= gap);
        if (!options.length) continue;
        options.sort((x, y) => x[0] - y[0]);
        const joined = { ids: options[0][1](), closed: false };
        chains = chains.filter((c) => c !== open[i] && c !== open[j]).concat([joined]);
        changed = true;
        break outer;
      }
  }
  let closedAcross = 0;
  const loops = [];
  for (const c of chains) {
    let ids = c.ids;
    let closed = c.closed;
    if (!closed && ids.length > 2 && d(ids[0], ids.at(-1)) <= gap) {
      ids = ids.slice(0, -1);
      closed = true;
    }
    if (ids.length < 3) continue;
    if (!closed) closedAcross++;
    const pts = ids.map((i) => [P[i][0], P[i][1]]);
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      area += p[0] * q[1] - q[0] * p[1];
    }
    if (!(Math.abs(area / 2) > 1e-8 * diag * diag)) continue;
    // counter-clockwise seen from +z (the section contract); implicit closure either way
    loops.push({ points: area > 0 ? pts : pts.reverse(), closed: true });
  }
  return { loops, segments: segs.length, closedAcross };
}

const m2 = (v) => `${Number(v).toFixed(2)} m`;

/**
 * Why a cut found nothing, in words, or "" when it found loops.
 * @param {{ triangles: number, zMin: number, zMax: number }} t  the GLB's triangle count and z extent
 */
export function missReason({ triangles, zMin, zMax }, z0, loops) {
  if (loops > 0) return "";
  if (!triangles) return "the GLB has no triangles (only lines or points, or nothing)";
  if (z0 > zMax) return `the body spans z = ${m2(zMin)} to ${m2(zMax)}, and the plane at z = ${m2(z0)} is above it`;
  if (z0 < zMin) return `the body spans z = ${m2(zMin)} to ${m2(zMax)}, and the plane at z = ${m2(z0)} is below it`;
  return `nothing closed crosses the plane at z = ${m2(z0)} (the body spans ${m2(zMin)} to ${m2(zMax)})`;
}

/**
 * A SectionResult from a GLB, cut at z0 (floating frame, metres).
 * @param {Uint8Array|ArrayBuffer|{ json, bin, views }} input  GLB bytes, or decodeGLB()'s result
 *   (a meshopt-compressed GLB has to be decoded first: see sliceGLB)
 * @returns {{ frame, units, plane, loops, meta: { lengthWL, beamWL, triangles, zMin, zMax, units, notes, miss? } }}
 *   `meta.miss` says why, when there are no loops.
 */
export function meshSection(input, z0 = 0, plane = { kind: "waterline" }) {
  const { triangles, meshes, units, zMin, zMax, instances } = glbTriangles(input);
  const { loops, segments, closedAcross } = sliceTriangles(triangles, z0);
  let lengthWL = 0;
  let beamWL = 0;
  if (loops.length) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const l of loops)
      for (const [x, y] of l.points) {
        minx = Math.min(minx, x); maxx = Math.max(maxx, x);
        miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      }
    lengthWL = maxx - minx;
    beamWL = maxy - miny;
  }
  const count = triangles.length / 9;
  const unitNote = !units.known
    ? `; GLB units “${units.declared}” unknown, read as metres`
    : units.unit !== "m"
      ? `; GLB in ${units.unit}, scaled to metres (the scene draws every GLB as metres, so it shows this one at a different size)`
      : "";
  const notes =
    `mesh slice of ${count} triangles (${meshes.join(", ") || "no meshes"}) at z = ${z0.toFixed(3)} m: ` +
    `${loops.length} loop${loops.length === 1 ? "" : "s"} from ${segments} cuts` +
    (closedAcross ? `, ${closedAcross} closed straight across an open end` : "") +
    (instances ? `; ${instances} GPU instance${instances === 1 ? "" : "s"} expanded` : "") +
    unitNote;
  const meta = { lengthWL, beamWL, triangles: count, zMin, zMax, units: units.unit, notes };
  const miss = missReason({ triangles: count, zMin, zMax }, z0, loops.length);
  if (miss) meta.miss = miss;
  return {
    frame: "floating",
    units: "m",
    plane: { kind: plane?.kind === "z" ? "z" : "waterline", z: z0 },
    loops,
    meta,
  };
}

/** meshSection() of GLB bytes, decoding meshopt compression first if it has any. */
export async function sliceGLB(bytes, z0 = 0, plane = { kind: "waterline" }) {
  return meshSection(await decodeGLB(bytes), z0, plane);
}
