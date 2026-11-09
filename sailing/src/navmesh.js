// The navmesh: where a body can stand on a hull, baked once in her body
// frame (DESIGN.md, "Walking: a navmesh in the ship's frame"). Pure: no
// THREE, no rays, no scene. Triangles in, typed arrays out.
//
// The plan (x, z) is cut into columns c × c. Rasterising the triangles into
// a column gives its intervals (the y-ranges where anything is); an
// interval's top that passes the bake is a cell, the mesh's face. Every side
// of every cell carries exactly one record:
// - STEP to the cell beside it (walk across);
// - WALL with a rise, a gap and where a jump that high comes down (a cell,
//   OVERBOARD or NONE);
// - OPEN: walking on goes into the water at `exit`.
// The walker (walker.js) moves over this; nothing it does asks the geometry
// again. navcheck.js checks a baked mesh against the triangles it came from.

export const STEP = 0;
export const WALL = 1;
export const OPEN = 2;
/** A side's `to` when it leads into the water. */
export const OVERBOARD = -1;
/** A side's `to` when nothing gets across. */
export const NONE = -2;

/** The four sides of a cell, directed out of it: −X, +X, −Z, +Z. The opposite of side s is s ^ 1. */
export const DIRS = Object.freeze([Object.freeze([-1, 0]), Object.freeze([1, 0]), Object.freeze([0, -1]), Object.freeze([0, 1])]);

/** The sloop's bake parameters (DESIGN.md's table). walk.js's DECK carries the same. */
export const NAV = Object.freeze({
  cell: 0.05,
  slope: 35, // degrees
  step: 0.58,
  height: 1.75,
  radius: 0.25,
  march: 1.5,
  jump: 4.6,
  gravity: 16,
});

const EPS = 1e-9;
/** A fit higher than this over the deck beside it is no fit at all. */
const FIT_CAP = 3;
/** Where the floor and its intervals are compared, a hair of slack for rounding. */
const TOL = 1e-7;

/** How high a jump goes. */
export const apexOf = (p) => (p.jump * p.jump) / (2 * p.gravity);

/** The bake's own parameters out of anything shaped like NAV or DECK. */
export function navParams(p = {}) {
  const out = {};
  for (const k of Object.keys(NAV)) out[k] = Number.isFinite(p[k]) ? p[k] : NAV[k];
  return Object.freeze(out);
}

// ─── small geometry ─────────────────────────────────────────────────────────

/**
 * A polygon (n points, xyz, in `src`) clipped to lo ≤ v ≤ hi along one axis (0 x, 2 z), inclusive,
 * into `dst`: the number of points out.
 */
function clipAxis(src, n, dst, axis, lo, hi) {
  let a = src;
  let m = n;
  const tmp = CLIP_TMP;
  for (let pass = 0; pass < 2 && m > 0; pass++) {
    const lim = pass === 0 ? lo - EPS : hi + EPS;
    const out = pass === 0 ? tmp : dst;
    let k = 0;
    for (let p = 0; p < m; p++) {
      const s = ((p + m - 1) % m) * 3;
      const e = p * 3;
      const sv = a[s + axis];
      const ev = a[e + axis];
      const sIn = pass === 0 ? sv >= lim : sv <= lim;
      const eIn = pass === 0 ? ev >= lim : ev <= lim;
      if (eIn !== sIn) {
        const t = (lim - sv) / (ev - sv);
        out[k * 3] = a[s] + (a[e] - a[s]) * t;
        out[k * 3 + 1] = a[s + 1] + (a[e + 1] - a[s + 1]) * t;
        out[k * 3 + 2] = a[s + 2] + (a[e + 2] - a[s + 2]) * t;
        out[k * 3 + axis] = lim;
        k++;
      }
      if (eIn) {
        out[k * 3] = a[e];
        out[k * 3 + 1] = a[e + 1];
        out[k * 3 + 2] = a[e + 2];
        k++;
      }
    }
    a = out;
    m = k;
  }
  if (m > 0 && a !== dst) dst.set(a.subarray(0, m * 3));
  return m;
}
const CLIP_TMP = new Float64Array(30);
const TRI = new Float64Array(9);
const STRIP = new Float64Array(30);
const PIECE = new Float64Array(30);

/** Offsets (di, dk) of the columns whose square meets a disc of radius `R` about a column's centre. */
export function discOffsets(R, c) {
  const K = Math.ceil(R / c + 0.5);
  const out = [];
  for (let dk = -K; dk <= K; dk++) {
    for (let di = -K; di <= K; di++) {
      const ex = Math.max(0, Math.abs(di) * c - c / 2);
      const ez = Math.max(0, Math.abs(dk) * c - c / 2);
      if (Math.hypot(ex, ez) <= R + EPS) out.push(di, dk);
    }
  }
  return { K, list: Int32Array.from(out) };
}

// ─── the bake ───────────────────────────────────────────────────────────────

/**
 * Bake a navmesh.
 * @param {{ triangles: ArrayLike<number>, seeds?: Array<{ kind: string, id?: string, at: number[], yaw?: number, hook?: number[] }>, key?: string }} input
 *   triangles: 9 numbers each, in her body frame (metres, +Y up). seeds: where people must be able to stand
 *   (spawn, each station's stand spot, the ladder's top with its `hook`, where it hangs). With no seeds, every
 *   component is kept (a fixture).
 * @param {object} [params]  NAV or anything shaped like it
 */
