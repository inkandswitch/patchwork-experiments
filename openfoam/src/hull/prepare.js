// A hull made ready for meshing: placed at its attitude, welded, oriented,
// closed, measured, and written as binary STL. Pure (no DOM, no automerge),
// so the tool runs it and the tests prove it.
//
// Frame: the FLOATING frame, metres, x toward the bow, y to port, z up, the
// design waterline at z = 0. The input is a flat triangle list (9 numbers a
// triangle), as mesh-read.js's glbTriangles gives it.
//
// Why each step:
//   weld    GLB meshes repeat a vertex wherever normals or parts split (the
//           hull, the transom and the deck are separate meshes in camber's
//           GLBs), so edges only meet once points are merged.
//   orient  snappyHexMesh and the volume below both want one consistent
//           winding. Faces are flipped to agree with their neighbours across
//           every manifold edge, then all of them so the enclosed volume is
//           positive (normals out).
//   close   A hull shell can be open: camber draws some transoms as no face
//           at all, and a deck may be missing. An open shell leaks, and the
//           mesher fills the boat with water. Each boundary loop is fanned
//           from its centroid, wound to match the faces around it, so the
//           result is closed and still consistently oriented.

/** @typedef {{ points: Float64Array, faces: Uint32Array }} Mesh  points xyz…, faces abc… */

/** Bounds of a flat xyz array. */
export function boundsOf(xyz) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < xyz.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = xyz[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return { min, max };
}

/**
 * The hull at its attitude: trimmed by `trim` degrees (bow down positive)
 * about (pivotX, 0, 0), then lowered by `sinkage` metres. A rigid motion, so
 * lengths, areas and volumes are kept.
 * @param {Float64Array|number[]} tris  9 numbers a triangle
 */
export function applyAttitude(tris, { sinkage = 0, trim = 0 } = {}, pivotX = 0) {
  const th = (trim * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const out = new Float64Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const dx = tris[i] - pivotX;
    const z = tris[i + 2];
    out[i] = pivotX + dx * c + z * s;
    out[i + 1] = tris[i + 1];
    // bow (dx > 0) goes down for trim > 0
    out[i + 2] = -dx * s + z * c - sinkage;
  }
  return out;
}

/**
 * Merge points closer than `tol` (a grid hash checking neighbouring cells, so
 * points either side of a cell edge still meet) and drop faces that collapse.
 * @returns {Mesh & { dropped: number }}
 */
export function weld(tris, tol) {
  const cells = new Map();
  const pts = [];
  const key = (i, j, k) => `${i},${j},${k}`;
  const idOf = (x, y, z) => {
    const ci = Math.floor(x / tol), cj = Math.floor(y / tol), ck = Math.floor(z / tol);
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (let dk = -1; dk <= 1; dk++) {
          const list = cells.get(key(ci + di, cj + dj, ck + dk));
          if (!list) continue;
          for (const id of list) {
            const p = id * 3;
            if (Math.abs(pts[p] - x) <= tol && Math.abs(pts[p + 1] - y) <= tol && Math.abs(pts[p + 2] - z) <= tol) return id;
          }
        }
    const id = pts.length / 3;
    pts.push(x, y, z);
    const k = key(ci, cj, ck);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(id);
    return id;
  };
  const faces = [];
  let dropped = 0;
  const seen = new Set();
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a = idOf(tris[i], tris[i + 1], tris[i + 2]);
    const b = idOf(tris[i + 3], tris[i + 4], tris[i + 5]);
    const c = idOf(tris[i + 6], tris[i + 7], tris[i + 8]);
    if (a === b || b === c || c === a) {
      dropped++;
      continue;
    }
    // the same triangle twice (two meshes sharing a face) would make a
    // non-manifold sheet: keep one
    const k = [a, b, c].sort((p, q) => p - q).join(",");
    if (seen.has(k)) {
      dropped++;
      continue;
    }
    seen.add(k);
    faces.push(a, b, c);
  }
  return { points: Float64Array.from(pts), faces: Uint32Array.from(faces), dropped };
}

