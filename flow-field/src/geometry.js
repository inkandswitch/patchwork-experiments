// Meshes from streamlines and slices, in the DOCUMENT frame (z up). The
// builders convert to glTF at the very end (coords.js). Pure.

/**
 * Drop consecutive points closer than `eps` (a zero-length segment has no
 * tangent). Scalars in `fields` are kept in step.
 */
export function dedupePolyline(points, fields = {}, eps = 1e-7) {
  const out = { points: [], fields: Object.fromEntries(Object.keys(fields).map((k) => [k, []])) };
  let last = null;
  points.forEach((p, i) => {
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < eps) return;
    out.points.push(p);
    for (const k of Object.keys(fields)) out.fields[k].push(fields[k][i]);
    last = p;
  });
  return out;
}

/**
 * Thin out a finely integrated polyline for meshing: keep a point once the
 * path has turned more than `maxTurnDeg` or run `maxSegment` metres since the
 * last kept point. The first and last points are always kept.
 */
export function simplifyPolyline(points, fields = {}, { maxTurnDeg = 2, maxSegment = 0.5 } = {}) {
  const keys = Object.keys(fields);
  if (points.length <= 2) return { points: [...points], fields: Object.fromEntries(keys.map((k) => [k, [...fields[k]]])) };
  const keep = [0];
  const cosMax = Math.cos((maxTurnDeg * Math.PI) / 180);
  let a = points[0];
  let dir = null;
  let run = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const q = points[i];
    const seg = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    run += seg;
    const d = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (!dir && l > 0) dir = [d[0] / l, d[1] / l, d[2] / l];
    const cos = dir && l > 0 ? (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / l : 1;
    if (cos < cosMax || run >= maxSegment) {
      // the previous point is the last one the straight chord still fits
      const k = cos < cosMax && i - 1 > keep.at(-1) ? i - 1 : i;
      keep.push(k);
      a = points[k];
      dir = null;
      run = 0;
      if (k === i - 1) i--; // re-examine i against the new anchor
    }
  }
  keep.push(points.length - 1);
  return {
    points: keep.map((i) => points[i]),
    fields: Object.fromEntries(keys.map((k) => [k, keep.map((i) => fields[k][i])])),
  };
}

/**
 * Polylines → one LINES primitive (index pairs), which merges any number of
 * strips into one draw.
 * @param {{ points: number[][], fields: { [name]: number[] } }[]} lines
 * @returns {{ positions: Float32Array, indices: Uint32Array, fields: { [name]: Float32Array } }}
 */
export function linesMesh(lines, fieldNames) {
  let nv = 0;
  let ns = 0;
  for (const l of lines) {
    nv += l.points.length;
    ns += Math.max(0, l.points.length - 1);
  }
  const positions = new Float32Array(nv * 3);
  const indices = new Uint32Array(ns * 2);
  const fields = Object.fromEntries(fieldNames.map((k) => [k, new Float32Array(nv)]));
  let v = 0;
  let s = 0;
  for (const l of lines) {
    const base = v;
    l.points.forEach((p, i) => {
      positions[v * 3] = p[0];
      positions[v * 3 + 1] = p[1];
      positions[v * 3 + 2] = p[2];
      for (const k of fieldNames) fields[k][v] = l.fields[k][i];
      v++;
      if (i > 0) {
        indices[s++] = base + i - 1;
        indices[s++] = base + i;
      }
    });
  }
  return { positions, indices, fields };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : null;
};

/** Any unit vector perpendicular to t. */
function perpendicular(t) {
  const a = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return norm(cross(t, a));
}

/**
 * Thin tubes around polylines: a ring of `sides` vertices per point, frames
 * carried along by parallel transport (so tubes don't twist), outward normals,
 * scalars replicated around each ring. No end caps — at 3 cm nobody sees them.
 * Polylines with fewer than two distinct points are skipped.
 */
