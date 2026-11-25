// A part's surface: welded, checked for being one closed solid, and split
// into the faces a person points at ("this face is held", "push on that one").
//
// Pure functions over typed arrays, in the part's own frame (the scene's: Y
// up, metres). The study tool runs them in the page when a part is read; the
// daemon runs them again on the frozen part, so a face id means the same
// triangles on both sides.
//
// A FACE is a maximal patch a person would call one surface:
//
//   1. Triangles lying in one plane are one FLAT (grown from the largest
//      triangle outward, each tested against the first one's plane, so a
//      gentle curve can't creep into it facet by facet).
//   2. Flats and lone triangles that meet at less than SHARP_DEG are joined,
//      EXCEPT a flat with something BROAD_RATIO times smaller. So the many
//      equal strips of a cylinder become one face, as do the strips of a
//      fillet, while the big flat a fillet runs into stays its own face,
//      though the two meet with no edge between them.
//
// Faces are numbered by where they are (sorted by centroid, then area), not
// by the order triangles happened to arrive in, so the same part read twice
// numbers its faces the same.

export const SHARP_DEG = 30;
export const BROAD_RATIO = 6;
/** A flat's triangles lie within this angle of its first triangle's plane… */
const FLAT_DEG = 1;
/** …and within this fraction of the part's diagonal of it. */
const FLAT_OFFSET = 1e-5;
/** Vertices closer than this fraction of the part's diagonal are one vertex. */
const WELD = 1e-6;

const cross = (ax, ay, az, bx, by, bz) => [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];

/** `{ min, max, diagonal }` of flat xyz positions. */
export function extent(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  if (!positions.length) return { min: [0, 0, 0], max: [0, 0, 0], diagonal: 0 };
  return { min, max, diagonal: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) };
}

/**
 * Triangle soup (9 numbers a triangle) → shared vertices. Vertices within
 * `tol` of each other become one; triangles that collapse are dropped.
 * `exact`: only vertices with the very same coordinates are one, and no
 * triangle is dropped or moved: what reads back a part that was welded before
 * it was written, triangle for triangle.
 * @param {Float64Array|Float32Array|number[]} triangles
 * @returns {{ positions: Float64Array, tris: Uint32Array, dropped: number }}
 */
export function weld(triangles, { tol = null, exact = false } = {}) {
  const n = Math.floor(triangles.length / 9) * 3;
  if (exact) {
    const seen = new Map();
    const positions = [];
    const tris = new Uint32Array(n);
    for (let v = 0; v < n; v++) {
      const x = triangles[v * 3], y = triangles[v * 3 + 1], z = triangles[v * 3 + 2];
      const key = `${x},${y},${z}`;
      let i = seen.get(key);
      if (i === undefined) {
        i = positions.length / 3;
        seen.set(key, i);
        positions.push(x, y, z);
      }
      tris[v] = i;
    }
    return { positions: Float64Array.from(positions), tris, dropped: 0 };
  }
  const eps = tol ?? Math.max(extent(triangles).diagonal * WELD, Number.MIN_VALUE);
  const cell = 2 * eps;
  // a ball of radius eps reaches at most the 8 cells of size 2·eps round its nearest corner
  const buckets = new Map();
  const hash = (ix, iy, iz) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
  // (at most one vertex a corner, three numbers a vertex)
  let positions = new Float64Array(Math.max(3, n * 3));
  let count = 0;
  const index = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    const x = triangles[v * 3], y = triangles[v * 3 + 1], z = triangles[v * 3 + 2];
    const fx = x / cell, fy = y / cell, fz = z / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const dx = fx - ix < 0.5 ? -1 : 1, dy = fy - iy < 0.5 ? -1 : 1, dz = fz - iz < 0.5 ? -1 : 1;
    let found = -1;
    for (let c = 0; c < 8 && found < 0; c++) {
      const b = buckets.get(hash(ix + (c & 1 ? dx : 0), iy + (c & 2 ? dy : 0), iz + (c & 4 ? dz : 0)));
      if (!b) continue;
      for (const j of b) {
        const ex = positions[j * 3] - x, ey = positions[j * 3 + 1] - y, ez = positions[j * 3 + 2] - z;
        if (ex * ex + ey * ey + ez * ez <= eps * eps) {
          found = j;
          break;
        }
      }
    }
    if (found < 0) {
      found = count++;
      positions[found * 3] = x;
      positions[found * 3 + 1] = y;
      positions[found * 3 + 2] = z;
      const h = hash(ix, iy, iz);
      const b = buckets.get(h);
      if (b) b.push(found);
      else buckets.set(h, [found]);
    }
    index[v] = found;
  }
  const tris = new Uint32Array(n);
  let t = 0;
  for (let i = 0; i < n; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    if (a === b || b === c || c === a) continue;
    tris[t++] = a;
    tris[t++] = b;
    tris[t++] = c;
  }
  return { positions: positions.slice(0, count * 3), tris: tris.slice(0, t), dropped: (n - t) / 3 };
}