const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Every undirected edge → the faces using it. */
function edgeFaces(faces) {
  const m = new Map();
  for (let f = 0; f * 3 < faces.length; f++)
    for (let e = 0; e < 3; e++) {
      const a = faces[f * 3 + e], b = faces[f * 3 + ((e + 1) % 3)];
      const k = ekey(a, b);
      let list = m.get(k);
      if (!list) m.set(k, (list = []));
      list.push(f);
    }
  return m;
}

/** Does face f run a → b (rather than b → a)? */
function runs(faces, f, a, b) {
  for (let e = 0; e < 3; e++) if (faces[f * 3 + e] === a && faces[f * 3 + ((e + 1) % 3)] === b) return true;
  return false;
}

/** Counts of boundary (1 face), manifold (2) and non-manifold (3+) edges. */
export function edgeStats(mesh) {
  let boundary = 0, manifold = 0, nonManifold = 0;
  for (const list of edgeFaces(mesh.faces).values()) {
    if (list.length === 1) boundary++;
    else if (list.length === 2) manifold++;
    else nonManifold++;
  }
  return { boundary, manifold, nonManifold };
}

/**
 * Signed volume enclosed (divergence theorem, ∮ z n_z dA), positive for
 * outward normals. Only meaningful for a closed, consistently wound mesh.
 */
export function signedVolume({ points: p, faces }) {
  let v = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

/**
 * Make the winding consistent across every manifold edge (two faces on an
 * edge must run it in opposite directions), component by component.
 * @returns {Mesh & { flipped: number, conflicts: number }}  conflicts: edges a
 *   non-orientable patch left disagreeing (0 for any real hull)
 */
export function orient(mesh) {
  const faces = Uint32Array.from(mesh.faces);
  const nf = faces.length / 3;
  const ef = edgeFaces(faces);
  const done = new Uint8Array(nf);
  let flipped = 0;
  const flip = (f) => {
    const t = faces[f * 3 + 1];
    faces[f * 3 + 1] = faces[f * 3 + 2];
    faces[f * 3 + 2] = t;
  };
  for (let seed = 0; seed < nf; seed++) {
    if (done[seed]) continue;
    done[seed] = 1;
    const stack = [seed];
    while (stack.length) {
      const f = stack.pop();
      for (let e = 0; e < 3; e++) {
        const a = faces[f * 3 + e], b = faces[f * 3 + ((e + 1) % 3)];
        const list = ef.get(ekey(a, b));
        if (!list || list.length !== 2) continue;
        const g = list[0] === f ? list[1] : list[0];
        if (done[g]) continue;
        // f runs a → b; g must run b → a
        if (runs(faces, g, a, b)) {
          flip(g);
          flipped++;
        }
        done[g] = 1;
        stack.push(g);
      }
    }
  }
  let conflicts = 0;
  for (const [k, list] of ef) {
    if (list.length !== 2) continue;
    const [a, b] = k.split("_").map(Number);
    if (runs(faces, list[0], a, b) === runs(faces, list[1], a, b)) conflicts++;
  }
  return { points: mesh.points, faces, flipped, conflicts };
}

/**
 * Close every boundary loop with a fan from its centroid. Each new face runs
 * its boundary edge the opposite way from the face that already has it, so
 * the closed mesh keeps one winding.
 * @returns {Mesh & { loops: { edges: number, perimeter: number, centroid: number[] }[], open: number }}
 *   open: boundary edges that couldn't be chained into a loop (left as they were)
 */
export function closeHoles(mesh) {
  const ef = edgeFaces(mesh.faces);
  // directed boundary edges, as the existing face runs them: a → b
  const next = new Map();
  let boundary = 0;
  for (const [k, list] of ef) {
    if (list.length !== 1) continue;
    boundary++;
    const [p, q] = k.split("_").map(Number);
    const f = list[0];
    const [a, b] = runs(mesh.faces, f, p, q) ? [p, q] : [q, p];
    // the hole runs b → a (opposite to the face); chain in that direction
    if (!next.has(b)) next.set(b, []);
    next.get(b).push(a);
  }
  const points = Array.from(mesh.points);
  const faces = Array.from(mesh.faces);
  const loops = [];
  const used = new Set();
  let open = 0;
  for (const start of next.keys()) {
    for (const first of next.get(start)) {
      const k0 = `${start}>${first}`;
      if (used.has(k0)) continue;
      const loop = [start];
      let cur = start, nxt = first, ok = false;
      for (let guard = 0; guard <= boundary; guard++) {
        used.add(`${cur}>${nxt}`);
        if (nxt === start) {
          ok = true;
          break;
        }
        loop.push(nxt);
        const options = (next.get(nxt) ?? []).filter((v) => !used.has(`${nxt}>${v}`));
        if (!options.length) break;
        cur = nxt;
        nxt = options[0];
      }
      if (!ok || loop.length < 3) {
        open += loop.length;
        continue;
      }
      const c = [0, 0, 0];
      let perimeter = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
        for (let k = 0; k < 3; k++) c[k] += points[a + k] / loop.length;
        perimeter += Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1], points[b + 2] - points[a + 2]);
      }
      const ci = points.length / 3;
      points.push(c[0], c[1], c[2]);
      // the loop runs as the hole does (opposite to the faces round it), so
      // fanning it in loop order winds the new faces to match theirs
      for (let i = 0; i < loop.length; i++) faces.push(loop[i], loop[(i + 1) % loop.length], ci);
      loops.push({ edges: loop.length, perimeter, centroid: c });
    }
  }
  return { points: Float64Array.from(points), faces: Uint32Array.from(faces), loops, open };
}