export function tubesMesh(lines, fieldNames, { radius = 0.03, sides = 6 } = {}) {
  const n = Math.max(3, Math.floor(sides));
  const usable = lines.filter((l) => l.points.length >= 2);
  let nv = 0;
  let nt = 0;
  for (const l of usable) {
    nv += l.points.length * n;
    nt += (l.points.length - 1) * n * 2;
  }
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const indices = new Uint32Array(nt * 3);
  const fields = Object.fromEntries(fieldNames.map((k) => [k, new Float32Array(nv)]));
  const cos = Array.from({ length: n }, (_, j) => Math.cos((2 * Math.PI * j) / n));
  const sin = Array.from({ length: n }, (_, j) => Math.sin((2 * Math.PI * j) / n));
  let v = 0;
  let t = 0;
  for (const l of usable) {
    const P = l.points;
    const m = P.length;
    const base = v;
    let N = null;
    let prevT = null;
    for (let i = 0; i < m; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(m - 1, i + 1)];
      const T = norm(sub(b, a)) ?? prevT ?? [1, 0, 0];
      if (!N) N = perpendicular(T);
      else {
        // parallel transport: remove the component along the new tangent
        const d = dot(N, T);
        N = norm([N[0] - d * T[0], N[1] - d * T[1], N[2] - d * T[2]]) ?? perpendicular(T);
      }
      const B = cross(T, N);
      prevT = T;
      for (let j = 0; j < n; j++) {
        const nx = cos[j] * N[0] + sin[j] * B[0];
        const ny = cos[j] * N[1] + sin[j] * B[1];
        const nz = cos[j] * N[2] + sin[j] * B[2];
        positions[v * 3] = P[i][0] + radius * nx;
        positions[v * 3 + 1] = P[i][1] + radius * ny;
        positions[v * 3 + 2] = P[i][2] + radius * nz;
        normals[v * 3] = nx;
        normals[v * 3 + 1] = ny;
        normals[v * 3 + 2] = nz;
        for (const k of fieldNames) fields[k][v] = l.fields[k][i];
        v++;
      }
      if (i > 0) {
        const r0 = base + (i - 1) * n;
        const r1 = base + i * n;
        for (let j = 0; j < n; j++) {
          const j1 = (j + 1) % n;
          // counter-clockwise seen from outside (T × N = B, rings go N → B)
          indices[t++] = r0 + j;
          indices[t++] = r0 + j1;
          indices[t++] = r1 + j;
          indices[t++] = r1 + j;
          indices[t++] = r0 + j1;
          indices[t++] = r1 + j1;
        }
      }
    }
  }
  return { positions, normals, indices, fields };
}

/**
 * A horizontal grid over the domain at height z: (nx+1)(ny+1) vertices,
 * cells of equal size along both axes, `resolution` cells along the longer
 * side. `sample(x, y, z)` returns { values: {name: number}, masked: boolean }.
 * `o.mask(nx, ny, xAt, yAt)`, if given, returns the whole (nx+1)(ny+1) mask at
 * once (see coarseMask) and `sample`'s `masked` is ignored.
 *
 * A cell with no masked corner is two triangles. Without `o.edge`, a cell with
 * any masked corner is left out, so a body's outline is a staircase of whole
 * cells. With `o.edge(ax, ay, bx, by)` — the fraction 0…1 of the way from an
 * unmasked point a to a masked point b where the boundary lies — a mixed cell
 * is clipped there instead (marching squares): its unmasked part is kept as a
 * fan of triangles through the crossing points, which are shared by the two
 * cells on either side of an edge. Crossing vertices are appended after the
 * grid's own, and are never masked. They are sampled where they fall, or,
 * with `o.edgeSample` = f < 1, a fraction f of the way from the unmasked end
 * to the crossing (the values right on a body's outline can be singular).
 */
export function sliceGrid(domain, z, resolution, fieldNames, sample, o = {}) {
  const { min, max } = domain;
  const w = max[0] - min[0];
  const h = max[1] - min[1];
  const res = Math.max(2, Math.floor(resolution));
  const cell = Math.max(w, h) / res;
  const nx = Math.max(1, Math.round(w / cell));
  const ny = Math.max(1, Math.round(h / cell));
  const nv = (nx + 1) * (ny + 1);
  const P = [];
  const F = Object.fromEntries(fieldNames.map((k) => [k, []]));
  let masked = new Uint8Array(nv);
  const addVertex = (x, y, sx = x, sy = y) => {
    P.push(x, y, z);
    const s = sample(sx, sy, z);
    for (const k of fieldNames) F[k].push(s.values[k]);
    return s;
  };
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const s = addVertex(min[0] + (w * i) / nx, min[1] + (h * j) / ny);
      masked[j * (nx + 1) + i] = s.masked ? 1 : 0;
    }
  }
  if (o.mask) masked = o.mask(nx, ny, (i) => min[0] + (w * i) / nx, (j) => min[1] + (h * j) / ny);
  const edge = typeof o.edge === "function" ? o.edge : null;
  const edgeSample = Number.isFinite(o.edgeSample) ? Math.min(1, Math.max(0, o.edgeSample)) : 1;
  const crossings = new Map();
  // the crossing on the grid edge between vertex a (unmasked) and b (masked)
  const cross = (a, b) => {
    const key = a < b ? a * nv + b : b * nv + a;
    let v = crossings.get(key);
    if (v === undefined) {
      const ax = P[a * 3], ay = P[a * 3 + 1], bx = P[b * 3], by = P[b * 3 + 1];
      let t = Number(edge(ax, ay, bx, by));
      t = Number.isFinite(t) ? Math.min(0.999, Math.max(0.001, t)) : 0.5;
      v = P.length / 3;
      // sampled a little back toward the stream end: on the outline itself a
      // panel body's velocity is singular (a panel's own end, a sharp corner)
      const f = t * edgeSample;
      addVertex(ax + t * (bx - ax), ay + t * (by - ay), ax + f * (bx - ax), ay + f * (by - ay));
      crossings.set(key, v);
    }
    return v;
  };
  const tris = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      const m = masked[a] + masked[b] + masked[c] + masked[d];
      if (m === 0) {
        // counter-clockwise seen from +z
        tris.push(a, b, d, a, d, c);
        continue;
      }
      if (!edge || m === 4) continue;
      // walk the corners counter-clockwise (a, b, d, c), keeping unmasked
      // corners and the crossing on every edge that changes state
      const ring = [a, b, d, c];
      const poly = [];
      for (let k = 0; k < 4; k++) {
        const p = ring[k];
        const q = ring[(k + 1) % 4];
        if (!masked[p]) poly.push(p);
        if (masked[p] !== masked[q]) poly.push(masked[p] ? cross(q, p) : cross(p, q));
      }
      for (let k = 1; k + 1 < poly.length; k++) tris.push(poly[0], poly[k], poly[k + 1]);
    }
  }
  const count = P.length / 3;
  const positions = Float32Array.from(P);
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) normals[v * 3 + 2] = 1;
  const fields = Object.fromEntries(fieldNames.map((k) => [k, Float32Array.from(F[k])]));
  const allMasked = new Uint8Array(count);
  allMasked.set(masked);
  return { positions, normals, indices: Uint32Array.from(tris), fields, masked: allMasked, nx, ny, gridVertices: nv };
}