export function bake(input, params = NAV) {
  const P = navParams(params);
  const clock = globalThis.performance ?? Date;
  const timing = {};
  let tmark = clock.now();
  const mark = (name) => {
    const t = clock.now();
    timing[name] = +(t - tmark).toFixed(2);
    tmark = t;
  };
  const c = P.cell;
  const H = P.height;
  const step = P.step;
  const R = P.radius + c * Math.SQRT1_2;
  const cosSlope = Math.cos((P.slope * Math.PI) / 180);
  const src = input?.triangles ?? [];
  const nt = Math.floor(src.length / 9);
  const T = new Float64Array(nt * 9);
  for (let k = 0; k < nt * 9; k++) T[k] = Number(src[k]);

  // the grid: aligned to multiples of c, padded so the water round her is on it
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (let k = 0; k < nt * 9; k += 3) {
    if (!Number.isFinite(T[k]) || !Number.isFinite(T[k + 1]) || !Number.isFinite(T[k + 2])) continue;
    minx = Math.min(minx, T[k]);
    maxx = Math.max(maxx, T[k]);
    minz = Math.min(minz, T[k + 2]);
    maxz = Math.max(maxz, T[k + 2]);
  }
  if (!(minx <= maxx)) minx = maxx = minz = maxz = 0;
  const pad = Math.ceil(R / c) + 3;
  const I0 = Math.floor(minx / c) - pad;
  const K0 = Math.floor(minz / c) - pad;
  const nx = Math.floor(maxx / c) + pad - I0 + 1;
  const nz = Math.floor(maxz / c) + pad - K0 + 1;
  const ncol = nx * nz;
  const X = (i) => (I0 + i) * c;
  const Z = (k) => (K0 + k) * c;

  // 1. rasterise: per column, [ymin, ymax, triangle, walkable] for each triangle in its closed square
  const raw = new Array(ncol);
  const planes = new Float64Array(nt * 4); // walkable: [y0 at origin, gx, gz, 1]
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    let ok = true;
    for (let k = 0; k < 9; k++) if (!Number.isFinite(T[o + k])) ok = false;
    if (!ok) continue;
    const ux = T[o + 3] - T[o];
    const uy = T[o + 4] - T[o + 1];
    const uz = T[o + 5] - T[o + 2];
    const vx = T[o + 6] - T[o];
    const vy = T[o + 7] - T[o + 1];
    const vz = T[o + 8] - T[o + 2];
    const nX = uy * vz - uz * vy;
    const nY = uz * vx - ux * vz;
    const nZ = ux * vy - uy * vx;
    const nl = Math.hypot(nX, nY, nZ);
    const walk = nl > 0 && Math.abs(nY) / nl >= cosSlope;
    if (walk) {
      const gx = -nX / nY + 0; // (+ 0: never −0, whichever way the triangle winds)
      const gz = -nZ / nY + 0;
      planes[t * 4] = T[o + 1] - gx * T[o] - gz * T[o + 2];
      planes[t * 4 + 1] = gx;
      planes[t * 4 + 2] = gz;
      planes[t * 4 + 3] = 1;
    }
    const tx0 = Math.min(T[o], T[o + 3], T[o + 6]);
    const tx1 = Math.max(T[o], T[o + 3], T[o + 6]);
    const tz0 = Math.min(T[o + 2], T[o + 5], T[o + 8]);
    const tz1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
    // the closed squares the bounds touch (a bound on a column line touches both columns)
    const ia = Math.max(0, Math.floor((tx0 - EPS) / c) - I0);
    const ib = Math.min(nx - 1, Math.floor((tx1 + EPS) / c) - I0);
    const ka = Math.max(0, Math.floor((tz0 - EPS) / c) - K0);
    const kb = Math.min(nz - 1, Math.floor((tz1 + EPS) / c) - K0);
    const ty0 = Math.min(T[o + 1], T[o + 4], T[o + 7]);
    const ty1 = Math.max(T[o + 1], T[o + 4], T[o + 7]);
    if (ia === ib && ka === kb) {
      // inside one column: its own y-range
      (raw[ka * nx + ia] ??= []).push(ty0, ty1, t, walk ? 1 : 0);
      continue;
    }
    // clipped to each row's strip once, then the strip to each column in it
    for (let v = 0; v < 9; v++) TRI[v] = T[o + v];
    for (let k = ka; k <= kb; k++) {
      const ns = clipAxis(TRI, 3, STRIP, 2, Z(k), Z(k + 1));
      if (!ns) continue;
      let sx0 = Infinity;
      let sx1 = -Infinity;
      for (let p = 0; p < ns; p++) {
        sx0 = Math.min(sx0, STRIP[p * 3]);
        sx1 = Math.max(sx1, STRIP[p * 3]);
      }
      const i0 = Math.max(ia, Math.floor((sx0 - EPS) / c) - I0);
      const i1 = Math.min(ib, Math.floor((sx1 + EPS) / c) - I0);
      for (let i = i0; i <= i1; i++) {
        const np = clipAxis(STRIP, ns, PIECE, 0, X(i), X(i + 1));
        if (!np) continue;
        let lo = Infinity;
        let hi = -Infinity;
        for (let p = 0; p < np; p++) {
          const y = PIECE[p * 3 + 1];
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
        (raw[k * nx + i] ??= []).push(lo, hi, t, walk ? 1 : 0);
      }
    }
  }

  mark("rasterise");
  // merge each column's ranges into intervals (overlapping, or closer than H − step: a gap no
  // body can use is solid), and find each interval's floor (rules a and b)
  const ivStart = new Int32Array(ncol + 1);
  const ivLo = [];
  const ivHi = [];
  const ivFloor = []; // floor index or -1
  // floors (pre-headroom)
  const F = { col: [], iv: [], top: [], ceil: [], yc: [], gx: [], gz: [], lo: [], hi: [] };
  const order = [];
  for (let col = 0; col < ncol; col++) {
    ivStart[col] = ivLo.length;
    const r = raw[col];
    if (!r) continue;
    const n = r.length / 4;
    // insertion sort by (ymin, ymax): columns hold a handful
    order.length = n;
    for (let a = 0; a < n; a++) {
      let b = a;
      const lo = r[a * 4];
      const hi = r[a * 4 + 1];
      while (b > 0 && (r[order[b - 1] * 4] > lo || (r[order[b - 1] * 4] === lo && r[order[b - 1] * 4 + 1] > hi))) {
        order[b] = order[b - 1];
        b--;
      }
      order[b] = a;
    }
    const i = col % nx;
    const k = (col - i) / nx;
    const cx = X(i) + c / 2;
    const cz = Z(k) + c / 2;
    let a = 0;
    while (a < n) {
      const first = a;
      let lo = r[order[a] * 4];
      let hi = r[order[a] * 4 + 1];
      a++;
      // overlapping, or a gap no body's band could use (B2 needs H − step clear, a fit H): one interval
      while (a < n && r[order[a] * 4] - hi < H - step - TOL) {
        hi = Math.max(hi, r[order[a] * 4 + 1]);
        a++;
      }
      // the floor at this interval's top
      // (a): the walkable triangle reaching the top that's highest at the centre; coplanar ties
      // (a quad's two halves) share one plane, their ranges joined, so triangle order can't matter
      let best = -1;
      let bestY = -Infinity;
      let bestGx = 0;
      let bestGz = 0;
      let bestLo = Infinity;
      let bestHi = -Infinity;
      let below = false;
      for (let b = first; b < a; b++) {
        const e = order[b] * 4;
        if (!r[e + 3]) continue;
        const t = r[e + 2];
        if (r[e + 1] >= hi - TOL) {
          const gx = planes[t * 4 + 1];
          const gz = planes[t * 4 + 2];
          const y = planes[t * 4] + gx * cx + gz * cz;
          if (y === bestY && gx === bestGx && gz === bestGz) {
            bestLo = Math.min(bestLo, r[e]);
            bestHi = Math.max(bestHi, r[e + 1]);
          } else if (y > bestY || (y === bestY && (gx < bestGx || (gx === bestGx && gz < bestGz)))) {
            best = e;
            bestY = y;
            bestGx = gx;
            bestGz = gz;
            bestLo = r[e];
            bestHi = r[e + 1];
          }
        } else if (r[e + 1] >= hi - step - TOL) below = true;
      }
      let floor = -1;
      if (best >= 0) {
        floor = F.col.length;
        F.col.push(col);
        F.iv.push(ivLo.length);
        F.top.push(hi);
        F.yc.push(bestY);
        F.gx.push(bestGx);
        F.gz.push(bestGz);
        F.lo.push(bestLo);
        F.hi.push(bestHi);
      } else if (below) {
        floor = F.col.length;
        F.col.push(col);
        F.iv.push(ivLo.length);
        F.top.push(hi);
        F.yc.push(hi);
        F.gx.push(0);
        F.gz.push(0);
        F.lo.push(hi);
        F.hi.push(hi);
      }
      ivLo.push(lo);
      ivHi.push(hi);
      ivFloor.push(floor);
    }
    raw[col] = null;
  }
  ivStart[ncol] = ivLo.length;
  const nf = F.col.length;
  // typed from here on: the rest reads them in tight loops
  F.col = Int32Array.from(F.col);
  F.iv = Int32Array.from(F.iv);
  for (const k of ["top", "yc", "gx", "gz", "lo", "hi"]) F[k] = Float64Array.from(F[k]);
  // each floor's ceiling, and its surface's range over its cell
  const smin = new Float64Array(nf);
  const smax = new Float64Array(nf);
  const surf = (f, u, v) => Math.min(F.hi[f], Math.max(F.lo[f], F.yc[f] + F.gx[f] * (u - 0.5) * c + F.gz[f] * (v - 0.5) * c));
  F.ceil = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const iv = F.iv[f];
    const col = F.col[f];
    F.ceil[f] = iv + 1 < ivStart[col + 1] ? ivLo[iv + 1] : Infinity;
    let a = Infinity;
    let b = -Infinity;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const y = surf(f, u, v);
      a = Math.min(a, y);
      b = Math.max(b, y);
    }
    smin[f] = a;
    smax[f] = b;
  }

  mark("merge");
  // 3. headroom
  const alive = new Uint8Array(nf);
  for (let f = 0; f < nf; f++) alive[f] = F.ceil[f] - smax[f] >= H - TOL ? 1 : 0;
  // floors by column
  const fStart = new Int32Array(ncol + 1);
  {
    let f = 0;
    for (let col = 0; col < ncol; col++) {
      fStart[col] = f;
      while (f < nf && F.col[f] === col) f++;
    }
    fStart[ncol] = nf;
  }

  mark("headroom");
  // 4. connect
  const nb = new Int32Array(nf * 4).fill(-1);
  const MID = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]];
  for (let f = 0; f < nf; f++) {
    if (!alive[f]) continue;
    const col = F.col[f];
    const i = col % nx;
    const k = (col - i) / nx;
    for (let s = 0; s < 4; s++) {
      const ni = i + DIRS[s][0];
      const nk = k + DIRS[s][1];
      if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
      const ncl = nk * nx + ni;
      const sf = surf(f, MID[s][0], MID[s][1]);
      const o = MID[s ^ 1];
      for (let g = fStart[ncl]; g < fStart[ncl + 1]; g++) {
        if (!alive[g]) continue;
        if (Math.abs(surf(g, o[0], o[1]) - sf) > step + TOL) continue;
        if (Math.max(smax[f], smax[g]) + H > Math.min(F.ceil[f], F.ceil[g]) + TOL) continue;
        nb[f * 4 + s] = g;
        break;
      }
    }
  }

  mark("connect");
  // 5. erode
  const disc = discOffsets(R, c);
  const KW = 2 * disc.K + 1;
  const inDisc = new Uint8Array(KW * KW);
  for (let a = 0; a < disc.list.length; a += 2) inDisc[(disc.list[a + 1] + disc.K) * KW + disc.list[a] + disc.K] = 1;
  const nDisc = disc.list.length / 2;
  const kept1 = new Uint8Array(nf);
  const headroom = new Float64Array(nf);
  const seen = new Int32Array(nf);
  const colSeen = new Int32Array(ncol);
  const queue = new Int32Array(nf);
  let stamp = 0;
  // The fast path, exact where it applies. A column is "plain" when it has one alive floor, open
  // sky over it, and each of its four neighbours is one alive floor connected to it, no more than
  // δ above or below. In a square window of plain columns round f, every disc column's floor is
  // reached (the disc is 4-connected), none is more than 4K·δ + (f's own slope) above f, and all
  // have open sky: so the BFS below would keep f, with unbounded headroom. A 2D prefix sum of
  // the columns that aren't plain answers "is the window all plain?" at once.
  const delta = (step - Math.tan((P.slope * Math.PI) / 180) * c * Math.SQRT2 - TOL) / (4 * disc.K + 2);
  const notPlain = new Int32Array((nx + 1) * (nz + 1));
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const col = k * nx + i;
      let one = -1;
      let n = 0;
      for (let g = fStart[col]; g < fStart[col + 1]; g++) if (alive[g]) (one = g), n++;
      let plain = n === 1 && F.ceil[one] === Infinity;
      for (let s2 = 0; s2 < 4 && plain; s2++) {
        const h = nb[one * 4 + s2];
        if (h < 0 || Math.abs(F.top[h] - F.top[one]) > delta) plain = false;
        else {
          const hc = F.col[h];
          let m = 0;
          for (let g = fStart[hc]; g < fStart[hc + 1]; g++) if (alive[g]) m++;
          if (m !== 1) plain = false;
        }
      }
      notPlain[(k + 1) * (nx + 1) + i + 1] = (plain ? 0 : 1) + notPlain[k * (nx + 1) + i + 1] + notPlain[(k + 1) * (nx + 1) + i] - notPlain[k * (nx + 1) + i];
    }
  }
  const windowPlain = (i, k) => {
    const K = disc.K;
    if (i < K || k < K || i + K >= nx || k + K >= nz) return false;
    const W1 = nx + 1;
    const x0 = i - K;
    const x1 = i + K + 1;
    const z0 = k - K;
    const z1 = k + K + 1;
    return notPlain[z1 * W1 + x1] - notPlain[z0 * W1 + x1] - notPlain[z1 * W1 + x0] + notPlain[z0 * W1 + x0] === 0;
  };
  // and the other way: a disc column with no alive floor at all fails f, whatever else; per-row
  // prefix sums of such columns over each disc row's span say so in 2K + 1 looks
  const span = new Int32Array(2 * disc.K + 1).fill(-1); // half-width of the disc's row dk
  for (let a = 0; a < disc.list.length; a += 2) span[disc.list[a + 1] + disc.K] = Math.max(span[disc.list[a + 1] + disc.K], disc.list[a]);
  const emptyRow = new Int32Array(nz * (nx + 1));
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const col = k * nx + i;
      let any = 0;
      for (let g = fStart[col]; g < fStart[col + 1] && !any; g++) any = alive[g];
      emptyRow[k * (nx + 1) + i + 1] = emptyRow[k * (nx + 1) + i] + (any ? 0 : 1);
    }
  }
  const nearEmpty = (i, k) => {
    for (let dk = -disc.K; dk <= disc.K; dk++) {
      const w = span[dk + disc.K];
      if (w < 0) continue;
      const kk = k + dk;
      if (kk < 0 || kk >= nz || i - w < 0 || i + w >= nx) return true;
      if (emptyRow[kk * (nx + 1) + i + w + 1] - emptyRow[kk * (nx + 1) + i - w] > 0) return true;
    }
    return false;
  };
  for (let f = 0; f < nf; f++) {
    if (!alive[f]) continue;
    const col = F.col[f];
    const fi = col % nx;
    const fk = (col - fi) / nx;
    if (nearEmpty(fi, fk)) continue;
    if (windowPlain(fi, fk)) {
      kept1[f] = 1;
      headroom[f] = Infinity;
      continue;
    }
    stamp++;
    let head = 0;
    let tail = 0;
    queue[tail++] = f;
    seen[f] = stamp;
    let count = 0;
    let room = Infinity;
    const lowLim = smin[f] + step + TOL;
    const highLim = smax[f] + H - TOL;
    while (head < tail) {
      const g = queue[head++];
      const gc = F.col[g];
      if (F.top[g] <= lowLim && F.ceil[g] >= highLim) {
        if (colSeen[gc] !== stamp) {
          colSeen[gc] = stamp;
          count++;
        }
        room = Math.min(room, F.ceil[g] - smax[f] - H);
      }
      for (let s = 0; s < 4; s++) {
        const h = nb[g * 4 + s];
        if (h < 0 || seen[h] === stamp) continue;
        const hc = F.col[h];
        const hi = hc % nx;
        const di = hi - fi;
        const dk = (hc - hi) / nx - fk;
        if (Math.abs(di) > disc.K || Math.abs(dk) > disc.K || !inDisc[(dk + disc.K) * KW + di + disc.K]) continue;
        seen[h] = stamp;
        queue[tail++] = h;
      }
    }
    if (count === nDisc) {
      kept1[f] = 1;
      headroom[f] = Math.max(0, room);
    } else if (input?.why) {
      // (debugging a bake: the first disc column with no floor that counts)
      for (let a = 0; a < disc.list.length; a += 2) {
        const ii = fi + disc.list[a];
        const kk = fk + disc.list[a + 1];
        if (colSeen[kk * nx + ii] === stamp) continue;
        const why = [];
        for (let g = fStart[kk * nx + ii]; g < fStart[kk * nx + ii + 1]; g++) why.push({ top: F.top[g], ceil: F.ceil[g], alive: alive[g], reached: seen[g] === stamp });
        input.why.push({ x: X(fi) + c / 2, z: Z(fk) + c / 2, y: F.yc[f], at: [X(ii) + c / 2, Z(kk) + c / 2], floors: why, intervals: Array.from({ length: ivStart[kk * nx + ii + 1] - ivStart[kk * nx + ii] }, (_, b) => [ivLo[ivStart[kk * nx + ii] + b], ivHi[ivStart[kk * nx + ii] + b]]) });
        break;
      }
    }
  }

  mark("erode");
  // 6. prune: the components that hold a seed
  const comp = new Int32Array(nf).fill(-1);
  let ncomp = 0;
  const compArea = [];
  for (let f = 0; f < nf; f++) {
    if (!kept1[f] || comp[f] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = f;
    comp[f] = ncomp;
    while (head < tail) {
      const g = queue[head++];
      for (let s = 0; s < 4; s++) {
        const h = nb[g * 4 + s];
        if (h >= 0 && kept1[h] && comp[h] < 0) {
          comp[h] = ncomp;
          queue[tail++] = h;
        }
      }
    }
    compArea.push(tail);
    ncomp++;
  }
  const geo = { c, nx, nz, X, Z, F, fStart, smin, smax, surf, ivStart, ivLo: Float64Array.from(ivLo), ivHi: Float64Array.from(ivHi) };
  const seeds = Array.isArray(input?.seeds) ? input.seeds : [];
  const keepComp = new Uint8Array(ncomp);
  if (!seeds.length) keepComp.fill(1);
  for (const sd of seeds) {
    // the component the seed's link will project onto (P1): within a step of it, else the nearest
    const at = dropOnto(geo, sd.at, step);
    let f = nearestFloor(geo, (g) => kept1[g], at, step);
    if (f < 0) f = nearestFloor(geo, (g) => kept1[g], at, step, true);
    if (f >= 0) keepComp[comp[f]] = 1;
  }
  const dropped = [];
  for (let q = 0; q < ncomp; q++) {
    if (keepComp[q]) continue;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const floors = [];
    for (let f = 0; f < nf; f++) {
      if (comp[f] !== q) continue;
      const col = F.col[f];
      const i = col % nx;
      const x = X(i) + c / 2;
      const z = Z((col - i) / nx) + c / 2;
      sx += x;
      sz += z;
      sy += F.yc[f];
      floors.push([x, F.yc[f], z, F.ceil[f]]);
    }
    const n = compArea[q];
    dropped.push({ region: q, cells: n, area: n * c * c, centroid: [sx / n, sy / n, sz / n], floors, why: "no seed" });
  }

  mark("prune");
  // the kept cells, in column order (then upward)
  const newOf = new Int32Array(nf).fill(-1);
  let n = 0;
  for (let f = 0; f < nf; f++) if (kept1[f] && keepComp[comp[f]]) newOf[f] = n++;
  const oldOf = new Int32Array(n);
  for (let f = 0; f < nf; f++) if (newOf[f] >= 0) oldOf[newOf[f]] = f;
  const cells = {
    i: new Int32Array(n),
    k: new Int32Array(n),
    y: new Float32Array(n),
    gx: new Float32Array(n),
    gz: new Float32Array(n),
    lo: new Float32Array(n),
    hi: new Float32Array(n),
    ceil: new Float32Array(n),
    headroom: new Float32Array(n),
    region: new Int32Array(n),
  };
  // regions renumbered in cell order
  const regionOf = new Int32Array(ncomp).fill(-1);
  let nreg = 0;
  for (let a = 0; a < n; a++) {
    const f = oldOf[a];
    const col = F.col[f];
    cells.i[a] = col % nx;
    cells.k[a] = (col - cells.i[a]) / nx;
    cells.y[a] = F.yc[f];
    cells.gx[a] = F.gx[f];
    cells.gz[a] = F.gz[f];
    cells.lo[a] = F.lo[f];
    cells.hi[a] = F.hi[f];
    cells.ceil[a] = F.ceil[f];
    cells.headroom[a] = headroom[f];
    if (regionOf[comp[f]] < 0) regionOf[comp[f]] = nreg++;
    cells.region[a] = regionOf[comp[f]];
  }
  const column = new Int32Array(ncol + 1);
  {
    let a = 0;
    for (let col = 0; col < ncol; col++) {
      column[col] = a;
      while (a < n && cells.k[a] * nx + cells.i[a] === col) a++;
    }
    column[ncol] = n;
  }

  mark("cells");
  // 8 (first half). the silhouette, and D_r: columns whose disc meets none of it
  const sil = new Uint8Array(ncol);
  for (let col = 0; col < ncol; col++) sil[col] = ivStart[col + 1] > ivStart[col] ? 1 : 0;
  // (per-row prefix sums of the silhouette over each disc row's span, as for erosion)
  const silRow = new Int32Array(nz * (nx + 1));
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) silRow[k * (nx + 1) + i + 1] = silRow[k * (nx + 1) + i] + sil[k * nx + i];
  const outside = new Uint8Array(ncol);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      let out = 1;
      for (let dk = -disc.K; dk <= disc.K && out; dk++) {
        const w = span[dk + disc.K];
        const kk = k + dk;
        if (w < 0 || kk < 0 || kk >= nz) continue;
        const a = Math.max(0, i - w);
        const b = Math.min(nx - 1, i + w);
        if (a <= b && silRow[kk * (nx + 1) + b + 1] - silRow[kk * (nx + 1) + a] > 0) out = 0;
      }
      outside[k * nx + i] = out;
    }
  }
  mark("outside");
  const putOut = nearestOutside(outside, nx, nz, X, Z, c);

  mark("putOut");
  // 7. classify every side of every kept cell, once
  const mesh = {
    key: input?.key ?? null,
    params: P,
    cell: c,
    origin: [X(0), Z(0)],
    nx,
    nz,
    count: n,
    cells,
    column,
    side: {
      kind: new Uint8Array(n * 4),
      to: new Int32Array(n * 4),
      rise: new Float32Array(n * 4),
      gap: new Float32Array(n * 4),
      top: new Float32Array(n * 4),
      exit: new Float32Array(n * 8),
      normal: new Float32Array(n * 8),
    },
    outside,
    putOut,
    intervals: { start: ivStart, lo: Float32Array.from(ivLo), hi: Float32Array.from(ivHi) },
    links: [],
    dropped,
  };
  const occCache = new Array(ncol);
  const occ = (col) => {
    let o = occCache[col];
    if (!o) {
      const g = gatherDisc(geo, disc, col);
      o = occCache[col] = { buf: g.buf.slice(0, g.n), n: g.n };
    }
    return o;
  };
  const marchCols = Math.max(1, Math.floor(P.march / c + EPS));
  for (let a = 0; a < n; a++) {
    const f = oldOf[a];
    const i = cells.i[a];
    const k = cells.k[a];
    for (let s = 0; s < 4; s++) {
      const e = a * 4 + s;
      const g = nb[f * 4 + s];
      mesh.side.top[e] = Infinity;
      if (g >= 0 && newOf[g] >= 0) {
        mesh.side.kind[e] = STEP;
        mesh.side.to[e] = newOf[g];
        const o = MID[s ^ 1];
        mesh.side.rise[e] = surf(g, o[0], o[1]) - surf(f, MID[s][0], MID[s][1]);
        continue;
      }
      const base = surf(f, MID[s][0], MID[s][1]);
      let rise = 0;
      let result = null; // { kind, to, j, exit? }
      for (let j = 1; j <= marchCols && !result; j++) {
        const ci = i + DIRS[s][0] * j;
        const ck = k + DIRS[s][1] * j;
        if (ci < 0 || ck < 0 || ci >= nx || ck >= nz || outside[ck * nx + ci]) {
          const ex = Math.min(nx - 1, Math.max(0, ci));
          const ez = Math.min(nz - 1, Math.max(0, ck));
          result = { kind: rise <= step + TOL ? OPEN : WALL, to: OVERBOARD, j, exit: [X(ex) + c / 2, Z(ez) + c / 2] };
          break;
        }
        const ccol = ck * nx + ci;
        const fit = fitOver(occ(ccol), base, H);
        if (!(fit <= FIT_CAP)) {
          result = { kind: WALL, to: NONE, j };
          break;
        }
        rise = Math.max(rise, fit);
        for (let b = column[ccol + 1] - 1; b >= column[ccol]; b--) {
          const sg = cellRange(cells, b, c);
          if (sg[1] <= base + rise + TOL && base + rise <= sg[0] + cells.headroom[b] + TOL) {
            result = { kind: WALL, to: b, j };
            break;
          }
        }
      }
      if (!result) result = { kind: WALL, to: NONE, j: marchCols };
      // the band the vault crosses (columns 1 … j−1) must be clear at the rise; how high it stays clear
      let top = Infinity;
      if (result.to !== NONE) {
        for (let j = 1; j < result.j; j++) {
          const ccol = (k + DIRS[s][1] * j) * nx + (i + DIRS[s][0] * j);
          const t = clearAbove(occ(ccol), base + rise, H);
          if (t == null) {
            result = { kind: WALL, to: NONE, j: result.j };
            top = Infinity;
            break;
          }
          top = Math.min(top, t - base);
        }
      }
      mesh.side.kind[e] = result.kind;
      mesh.side.to[e] = result.to;
      mesh.side.rise[e] = result.to === NONE ? Math.max(rise, 0) : rise;
      mesh.side.gap[e] = (result.j - 1) * c;
      mesh.side.top[e] = result.to === NONE ? Infinity : top;
      if (result.exit) {
        mesh.side.exit[e * 2] = result.exit[0];
        mesh.side.exit[e * 2 + 1] = result.exit[1];
      }
    }
  }
  mark("classify");
  smoothNormals(mesh);

  mark("normals");
  // 8 (second half). links
  for (const sd of seeds) {
    const asked = dropOnto(geo, sd.at, step);
    const at = projectPoint(mesh, asked, step);
    const link = { kind: sd.kind, id: sd.id ?? null, at, yaw: Number(sd.yaw) || 0, asked };
    if (sd.kind === "ladder" && Array.isArray(sd.hook)) {
      const col = columnAt(mesh, sd.hook[0], sd.hook[2]);
      link.foot = col >= 0 && !outside[col] ? [putOut[col * 2], putOut[col * 2 + 1]] : [sd.hook[0], sd.hook[2]];
    }
    mesh.links.push(link);
  }
  mark("links");
  mesh.timing = timing;
  return mesh;
}