/** Each triangle's normal (not unit: its length is twice the triangle's area), 3 numbers a triangle. */
export function areaNormals({ positions, tris }) {
  const out = new Float64Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
    const n = cross(
      positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2],
      positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2],
    );
    out[i] = n[0];
    out[i + 1] = n[1];
    out[i + 2] = n[2];
  }
  return out;
}

/**
 * Which triangle is across each edge. `twin[3t + k]` is the half-edge (3·t′ +
 * k′) sharing triangle t's edge k (from its vertex k to k+1), −1 where the
 * edge is open, −2 where more than two triangles meet on it.
 * @returns {{ twin: Int32Array, open: number, crowded: number }}
 */
export function edgeTwins({ positions, tris }) {
  const V = positions.length / 3;
  const twin = new Int32Array(tris.length).fill(-1);
  const first = new Map();
  let crowded = 0;
  for (let h = 0; h < tris.length; h++) {
    const t = h - (h % 3);
    const a = tris[h], b = tris[t + ((h + 1) % 3)];
    const key = a < b ? a * V + b : b * V + a;
    const other = first.get(key);
    if (other === undefined) first.set(key, h);
    else if (other === -2) {
      twin[h] = -2;
    } else if (twin[other] === -1) {
      twin[other] = h;
      twin[h] = other;
    } else {
      // a third triangle on this edge: nobody is anybody's twin here
      twin[twin[other]] = -2;
      twin[other] = -2;
      twin[h] = -2;
      first.set(key, -2);
      crowded++;
    }
  }
  let open = 0;
  for (let h = 0; h < twin.length; h++) if (twin[h] === -1) open++;
  return { twin, open, crowded };
}

/**
 * Wind every triangle of each connected shell the same way, outward (its
 * volume positive), in place. An exporter that flips some triangles gives a
 * solid all the same.
 * @returns {{ shellOf: Int32Array, shells: { triangles: number, volume: number, area: number, closed: boolean, open: number, crowded: number, flipped: number }[] }}
 *   open: its edges with a face on one side only; crowded: its edges where more than two faces meet (each counted
 *   once a triangle of the shell on it); closed: none of either
 */
export function orient(mesh, { twin }) {
  const { positions, tris } = mesh;
  const T = tris.length / 3;
  const shellOf = new Int32Array(T).fill(-1);
  const shells = [];
  const stack = [];
  const flip = (t) => {
    const i = t * 3;
    // swap vertices 1 and 2: edge 0 (v0→v1) becomes the old edge 2, and back; edge 1 stays
    const v = tris[i + 1];
    tris[i + 1] = tris[i + 2];
    tris[i + 2] = v;
    const h0 = twin[i], h2 = twin[i + 2];
    twin[i] = h2;
    twin[i + 2] = h0;
    if (h2 >= 0) twin[h2] = i;
    if (h0 >= 0) twin[h0] = i + 2;
  };
  for (let seed = 0; seed < T; seed++) {
    if (shellOf[seed] >= 0) continue;
    const s = shells.length;
    const members = [];
    let flipped = 0, open = 0, crowded = 0;
    shellOf[seed] = s;
    stack.push(seed);
    while (stack.length) {
      const t = stack.pop();
      members.push(t);
      for (let k = 0; k < 3; k++) {
        const h = twin[t * 3 + k];
        if (h < 0) {
          if (h === -1) open++;
          else crowded++;
          continue;
        }
        const u = Math.floor(h / 3);
        if (shellOf[u] >= 0) continue;
        // neighbours wound alike run their shared edge in opposite directions
        if (tris[h] === tris[t * 3 + k]) {
          flip(u);
          flipped++;
        }
        shellOf[u] = s;
        stack.push(u);
      }
    }
    let volume = 0, area = 0;
    const measure = () => {
      volume = 0;
      area = 0;
      for (const t of members) {
        const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
        const n = cross(
          positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2],
          positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2],
        );
        area += Math.hypot(n[0], n[1], n[2]) / 2;
        volume += (positions[a] * n[0] + positions[a + 1] * n[1] + positions[a + 2] * n[2]) / 6;
      }
    };
    measure();
    if (volume < 0) {
      for (const t of members) flip(t);
      flipped = members.length - flipped;
      volume = -volume;
    }
    shells.push({ triangles: members.length, volume, area, closed: open === 0 && crowded === 0, open, crowded, flipped });
  }
  return { shellOf, shells };
}