/**
 * A (nx+1) × (ny+1) vertex mask where `test(i, j)` is expensive. It is called
 * on every k-th vertex (and the last row and column) first; a vertex between
 * those takes their value when every lattice point within one lattice step of
 * it agrees, and is tested itself otherwise, i.e. only along edges. A feature
 * narrower than ~k vertices that falls entirely between lattice points can be
 * missed. Returns a Uint8Array indexed j * (nx + 1) + i.
 */
export function coarseMask(nx, ny, k, test) {
  const W = nx + 1;
  const out = new Uint8Array(W * (ny + 1));
  const step = Math.max(1, Math.floor(k));
  const lat = (n) => {
    const a = [];
    for (let i = 0; i <= n; i += step) a.push(i);
    if (a[a.length - 1] !== n) a.push(n);
    return a;
  };
  const LX = lat(nx);
  const LY = lat(ny);
  const L = new Uint8Array(LX.length * LY.length);
  for (let b = 0; b < LY.length; b++)
    for (let a = 0; a < LX.length; a++) {
      const v = test(LX[a], LY[b]) ? 1 : 0;
      L[b * LX.length + a] = v;
      out[LY[b] * W + LX[a]] = v;
    }
  if (step === 1) return out;
  // lattice index at or below i
  const below = (arr, i) => {
    let lo = 0;
    while (lo + 1 < arr.length && arr[lo + 1] <= i) lo++;
    return lo;
  };
  const bx = Array.from({ length: nx + 1 }, (_, i) => below(LX, i));
  const by = Array.from({ length: ny + 1 }, (_, j) => below(LY, j));
  for (let j = 0; j <= ny; j++) {
    const onRow = LY[by[j]] === j;
    for (let i = 0; i <= nx; i++) {
      if (onRow && LX[bx[i]] === i) continue;
      const a0 = Math.max(0, bx[i] - 1);
      const a1 = Math.min(LX.length - 1, bx[i] + 2);
      const b0 = Math.max(0, by[j] - 1);
      const b1 = Math.min(LY.length - 1, by[j] + 2);
      const first = L[b0 * LX.length + a0];
      let same = true;
      for (let b = b0; b <= b1 && same; b++)
        for (let a = a0; a <= a1; a++)
          if (L[b * LX.length + a] !== first) {
            same = false;
            break;
          }
      out[j * W + i] = same ? first : test(i, j) ? 1 : 0;
    }
  }
  return out;
}

/**
 * Thin polylines ({points, fields}) so the total point count is at most
 * `maxPoints`, keeping each line's ends and taking evenly spaced points in
 * between. Lines already under budget are returned untouched.
 */
export function capPoints(lines, maxPoints) {
  const total = lines.reduce((a, l) => a + l.points.length, 0);
  if (total <= maxPoints) return lines;
  const f = maxPoints / total;
  return lines.map((l) => {
    const m = l.points.length;
    const keep = Math.max(2, Math.min(m, Math.floor(m * f)));
    if (keep >= m) return l;
    const idx = Array.from({ length: keep }, (_, q) => Math.round((q * (m - 1)) / (keep - 1)));
    const fields = Object.fromEntries(Object.entries(l.fields ?? {}).map(([k, v]) => [k, idx.map((i) => v[i])]));
    return { ...l, points: idx.map((i) => l.points[i]), fields };
  });
}