/** An empty mesh's answer to everything: nowhere to stand. */
export const isEmpty = (mesh) => !mesh || mesh.count === 0;

/** A cell's surface range over its square: [min, max]. */
export function cellRange(cells, a, c) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const y = Math.min(cells.hi[a], Math.max(cells.lo[a], cells.y[a] + cells.gx[a] * (u - 0.5) * c + cells.gz[a] * (v - 0.5) * c));
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return [lo, hi];
}

/** The intervals of every column whose square meets the disc about `col`'s centre: [lo, hi, lo, hi, …], in no order. */
const GATHER = { buf: new Float64Array(4096) };
function gatherDisc(geo, disc, col) {
  const { nx, nz, ivStart, ivLo, ivHi } = geo;
  const i = col % nx;
  const k = (col - i) / nx;
  let buf = GATHER.buf;
  let n = 0;
  for (let a = 0; a < disc.list.length; a += 2) {
    const ii = i + disc.list[a];
    const kk = k + disc.list[a + 1];
    if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
    const cl = kk * nx + ii;
    for (let b = ivStart[cl]; b < ivStart[cl + 1]; b++) {
      if (n + 2 > buf.length) {
        const bigger = new Float64Array(buf.length * 2);
        bigger.set(buf);
        buf = GATHER.buf = bigger;
      }
      buf[n++] = ivLo[b];
      buf[n++] = ivHi[b];
    }
  }
  return { buf, n };
}