/** Just one shell's triangles, as their own mesh (vertices it doesn't use dropped). */
export function shellMesh({ positions, tris }, shellOf, shell) {
  const map = new Int32Array(positions.length / 3).fill(-1);
  const outTris = [];
  const outPos = [];
  for (let t = 0; t < shellOf.length; t++) {
    if (shellOf[t] !== shell) continue;
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k];
      if (map[v] < 0) {
        map[v] = outPos.length / 3;
        outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      }
      outTris.push(map[v]);
    }
  }
  return { positions: Float64Array.from(outPos), tris: Uint32Array.from(outTris) };
}

class Sets {
  constructor(n) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i) {
    const p = this.parent;
    while (p[i] !== i) {
      p[i] = p[p[i]];
      i = p[i];
    }
    return i;
  }
  join(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.parent[b] = a;
    return a;
  }
}

/**
 * Split a welded, wound mesh into faces (the rule at the top of this file).
 * @returns {{ faceOf: Uint32Array, faces: Face[] }}
 * @typedef {{ id: number, triangles: number, area: number, centroid: number[], normal: number[], at: number[], atNormal: number[],
 *   flat: boolean, box: { min: number[], max: number[] }, radius: number|null }} Face
 *   `normal`: the area-weighted mean, unit (a closed face like a whole sphere has none: [0, 0, 0]).
 *   `at`, `atNormal`: a point on the face (its centroid needn't be: a tube's is on its axis) and the outward direction there.
 *   `radius`: of the cylinder a curved face wraps (a hole's wall, a shaft, a fillet), where it is one; else null.
 */