/** Flip every face (turn the normals the other way). */
export function flipAll(mesh) {
  const faces = Uint32Array.from(mesh.faces);
  for (let f = 0; f < faces.length; f += 3) {
    const t = faces[f + 1];
    faces[f + 1] = faces[f + 2];
    faces[f + 2] = t;
  }
  return { points: mesh.points, faces };
}

/**
 * Clip one triangle to z ≤ 0 (Sutherland–Hodgman against one plane).
 * @returns {number[][]} the polygon, 0, 3 or 4 points
 */
export function clipBelow(a, b, c) {
  const poly = [a, b, c];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const p = poly[i], q = poly[(i + 1) % 3];
    const pin = p[2] <= 0, qin = q[2] <= 0;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = p[2] / (p[2] - q[2]);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), 0]);
    }
  }
  return out;
}

/**
 * What the hull is below the waterline: displaced volume and its centre,
 * wetted area, waterline length and breadth, draft. The volume needs a
 * closed, outward-wound mesh (closeHoles + orient); the cap at z = 0 adds
 * nothing to ∮ z n_z dA, so the clipped faces alone give it.
 */
export function hydrostatics({ points: p, faces }) {
  let volume = 0, mx = 0, area = 0;
  // the waterplane, by Green's theorem over the cut: every segment of a clipped
  // face lying in z = 0 is part of the waterline, and an outward-wound hull
  // runs them all the same way round (the signs cancel below)
  let wA = 0, wMx = 0, wIx = 0;
  let wlMinX = Infinity, wlMaxX = -Infinity, wlMaxY = 0, zMin = Infinity;
  let wlMinY = Infinity, wlMaxYs = -Infinity;
  const P = (i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  for (let f = 0; f < faces.length; f += 3) {
    const poly = clipBelow(P(faces[f]), P(faces[f + 1]), P(faces[f + 2]));
    if (poly.length < 3) continue;
    for (const q of poly) {
      if (q[2] < zMin) zMin = q[2];
      if (q[2] === 0) {
        if (q[0] < wlMinX) wlMinX = q[0];
        if (q[0] > wlMaxX) wlMaxX = q[0];
        if (Math.abs(q[1]) > wlMaxY) wlMaxY = Math.abs(q[1]);
        if (q[1] < wlMinY) wlMinY = q[1];
        if (q[1] > wlMaxYs) wlMaxYs = q[1];
      }
    }
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      if (p[2] !== 0 || q[2] !== 0) continue;
      const cr = p[0] * q[1] - q[0] * p[1];
      wA += cr / 2;
      wMx += ((p[0] + q[0]) * cr) / 6;
      wIx += ((p[0] * p[0] + p[0] * q[0] + q[0] * q[0]) * cr) / 12;
    }
    for (let i = 1; i + 1 < poly.length; i++) {
      const a = poly[0], b = poly[i], c = poly[i + 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // 2A n̂
      area += Math.hypot(nx, ny, nz) / 2;
      // ∫ z n_z dA and ∫ x z n_z dA over the triangle (z, xz linear/quadratic: exact by vertex rules)
      const zc = (a[2] + b[2] + c[2]) / 3;
      volume += (zc * nz) / 2;
      // ∫ x z dA over a triangle = A/12 (Σ x_i z_i + Σ x_i · Σ z_i) for linear x, z
      // (∫ φ_i φ_j = A/12 (1 + δ_ij)); nz is 2A n̂_z, hence the /2
      const xz = (a[0] * a[2] + b[0] * b[2] + c[0] * c[2] + (a[0] + b[0] + c[0]) * (a[2] + b[2] + c[2])) / 12;
      mx += (xz * nz) / 2;
    }
  }
  // outward normals: below the plane z < 0 where n_z < 0, so ∮ z n_z dA is +V
  const wet = Number.isFinite(wlMinX);
  const awp = Math.abs(wA);
  const lcf = wA ? wMx / wA : null;
  // second moment about the LCF (∫x² dA − A·LCF²): the longitudinal stiffness is ρ g I_L
  const il = wA ? wIx / wA * awp - awp * lcf * lcf : 0;
  return {
    awp,
    lcf,
    il,
    volume,
    lcb: volume > 0 ? mx / volume : null,
    wettedArea: area,
    lwl: wet ? wlMaxX - wlMinX : 0,
    bwl: wet ? wlMaxYs - wlMinY : 0,
    halfBeamWl: wet ? wlMaxY : 0,
    wlXMin: wet ? wlMinX : null,
    wlXMax: wet ? wlMaxX : null,
    draft: Number.isFinite(zMin) ? -zMin : 0,
    pierces: wet,
  };
}

/**
 * Is the hull symmetric about y = 0 (so a half model with a symmetry plane is
 * exact)? By its extent and its area-weighted centroid in y.
 */
export function isSymmetric({ points: p, faces }, L) {
  const { min, max } = boundsOf(p);
  const tol = 1e-3 * Math.max(L, 1e-6);
  if (Math.abs(min[1] + max[1]) > tol) return false;
  let ay = 0, a = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const i = faces[f] * 3, j = faces[f + 1] * 3, k = faces[f + 2] * 3;
    const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
    const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
    const A = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    a += A;
    ay += (A * (p[i + 1] + p[j + 1] + p[k + 1])) / 3;
  }
  return a > 0 && Math.abs(ay / a) <= tol;
}