/** The lowest z ≥ 0 at which a body H tall standing at base + z meets none of the intervals `occ`. */
function fitOver(occ, base, H) {
  const { buf, n } = occ;
  let z = base;
  for (let moved = true; moved; ) {
    moved = false;
    for (let a = 0; a < n; a += 2) {
      if (buf[a + 1] <= z + TOL || buf[a] >= z + H - TOL) continue;
      z = buf[a + 1];
      moved = true;
    }
  }
  return z - base;
}

/** If a body H tall with its feet at `at` meets none of `occ`, the highest its feet could rise and stay clear; else null. */
function clearAbove(occ, at, H) {
  const { buf, n } = occ;
  let top = Infinity;
  for (let a = 0; a < n; a += 2) {
    if (buf[a + 1] <= at + TOL) continue;
    if (buf[a] >= at + H - TOL) {
      top = Math.min(top, buf[a] - H);
      continue;
    }
    return null;
  }
  return top;
}

/** For each column in D_r, the nearest column centre outside it ([x, z] per column; NaN elsewhere). */
function nearestOutside(outside, nx, nz, X, Z, c) {
  const near = new Int32Array(nx * nz).fill(-1); // per row: nearest outside i
  for (let k = 0; k < nz; k++) {
    let last = -1;
    for (let i = 0; i < nx; i++) {
      if (outside[k * nx + i]) last = i;
      near[k * nx + i] = last;
    }
    let next = -1;
    for (let i = nx - 1; i >= 0; i--) {
      if (outside[k * nx + i]) next = i;
      const l = near[k * nx + i];
      if (next >= 0 && (l < 0 || next - i < i - l)) near[k * nx + i] = next;
    }
  }
  const out = new Float32Array(nx * nz * 2).fill(NaN);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const col = k * nx + i;
      if (outside[col]) continue;
      let best = Infinity;
      let bi = -1;
      let bk = -1;
      // rows outward from this one, until a row can't be nearer than the best (ties: the lower row, then the lower column)
      for (let dk = 0; dk < nz && dk * dk <= best; dk++) {
        for (const kk of dk ? [k - dk, k + dk] : [k]) {
          if (kk < 0 || kk >= nz) continue;
          const ii = near[kk * nx + i];
          if (ii < 0) continue;
          const d = (ii - i) ** 2 + (kk - k) ** 2;
          if (d < best || (d === best && (kk < bk || (kk === bk && ii < bi)))) {
            best = d;
            bi = ii;
            bk = kk;
          }
        }
      }
      if (bi >= 0) {
        out[col * 2] = X(bi) + c / 2;
        out[col * 2 + 1] = Z(bk) + c / 2;
      }
    }
  }
  return out;
}