export function splitFaces(mesh, { twin }, { sharpDeg = SHARP_DEG, broadRatio = BROAD_RATIO } = {}) {
  const { positions, tris } = mesh;
  const T = tris.length / 3;
  const N = areaNormals(mesh);
  const area = new Float64Array(T);
  for (let t = 0; t < T; t++) area[t] = Math.hypot(N[t * 3], N[t * 3 + 1], N[t * 3 + 2]) / 2;
  const diag = extent(positions).diagonal;
  const cosFlat = Math.cos((FLAT_DEG * Math.PI) / 180);
  const cosSharp = Math.cos((sharpDeg * Math.PI) / 180);
  const offset = diag * FLAT_OFFSET;
  const unit = (t) => {
    const l = 2 * area[t] || 1;
    return [N[t * 3] / l, N[t * 3 + 1] / l, N[t * 3 + 2] / l];
  };

  // 1. flats, grown from the largest triangle outward against its plane
  const flatOf = new Int32Array(T).fill(-1);
  const order = Array.from({ length: T }, (_, t) => t).sort((a, b) => area[b] - area[a] || a - b);
  const flatArea = [];
  const stack = [];
  for (const seed of order) {
    if (flatOf[seed] >= 0) continue;
    const f = flatArea.length;
    const n = unit(seed);
    const p = tris[seed * 3] * 3;
    const d = n[0] * positions[p] + n[1] * positions[p + 1] + n[2] * positions[p + 2];
    let sum = 0;
    flatOf[seed] = f;
    stack.push(seed);
    while (stack.length) {
      const t = stack.pop();
      sum += area[t];
      for (let k = 0; k < 3; k++) {
        const h = twin[t * 3 + k];
        if (h < 0) continue;
        const u = Math.floor(h / 3);
        if (flatOf[u] >= 0) continue;
        const m = unit(u);
        if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < cosFlat) continue;
        let on = true;
        for (let j = 0; j < 3 && on; j++) {
          const q = tris[u * 3 + j] * 3;
          on = Math.abs(n[0] * positions[q] + n[1] * positions[q + 1] + n[2] * positions[q + 2] - d) <= offset;
        }
        if (!on) continue;
        flatOf[u] = f;
        stack.push(u);
      }
    }
    flatArea.push(sum);
  }

  // 2. join flats that meet smoothly, unless one is broad beside the other
  const sets = new Sets(flatArea.length);
  for (let h = 0; h < twin.length; h++) {
    const g = twin[h];
    if (g <= h) continue; // each pair once; open and crowded edges join nothing
    const t = Math.floor(h / 3), u = Math.floor(g / 3);
    const a = flatOf[t], b = flatOf[u];
    if (a === b) continue;
    const n = unit(t), m = unit(u);
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < cosSharp) continue;
    const big = Math.max(flatArea[a], flatArea[b]), small = Math.min(flatArea[a], flatArea[b]);
    if (big > broadRatio * small) continue;
    sets.join(a, b);
  }

  // 3. measure each face, and number them by where they are
  const byRoot = new Map();
  const raw = [];
  const rawOf = new Int32Array(T);
  for (let t = 0; t < T; t++) {
    const root = sets.find(flatOf[t]);
    let i = byRoot.get(root);
    if (i === undefined) {
      i = raw.length;
      byRoot.set(root, i);
      raw.push({ triangles: 0, area: 0, c: [0, 0, 0], n: [0, 0, 0], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], flats: new Set(), biggest: -1 });
    }
    rawOf[t] = i;
    const f = raw[i];
    f.triangles++;
    f.area += area[t];
    f.flats.add(flatOf[t]);
    if (f.biggest < 0 || area[t] > area[f.biggest]) f.biggest = t;
    for (let k = 0; k < 3; k++) f.n[k] += N[t * 3 + k] / 2;
    for (let j = 0; j < 3; j++) {
      const q = tris[t * 3 + j] * 3;
      for (let k = 0; k < 3; k++) {
        const v = positions[q + k];
        f.c[k] += (area[t] * v) / 3;
        if (v < f.min[k]) f.min[k] = v;
        if (v > f.max[k]) f.max[k] = v;
      }
    }
  }
  const round = (v) => Math.round(v / (diag * 1e-6 || 1));
  const sorted = raw
    .map((f, i) => ({ f, i, c: f.c.map((v) => v / (f.area || 1)) }))
    .sort((a, b) => round(a.c[0]) - round(b.c[0]) || round(a.c[1]) - round(b.c[1]) || round(a.c[2]) - round(b.c[2]) || b.f.area - a.f.area || a.i - b.i);
  const idOf = new Int32Array(raw.length);
  sorted.forEach((s, id) => (idOf[s.i] = id));
  const faceOf = new Uint32Array(T);
  for (let t = 0; t < T; t++) faceOf[t] = idOf[rawOf[t]];
  const faces = sorted.map(({ f, c }, id) => {
    const len = Math.hypot(f.n[0], f.n[1], f.n[2]);
    // the mean normal of a patch that closes on itself (a whole sphere, a tube) is short or nothing
    const normal = len > f.area * 1e-6 ? f.n.map((v) => v / len) : [0, 0, 0];
    // a point that is on the face whatever its shape, and the way the face points there: its largest triangle's middle
    const b = f.biggest * 3;
    const at = [0, 1, 2].map((k) => (positions[tris[b] * 3 + k] + positions[tris[b + 1] * 3 + k] + positions[tris[b + 2] * 3 + k]) / 3);
    return { id, triangles: f.triangles, area: f.area, centroid: c, normal, at, atNormal: unit(f.biggest), flat: f.flats.size === 1, box: { min: f.min, max: f.max }, radius: null };
  });
  for (const face of faces) face.radius = roundRadius(mesh, N, area, faceOf, face);
  return { faceOf, faces };
}

/**
 * The radius of the cylinder a curved face wraps, where it is one: its
 * normals all square to one axis, its points all one distance from it. Null
 * for anything else.
 */
