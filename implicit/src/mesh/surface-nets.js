// Naive surface nets over a signed distance field, streamed a slab at a time.
//
// The field is sampled on a regular grid one z-layer at a time, so memory is
// O(nx·ny) rather than O(n³) — a 256³ mesh needs two sample layers and two
// cell layers, not 17 million samples. Each cell the surface passes through
// gets one vertex, placed at the average of its edge crossings; each grid edge
// with a sign change emits a quad joining the four cells around it, wound so
// the face normal points out (towards positive distance).
//
// The field is clipped to the bounds box (max(sdf, box)), and the grid is one
// cell larger than the bounds on every side, so the mesh is always closed:
// infinite things like gyroid() or plane() are capped where the bounds cut them.
//
// All of this is pure and DOM-free; it runs in the mesh worker or, as a
// fallback, on the main thread a layer at a time (it is a generator).

/**
 * The sampling grid for a bounds box at a resolution (cells across the longest side).
 * @returns {{ origin: number[], h: number, nx: number, ny: number, nz: number }}
 */
export function gridFor(bounds, resolution) {
  const res = Math.max(2, Math.floor(resolution));
  const ext = [0, 1, 2].map((a) => bounds.max[a] - bounds.min[a]);
  const h = Math.max(...ext) / res;
  const n = ext.map((e) => Math.max(1, Math.ceil(e / h - 1e-9)) + 2); // +1 cell of margin each side
  const origin = [0, 1, 2].map((a) => (bounds.min[a] + bounds.max[a]) / 2 - (n[a] * h) / 2);
  return { origin, h, nx: n[0], ny: n[1], nz: n[2] };
}

/**
 * A batch sampler for the field clipped to the bounds box.
 * @param {{ batch(xs, ys, zs, out, n): any }} evaluator
 */
export function clippedSampler(evaluator, bounds) {
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const hx = (bounds.max[0] - bounds.min[0]) / 2;
  const hy = (bounds.max[1] - bounds.min[1]) / 2;
  const hz = (bounds.max[2] - bounds.min[2]) / 2;
  return (xs, ys, zs, out, n) => {
    evaluator.batch(xs, ys, zs, out, n);
    const zConst = typeof zs === "number";
    for (let j = 0; j < n; j++) {
      const qx = Math.abs(xs[j] - cx) - hx;
      const qy = Math.abs(ys[j] - cy) - hy;
      const qz = Math.abs((zConst ? zs : zs[j]) - cz) - hz;
      const ox = qx > 0 ? qx : 0;
      const oy = qy > 0 ? qy : 0;
      const oz = qz > 0 ? qz : 0;
      const m = qx > qy ? (qx > qz ? qx : qz) : qy > qz ? qy : qz;
      const box = Math.sqrt(ox * ox + oy * oy + oz * oz) + (m < 0 ? m : 0);
      const v = out[j];
      // NaN counts as outside, so a broken region leaves a hole rather than garbage
      out[j] = v !== v ? (box > 1 ? box : 1) : v > box ? v : box;
    }
    return out;
  };
}

class GrowF32 {
  constructor(cap = 1024) {
    this.a = new Float32Array(cap);
    this.n = 0;
  }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) this.#grow();
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  #grow() {
    const b = new Float32Array(this.a.length * 2);
    b.set(this.a);
    this.a = b;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}
class GrowU32 {
  constructor(cap = 1024) {
    this.a = new Uint32Array(cap);
    this.n = 0;
  }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

// the 12 cell edges as corner pairs; corner c = bit0 x, bit1 y, bit2 z
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/**
 * Mesh the zero level set. A generator: yields { layer, of } after each cell
 * layer and returns { positions, indices, grid }.
 *
 * @param {(xs, ys, zs, out, n) => any} sample  batch field sampler (see clippedSampler)
 * @param {{ origin: number[], h: number, nx: number, ny: number, nz: number }} grid
 */
export function* surfaceNets(sample, grid) {
  const { origin, h, nx, ny, nz } = grid;
  const sx = nx + 1;
  const sy = ny + 1;
  const L = sx * sy; // samples per layer
  const xs = new Float64Array(L);
  const ys = new Float64Array(L);
  for (let j = 0; j < sy; j++) {
    for (let i = 0; i < sx; i++) {
      xs[i + j * sx] = origin[0] + i * h;
      ys[i + j * sx] = origin[1] + j * h;
    }
  }
  let S0 = new Float64Array(L);
  let S1 = new Float64Array(L);
  sample(xs, ys, origin[2], S0, L);

  const C = nx * ny; // cells per layer
  let prev = new Int32Array(C).fill(-1);
  let cur = new Int32Array(C).fill(-1);
  const pos = new GrowF32(4096);
  const idx = new GrowU32(8192);
  const v = new Float64Array(8);

  const quad = (a, b, c, d, flip) => {
    if (flip) {
      const t = b;
      b = d;
      d = t;
    }
    // split along the shorter diagonal
    const P = pos.a;
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (dac <= dbd) {
      idx.push3(a, b, c);
      idx.push3(a, c, d);
    } else {
      idx.push3(a, b, d);
      idx.push3(b, c, d);
    }
  };

  for (let k = 0; k < nz; k++) {
    sample(xs, ys, origin[2] + (k + 1) * h, S1, L);
    const z0 = origin[2] + k * h;

    // 1. one vertex per cell the surface crosses
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const s = i + j * sx;
        v[0] = S0[s];
        v[1] = S0[s + 1];
        v[2] = S0[s + sx];
        v[3] = S0[s + sx + 1];
        v[4] = S1[s];
        v[5] = S1[s + 1];
        v[6] = S1[s + sx];
        v[7] = S1[s + sx + 1];
        let mask = 0;
        for (let c = 0; c < 8; c++) if (v[c] < 0) mask |= 1 << c;
        const cell = i + j * nx;
        if (mask === 0 || mask === 255) {
          cur[cell] = -1;
          continue;
        }
        let ax = 0;
        let ay = 0;
        let az = 0;
        let count = 0;
        for (let e = 0; e < 12; e++) {
          const [c0, c1] = EDGES[e];
          const in0 = (mask >> c0) & 1;
          const in1 = (mask >> c1) & 1;
          if (in0 === in1) continue;
          const d = v[c0] - v[c1];
          const t = d === 0 ? 0.5 : v[c0] / d;
          ax += (c0 & 1) + t * ((c1 & 1) - (c0 & 1));
          ay += ((c0 >> 1) & 1) + t * (((c1 >> 1) & 1) - ((c0 >> 1) & 1));
          az += ((c0 >> 2) & 1) + t * (((c1 >> 2) & 1) - ((c0 >> 2) & 1));
          count++;
        }
        cur[cell] = pos.n / 3;
        pos.push3(origin[0] + (i + ax / count) * h, origin[1] + (j + ay / count) * h, z0 + (az / count) * h);
      }
    }