/** Each WALL and OPEN side's plan normal (into the walkable), smoothed over the boundary near it. Only for how a slide feels. */
function smoothNormals(mesh) {
  const { cells, column, side, nx, nz, count } = mesh;
  const W = 2;
  for (let a = 0; a < count; a++) {
    for (let s = 0; s < 4; s++) {
      const e = a * 4 + s;
      if (side.kind[e] === STEP) continue;
      let sx = 0;
      let sz = 0;
      for (let dk = -W; dk <= W; dk++) {
        for (let di = -W; di <= W; di++) {
          const ii = cells.i[a] + di;
          const kk = cells.k[a] + dk;
          if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
          const col = kk * nx + ii;
          for (let b = column[col]; b < column[col + 1]; b++) {
            if (cells.region[b] !== cells.region[a]) continue;
            for (let t = 0; t < 4; t++) {
              if (side.kind[b * 4 + t] === STEP) continue;
              sx += DIRS[t][0];
              sz += DIRS[t][1];
            }
          }
        }
      }
      const l = Math.hypot(sx, sz);
      let nxv = -DIRS[s][0];
      let nzv = -DIRS[s][1];
      if (l > 1e-9 && (-sx * DIRS[s][0] - sz * DIRS[s][1]) / l < -0.2) {
        nxv = -sx / l;
        nzv = -sz / l;
      }
      side.normal[e * 2] = nxv;
      side.normal[e * 2 + 1] = nzv;
    }
  }
}