/** Binary STL of a mesh (float32, little-endian; normals from the winding). */
export function encodeSTL({ points: p, faces }, name = "hull") {
  const n = faces.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  // never start a binary header with "solid": readers (OpenFOAM's among them)
  // take that for an ASCII STL
  const header = new TextEncoder().encode(`binary STL: ${name} (patchwork openfoam)`.slice(0, 80));
  new Uint8Array(buf, 0, 80).set(header);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

/** Read a binary STL back (tests, and the daemon's checks). */
export function decodeSTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const tris = new Float64Array(n * 9);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) {
      tris[t * 9 + k] = dv.getFloat32(o, true);
      o += 4;
    }
    o += 2;
  }
  return tris;
}

/**
 * The whole preparation. `tris` is the hull as drawn (floating frame).
 * Trim pivots about the hull's mid-length at the waterline as drawn.
 * @returns {{ mesh: Mesh, stl: Uint8Array, info: object, warnings: string[] }}
 */
export function prepareHull(tris, attitude = {}) {
  const warnings = [];
  if (!tris?.length) throw new Error("the hull has no triangles");
  const b0 = boundsOf(tris);
  const L0 = b0.max[0] - b0.min[0];
  const pivotX = (b0.min[0] + b0.max[0]) / 2;
  const placed = applyAttitude(tris, attitude, pivotX);
  const diag = Math.hypot(...b0.max.map((v, k) => v - b0.min[k]));
  const welded = weld(placed, Math.max(1e-9, 1e-6 * diag));
  const oriented = orient(welded);
  if (oriented.conflicts) warnings.push(`${oriented.conflicts} edges couldn't be wound consistently (a non-orientable patch)`);
  const stats0 = edgeStats(oriented);
  let closed = closeHoles(oriented);
  if (closed.loops.length)
    warnings.push(
      `closed ${closed.loops.length} opening${closed.loops.length > 1 ? "s" : ""} in the shell (${closed.loops.map((l) => `${l.edges} edges`).join(", ")}): a transom or deck the model doesn't draw`,
    );
  if (closed.open) warnings.push(`${closed.open} boundary edges couldn't be chained into a loop and stay open`);
  if (stats0.nonManifold) warnings.push(`${stats0.nonManifold} non-manifold edges (three or more faces on one edge)`);
  let mesh = { points: closed.points, faces: closed.faces };
  if (signedVolume(mesh) < 0) mesh = flipAll(mesh);
  const stats = edgeStats(mesh);
  const b = boundsOf(mesh.points);
  const L = b.max[0] - b.min[0];
  const hydro = hydrostatics(mesh);
  if (!hydro.pierces) warnings.push(b.max[2] < 0 ? "the hull is wholly under water: raise it (negative sinkage)" : "the hull is wholly out of the water: lower it (sinkage)");
  const info = {
    triangles: mesh.faces.length / 3,
    closed: stats.boundary === 0,
    boundaryEdges: stats.boundary,
    loa: L,
    beam: b.max[1] - b.min[1],
    bounds: { min: b.min, max: b.max },
    asDrawn: { min: b0.min, max: b0.max, loa: L0 },
    symmetric: isSymmetric(mesh, L),
    attitude: { sinkage: attitude.sinkage ?? 0, trim: attitude.trim ?? 0, pivotX },
    ...hydro,
  };
  return { mesh, stl: encodeSTL(mesh), info, warnings };
}

/**
 * The sinkage that floats the hull at a displaced volume (m³), at its trim:
 * bisection on hydrostatics(), which only grows as the hull goes down.
 * Null when the volume is out of reach (more than the whole hull displaces).
 */
export function sinkageForVolume(tris, target, trim = 0) {
  const b0 = boundsOf(tris);
  const pivotX = (b0.min[0] + b0.max[0]) / 2;
  const diag = Math.hypot(...b0.max.map((v, k) => v - b0.min[k]));
  const base = weld(applyAttitude(tris, { trim }, pivotX), Math.max(1e-9, 1e-6 * diag));
  let mesh = closeHoles(orient(base));
  mesh = { points: mesh.points, faces: mesh.faces };
  if (signedVolume(mesh) < 0) mesh = flipAll(mesh);
  const { min, max } = boundsOf(mesh.points);
  const at = (s) => {
    const p = Float64Array.from(mesh.points);
    for (let i = 2; i < p.length; i += 3) p[i] -= s;
    return hydrostatics({ points: p, faces: mesh.faces }).volume;
  };
  // sinkage s puts the waterline at z = s in the trimmed frame: lo = keel, hi = top
  let lo = min[2], hi = max[2];
  if (!(target > 0) || at(hi) < target) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