    // 2. a quad for each sign-changing edge leaving this layer's corners
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const s = i + j * sx;
        const a0 = S0[s];
        const inside = a0 < 0;
        const cell = i + j * nx;
        // +x edge on the k face: cells (i,j,k) (i,j-1,k) (i,j-1,k-1) (i,j,k-1)
        if (k > 0 && j > 0 && inside !== S0[s + 1] < 0) {
          quad(cur[cell], cur[cell - nx], prev[cell - nx], prev[cell], !inside);
        }
        // +y edge on the k face: cells (i,j,k) (i-1,j,k) (i-1,j,k-1) (i,j,k-1)
        if (k > 0 && i > 0 && inside !== S0[s + sx] < 0) {
          quad(cur[cell], cur[cell - 1], prev[cell - 1], prev[cell], inside);
        }
        // +z edge between the layers: cells (i,j) (i-1,j) (i-1,j-1) (i,j-1)
        if (i > 0 && j > 0 && inside !== S1[s] < 0) {
          quad(cur[cell], cur[cell - 1], cur[cell - 1 - nx], cur[cell - nx], !inside);
        }
      }
    }

    [S0, S1] = [S1, S0];
    [prev, cur] = [cur, prev];
    yield { layer: k + 1, of: nz };
  }
  return { positions: pos.done(), indices: idx.done(), grid };
}

/**
 * Per-vertex SDF gradient (normalised) and mean curvature, by central
 * differences with step `e`. Seven samples per vertex, batched. Synchronous;
 * see fieldNormalsSteps for the version that yields between blocks.
 * @returns {{ normals: Float32Array, curvature: Float32Array }}
 */
export function fieldNormals(sample, positions, e) {
  return drain(fieldNormalsSteps(sample, positions, e));
}

/**
 * fieldNormals as a generator: yields { vertex, of } after each block of
 * vertices so a main-thread caller can hand control back to the page.
 */
export function* fieldNormalsSteps(sample, positions, e) {
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const curvature = new Float32Array(count);
  const BLOCK = 4096;
  const n7 = BLOCK * 7;
  const xs = new Float64Array(n7);
  const ys = new Float64Array(n7);
  const zs = new Float64Array(n7);
  const out = new Float64Array(n7);
  const OFF = [
    [0, 0, 0],
    [e, 0, 0],
    [-e, 0, 0],
    [0, e, 0],
    [0, -e, 0],
    [0, 0, e],
    [0, 0, -e],
  ];
  for (let base = 0; base < count; base += BLOCK) {
    const m = Math.min(BLOCK, count - base);
    for (let q = 0; q < m; q++) {
      const px = positions[(base + q) * 3];
      const py = positions[(base + q) * 3 + 1];
      const pz = positions[(base + q) * 3 + 2];
      for (let o = 0; o < 7; o++) {
        xs[q * 7 + o] = px + OFF[o][0];
        ys[q * 7 + o] = py + OFF[o][1];
        zs[q * 7 + o] = pz + OFF[o][2];
      }
    }
    sample(xs, ys, zs, out, m * 7);
    for (let q = 0; q < m; q++) {
      const f = out.subarray(q * 7, q * 7 + 7);
      const gx = f[1] - f[2];
      const gy = f[3] - f[4];
      const gz = f[5] - f[6];
      const len = Math.hypot(gx, gy, gz);
      const vi = base + q;
      if (len > 0 && Number.isFinite(len)) {
        normals[vi * 3] = gx / len;
        normals[vi * 3 + 1] = gy / len;
        normals[vi * 3 + 2] = gz / len;
        // mean curvature of the level set ≈ ∇²f / (2|∇f|); |∇f| = len / 2e
        const lap = (f[1] + f[2] + f[3] + f[4] + f[5] + f[6] - 6 * f[0]) / (e * e);
        const H = lap / (2 * (len / (2 * e)));
        curvature[vi] = Number.isFinite(H) ? H : 0;
      } else {
        normals[vi * 3 + 1] = 1;
      }
    }
    yield { vertex: base + m, of: count };
  }
  return { normals, curvature };
}

/** Run a generator to completion synchronously, returning its value. */
export function drain(gen) {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}