// ─── reading a mesh ─────────────────────────────────────────────────────────

/** The surface height of cell `a` at (u, v). */
export function surfaceAt(mesh, a, u, v) {
  const { cells } = mesh;
  const c = mesh.cell;
  return Math.min(cells.hi[a], Math.max(cells.lo[a], cells.y[a] + cells.gx[a] * (u - 0.5) * c + cells.gz[a] * (v - 0.5) * c));
}

/** The plan point of (cell, u, v), her frame. */
export function planOf(mesh, a, u, v) {
  return [mesh.origin[0] + (mesh.cells.i[a] + u) * mesh.cell, mesh.origin[1] + (mesh.cells.k[a] + v) * mesh.cell];
}

/** The local feet of (cell, u, v), her frame. */
export function pointOf(mesh, a, u, v) {
  const [x, z] = planOf(mesh, a, u, v);
  return [x, surfaceAt(mesh, a, u, v), z];
}

/** The column under a plan point, or −1 off the grid. */
export function columnAt(mesh, x, z) {
  const i = Math.floor((x - mesh.origin[0]) / mesh.cell);
  const k = Math.floor((z - mesh.origin[1]) / mesh.cell);
  if (i < 0 || k < 0 || i >= mesh.nx || k >= mesh.nz) return -1;
  return k * mesh.nx + i;
}