function roundRadius({ positions, tris }, N, area, faceOf, face) {
  const pts = [];
  const seen = new Set();
  const ns = [];
  for (let t = 0; t < faceOf.length; t++) {
    if (faceOf[t] !== face.id) continue;
    const l = 2 * area[t] || 1;
    ns.push([N[t * 3] / l, N[t * 3 + 1] / l, N[t * 3 + 2] / l, area[t]]);
    for (let j = 0; j < 3; j++) {
      const v = tris[t * 3 + j];
      if (seen.has(v)) continue;
      seen.add(v);
      pts.push([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    }
  }
  if (face.flat || ns.length < 6) return null;
  // the axis: the direction every normal is square to — the smallest eigenvector of Σ a·n nᵀ
  const M = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
  for (const [x, y, z, a] of ns) {
    M[0] += a * x * x;
    M[1] += a * x * y;
    M[2] += a * x * z;
    M[3] += a * y * y;
    M[4] += a * y * z;
    M[5] += a * z * z;
  }
  const axis = smallestEigenvector(M);
  if (!axis) return null;
  let worst = 0;
  for (const [x, y, z] of ns) worst = Math.max(worst, Math.abs(x * axis[0] + y * axis[1] + z * axis[2]));
  if (worst > 0.05) return null;
  // distance of each point from the axis through the points' mean: equal on a cylinder
  // (a part of one: the mean isn't on the axis, so fit the centre in the plane across it)
  const u = Math.abs(axis[0]) < 0.9 ? cross(axis[0], axis[1], axis[2], 1, 0, 0) : cross(axis[0], axis[1], axis[2], 0, 1, 0);
  const ul = Math.hypot(...u);
  const e1 = u.map((v) => v / ul);
  const e2 = cross(axis[0], axis[1], axis[2], e1[0], e1[1], e1[2]);
  // circle fit (Kåsa): x² + y² = 2a x + 2b y + c
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sxz = 0, Syz = 0, Sz = 0;
  const xy = pts.map((p) => [p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2], p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]]);
  const n = xy.length;
  const mx = xy.reduce((s, p) => s + p[0], 0) / n, my = xy.reduce((s, p) => s + p[1], 0) / n;
  for (const [X, Y] of xy) {
    const x = X - mx, y = Y - my, z = x * x + y * y;
    Sxx += x * x;
    Sxy += x * y;
    Syy += y * y;
    Sx += x;
    Sy += y;
    Sxz += x * z;
    Syz += y * z;
    Sz += z;
  }
  const det = Sxx * Syy - Sxy * Sxy;
  if (Math.abs(det) < 1e-30) return null;
  const a = (Sxz * Syy - Syz * Sxy) / (2 * det), b = (Syz * Sxx - Sxz * Sxy) / (2 * det);
  const r = Math.sqrt(a * a + b * b + Sz / n);
  if (!(r > 0)) return null;
  for (const [X, Y] of xy) if (Math.abs(Math.hypot(X - mx - a, Y - my - b) - r) > 0.02 * r) return null;
  return r;
}

/** The unit eigenvector of a symmetric 3×3 (xx xy xz yy yz zz) with the smallest eigenvalue, by Jacobi rotations. */
function smallestEigenvector([xx, xy, xz, yy, yz, zz]) {
  const A = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      off += A[p][q] * A[p][q];
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq;
        A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk;
        A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
    if (off < 1e-24 * (xx * xx + yy * yy + zz * zz + 1e-300)) break;
  }
  let best = 0;
  for (let k = 1; k < 3; k++) if (A[k][k] < A[best][best]) best = k;
  const v = [V[0][best], V[1][best], V[2][best]];
  const l = Math.hypot(...v);
  return l > 0 ? v.map((x) => x / l) : null;
}

/**
 * A part, from triangle soup: welded, wound, its largest closed shell taken
 * as the solid, and that split into faces.
 *
 * @param {Float64Array|Float32Array|number[]} triangles  9 numbers a triangle
 * @returns {{
 *   positions: Float64Array, tris: Uint32Array, faceOf: Uint32Array, faces: Face[],
 *   volume: number, area: number, box: { min: number[], max: number[] }, diagonal: number,
 *   solid: boolean, problems: string[], notes: string[] }}
 *   `solid`: one closed shell with room inside, so it can be meshed. `problems` say why not, in words a person can act on; `notes` say what was put right or left out.
 */
