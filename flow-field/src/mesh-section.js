// The fallback section: slice a provider's GLB with a horizontal plane.
// Pure — bytes in, loops out.
//
// When no geometry:section provider is installed for the linked doc, the flow
// builds the doc with its scene:source provider (in memory) and cuts the
// triangles of that GLB. The GLB is glTF Y-up; the section is in the floating
// frame, which the contract puts at x = X, y = −Z, z = Y (v2 §3).

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

/** An accessor's elements as a flat array (strides and offsets honoured). */
export function readAccessor(json, bin, index) {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`glb: no accessor ${index}`);
  const comps = COMPONENTS[acc.type] ?? 1;
  const reader = READERS[acc.componentType];
  if (!reader) throw new Error(`glb: unsupported component type ${acc.componentType}`);
  const [size, read] = reader;
  const out = new Float64Array(acc.count * comps);
  if (acc.bufferView == null) return out; // all zeros, per the spec (sparse accessors aren't read)
  const view = json.bufferViews?.[acc.bufferView];
  if (!view || (view.buffer ?? 0) !== 0 || !bin) throw new Error("glb: accessor outside the BIN chunk");
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const stride = view.byteStride || comps * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
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

/**
 * Every triangle of a GLB, in the FLOATING frame, as a flat array of
 * 9 numbers per triangle. Node transforms are applied; line and point
 * primitives are skipped; strips and fans are unrolled.
 * @returns {{ triangles: Float64Array, meshes: string[] }}
 */
export function glbTriangles(bytes) {
  const { json, bin } = parseGLB(bytes);
  const out = [];
  const names = [];
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];

  const emitMesh = (mi, M) => {
    const mesh = meshes[mi];
    if (!mesh) return;
    let used = false;
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue;
      if (prim.attributes?.POSITION == null) continue;
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      const count = pos.length / 3;
      const idx = prim.indices != null ? readAccessor(json, bin, prim.indices) : null;
      const at = (i) => (idx ? idx[i] : i);
      const n = idx ? idx.length : count;
      const tri = [];
      if (mode === 4) for (let i = 0; i + 2 < n; i += 3) tri.push(at(i), at(i + 1), at(i + 2));
      else if (mode === 5) for (let i = 0; i + 2 < n; i++) tri.push(at(i), at(i + 1), at(i + 2));
      else for (let i = 1; i + 1 < n; i++) tri.push(at(0), at(i), at(i + 1));
      for (const v of tri) {
        if (!(v >= 0 && v < count)) continue;
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        const X = M[0] * x + M[4] * y + M[8] * z + M[12];
        const Y = M[1] * x + M[5] * y + M[9] * z + M[13];
        const Z = M[2] * x + M[6] * y + M[10] * z + M[14];
        // glTF (Y-up) → floating frame: x = X, y = −Z, z = Y
        out.push(X, 0 - Z, Y);
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
    if (node.mesh != null) emitMesh(node.mesh, M);
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
  } else meshes.forEach((_, mi) => emitMesh(mi, IDENTITY));
  // a triangle list has 9 numbers per triangle; drop a dangling partial one
  const len = out.length - (out.length % 9);
  return { triangles: Float64Array.from(out.slice(0, len)), meshes: names };
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

/**
 * A SectionResult from a GLB, cut at z0 (floating frame).
 */
export function meshSection(bytes, z0 = 0, plane = { kind: "waterline" }) {
  const { triangles, meshes } = glbTriangles(bytes);
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
  const notes =
    `mesh slice of ${triangles.length / 9} triangles (${meshes.join(", ") || "no meshes"}) at z = ${z0.toFixed(3)} m: ` +
    `${loops.length} loop${loops.length === 1 ? "" : "s"} from ${segments} cuts` +
    (closedAcross ? `, ${closedAcross} closed straight across an open end` : "");
  return {
    frame: "floating",
    units: "m",
    plane: { kind: plane?.kind === "z" ? "z" : "waterline", z: z0 },
    loops,
    meta: { lengthWL, beamWL, notes },
  };
}