/** Is a plan point (her frame) in her D_r: too near her to be in the water there? */
export function inShadow(mesh, x, z) {
  if (!mesh) return false;
  const col = columnAt(mesh, x, z);
  return col >= 0 && !mesh.outside[col];
}

/** Where a swimmer at a plan point in her D_r is put out: [x, z], her frame. */
export function putOutAt(mesh, x, z) {
  const col = columnAt(mesh, x, z);
  if (col < 0 || mesh.outside[col]) return [x, z];
  return [mesh.putOut[col * 2], mesh.putOut[col * 2 + 1]];
}

/** The surface height at a side's midpoint: the base its rise and its vault are measured from. */
export function sideBase(mesh, a, s) {
  const m = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]][s];
  return surfaceAt(mesh, a, m[0], m[1]);
}

/** How far below a point projection still looks for a floor to put it on: a point in the air drops onto what's under it. */
export const DROP = 2;

/**
 * Projection (P1): of the kept cells whose surface is no more than `within`
 * above `p` and no more than DROP below it, the one nearest in plan, a drop
 * deeper than `within` counting metre for metre as distance (so a point in
 * the air lands on what's under it, not on a deck a cell away below that, nor
 * on one far off that's within a step of it); the nearest in height on a
 * tie. Else (`fallback`) the nearest by distance in 3D.
 * @returns {{ cell, u, v } | null}  null on an empty mesh, or with no cell within reach and no fallback
 */