export function readPart(triangles, opts = {}) {
  const problems = [];
  const notes = [];
  // at the precision a part is kept at (Float32, src/part/kept.js), so what is kept is exactly what was split
  const welded = weld(Float32Array.from(triangles));
  if (!welded.tris.length) {
    return { positions: new Float64Array(0), tris: new Uint32Array(0), faceOf: new Uint32Array(0), faces: [], volume: 0, area: 0, box: { min: [0, 0, 0], max: [0, 0, 0] }, diagonal: 0, solid: false, problems: ["it has no surface: no triangles"], notes };
  }
  if (welded.dropped) notes.push(`${welded.dropped} triangle${welded.dropped === 1 ? "" : "s"} with no area left out`);
  const topo = edgeTwins(welded);
  const { shellOf, shells } = orient(welded, topo);
  // the solid: the closed shell holding the most, else (none closed) the largest by area
  const closed = shells.map((s, i) => ({ ...s, i })).filter((s) => s.closed);
  const pick = closed.length ? closed.sort((a, b) => b.volume - a.volume)[0].i : shells.map((s, i) => ({ ...s, i })).sort((a, b) => b.area - a.area)[0].i;
  const shell = shells[pick];
  const flipped = shell.flipped;
  if (flipped) notes.push(`${flipped} triangle${flipped === 1 ? " was" : "s were"} wound backwards and turned`);
  if (shells.length > 1) {
    const others = shells.length - 1;
    notes.push(`it is ${shells.length} separate pieces: the largest is analysed, ${others === 1 ? "the other is" : `the other ${others} are`} left out`);
  }
  const mesh = shells.length > 1 ? shellMesh(welded, shellOf, pick) : welded;
  const twins = shells.length > 1 ? edgeTwins(mesh) : topo;
  if (!shell.closed) {
    problems.push(
      shell.crowded
        ? `its surface isn't a simple closed skin: more than two faces meet along ${topo.crowded} edge${topo.crowded === 1 ? "" : "s"}`
        : `its surface isn't closed: ${shell.open} edge${shell.open === 1 ? " has" : "s have"} a face on one side only`,
    );
  } else if (!(shell.volume > 0)) problems.push("it has no volume");
  const { faceOf, faces } = splitFaces(mesh, twins, opts);
  const box = extent(mesh.positions);
  return {
    positions: mesh.positions,
    tris: mesh.tris,
    faceOf,
    faces,
    volume: shell.closed ? shell.volume : 0,
    area: shell.area,
    box: { min: box.min, max: box.max },
    diagonal: box.diagonal,
    solid: problems.length === 0,
    problems,
    notes,
  };
}

/** A part's triangles as soup again (9 numbers a triangle), for writing an STL or handing to a drawing. */
export function soup({ positions, tris }) {
  const out = new Float64Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i] * 3;
    out[i * 3] = positions[v];
    out[i * 3 + 1] = positions[v + 1];
    out[i * 3 + 2] = positions[v + 2];
  }
  return out;
}

/** What a face is, in words, for a list and for an agent: "flat, 40 × 20 mm, facing +x". */
export function describeFace(face, lengthText) {
  const size = [0, 1, 2].map((k) => face.box.max[k] - face.box.min[k]).sort((a, b) => b - a);
  const dims = `${lengthText(size[0])} × ${lengthText(size[1])}`;
  const facing = facingWord(face.normal);
  if (face.flat) return `flat, ${dims}${facing ? `, facing ${facing}` : ""}`;
  if (face.radius) return `round, radius ${lengthText(face.radius)}, ${dims}${facing ? `, facing ${facing}` : ""}`;
  return `curved, ${dims}${facing ? `, facing ${facing}` : ""}`;
}

/** "+x", "−y", … for a direction within 10° of an axis; else "" . */
export function facingWord(n) {
  const names = ["x", "y", "z"];
  for (let k = 0; k < 3; k++) if (Math.abs(n[k]) > 0.985) return `${n[k] > 0 ? "+" : "−"}${names[k]}`;
  return "";
}