export function projectPoint(mesh, p, within = mesh?.params?.step ?? NAV.step, { fallback = true } = {}) {
  if (isEmpty(mesh)) return null;
  const c = mesh.cell;
  let best = -1;
  let bestD = Infinity;
  let bestDy = Infinity;
  let far = -1;
  let farD = Infinity;
  let bu = 0.5;
  let bv = 0.5;
  let fu = 0.5;
  let fv = 0.5;
  for (let a = 0; a < mesh.count; a++) {
    const x0 = mesh.origin[0] + mesh.cells.i[a] * c;
    const z0 = mesh.origin[1] + mesh.cells.k[a] * c;
    const u = Math.min(1, Math.max(0, (p[0] - x0) / c));
    const v = Math.min(1, Math.max(0, (p[2] - z0) / c));
    const dx = x0 + u * c - p[0];
    const dz = z0 + v * c - p[2];
    const d2 = dx * dx + dz * dz;
    const rise = surfaceAt(mesh, a, u, v) - p[1];
    const dy = Math.abs(rise);
    const d = Math.sqrt(d2) + Math.max(0, -rise - within);
    if (rise <= within + TOL && rise >= -DROP - TOL && (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && dy < bestDy))) {
      best = a;
      bestD = d;
      bestDy = dy;
      bu = u;
      bv = v;
    }
    const d3 = d2 + dy * dy;
    if (d3 < farD) {
      far = a;
      farD = d3;
      fu = u;
      fv = v;
    }
  }
  if (best >= 0) return { cell: best, u: bu, v: bv };
  if (!fallback) return null;
  return { cell: far, u: fu, v: fv };
}

// ─── bake helpers over the raw floors ───────────────────────────────────────

/** A seed dropped onto what's under it: the highest interval top in its column no more than `step` above it. */
function dropOnto(geo, at, step) {
  const { c, nx, nz, ivStart, ivHi } = geo;
  const i = Math.floor(at[0] / c) - Math.round(geo.X(0) / c);
  const k = Math.floor(at[2] / c) - Math.round(geo.Z(0) / c);
  if (i < 0 || k < 0 || i >= nx || k >= nz) return [at[0], at[1], at[2]];
  const col = k * nx + i;
  let y = null;
  for (let b = ivStart[col]; b < ivStart[col + 1]; b++) if (ivHi[b] <= at[1] + step + TOL) y = ivHi[b];
  return [at[0], y ?? at[1], at[2]];
}

/** The floor (by `ok`) nearest `p` in plan within `within` of its height (`in3d`: nearest in 3D), or −1. projectPoint's twin, over the raw floors. */
function nearestFloor(geo, ok, p, within, in3d = false) {
  const { c, F, X, Z, nx, surf } = geo;
  let best = -1;
  let bestD = Infinity;
  for (let f = 0; f < F.col.length; f++) {
    if (!ok(f)) continue;
    const col = F.col[f];
    const i = col % nx;
    const x0 = X(i);
    const z0 = Z((col - i) / nx);
    const u = Math.min(1, Math.max(0, (p[0] - x0) / c));
    const v = Math.min(1, Math.max(0, (p[2] - z0) / c));
    const rise = surf(f, u, v) - p[1];
    const dy = Math.abs(rise);
    if (!in3d && (rise > within + TOL || rise < -DROP - TOL)) continue;
    const plan = (x0 + u * c - p[0]) ** 2 + (z0 + v * c - p[2]) ** 2;
    const d = in3d ? plan + dy * dy : Math.sqrt(plan) + Math.max(0, -rise - within);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

// ─── triangles from boxes (fixtures, the property test, the swept wheel) ───

/** An axis-aligned box as 12 triangles (9 numbers each). */
export function boxTriangles([x0, y0, z0], [x1, y1, z1]) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
  const out = [];
  for (const [a, b, c, d] of quads) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return out;
}

/**
 * A part that turns about one of its own axes (0 X, 1 Y, 2 Z) through the
 * origin in play (the wheel about its axle) as the solid its turn sweeps:
 * the cylinder about that axis that bounds its triangles (own frame).
 */
export function sweptAbout(tris, axis = 2) {
  let r = 0;
  let lo = Infinity;
  let hi = -Infinity;
  const [p, q] = [(axis + 1) % 3, (axis + 2) % 3];
  for (let k = 0; k + 2 < tris.length; k += 3) {
    r = Math.max(r, Math.hypot(tris[k + p], tris[k + q]));
    lo = Math.min(lo, tris[k + axis]);
    hi = Math.max(hi, tris[k + axis]);
  }
  if (!(hi >= lo)) return [];
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  a[axis] = lo;
  b[axis] = hi;
  return cylinderTriangles(a, b, r);
}

/**
 * A closed cylinder about an axis (from `a` to `b`, radius `r`) as triangles:
 * a prism whose polygon circumscribes the circle, so it bounds the round one.
 */
export function cylinderTriangles(a, b, r, sides = 24) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...d) || 1;
  const w = d.map((x) => x / l);
  const ref = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u0 = [w[1] * ref[2] - w[2] * ref[1], w[2] * ref[0] - w[0] * ref[2], w[0] * ref[1] - w[1] * ref[0]];
  const ul = Math.hypot(...u0);
  const u = u0.map((x) => x / ul);
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const R = r / Math.cos(Math.PI / sides);
  const ring = (p, k) => {
    const t = (k / sides) * Math.PI * 2;
    const cs = Math.cos(t) * R;
    const sn = Math.sin(t) * R;
    return [p[0] + u[0] * cs + v[0] * sn, p[1] + u[1] * cs + v[1] * sn, p[2] + u[2] * cs + v[2] * sn];
  };
  const out = [];
  for (let k = 0; k < sides; k++) {
    const a0 = ring(a, k);
    const a1 = ring(a, k + 1);
    const b0 = ring(b, k);
    const b1 = ring(b, k + 1);
    out.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    out.push(...a, ...a1, ...a0);
    out.push(...b, ...b0, ...b1);
  }
  return out;
}
