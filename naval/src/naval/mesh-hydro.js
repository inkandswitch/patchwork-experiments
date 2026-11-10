// Hydrostatics of a closed triangle mesh, cut by a waterplane at any heel,
// trim and immersion. Pure (no THREE, no DOM); runs in a worker as well.
//
// Frame and attitude are Chartroom's (hydrostatic-table v1 §2): the hull
// frame is x forward, y port, z up, metres; the body-to-world rotation is
// R = Rx(heel) · Ry(−trim) (positive heel lowers starboard, positive trim
// raises the bow); the waterplane is world Z = h, h being the plane offset
// (not a draft), and the immersed half-space is Z ≤ h.
//
// The integrals are exact for a polyhedron, by the divergence theorem, with
// fields chosen to vanish on the waterplane so the cut surface (the "cap")
// never has to be built: each skin triangle is clipped to Z ≤ h and
//   ∇      = ∫skin (Z − h) n_Z dA
//   ∇·B    = ∫skin [X(Z − h), Y(Z − h), (Z² − h²)/2] n_Z dA
// and, since a closed surface has ∮ f n_Z dA = 0 for any f(X, Y),
//   Aw, ∫X, ∫Y, ∫X², ∫XY, ∫Y² over the waterplane = −∫skin f n_Z dA.
// n_Z dA over a flat triangle is its signed area projected on XY, and the
// integrands are linear or a product of two linear functions, which have
// exact vertex formulas (∫uv dA = A/12 · (Σuᵢvᵢ + Σuᵢ·Σvᵢ)).
//
// The mesh must be closed and wound outward; prepareMesh() flips an inward
// one and says when it is open (then every number here is approximate).

const RAD = Math.PI / 180;
/** |∮ n dA| / ∮ |n| dA below this is closed (float32 GLB vertices leave ~1e-7). */
export const GAP_TOL = 1e-4;
/** A face whose outward normal is within 30° of straight aft counts as a transom (cos 30°). */
export const AFT_FACING = Math.cos(Math.PI / 6);

/**
 * The rows of R = Rx(heel) · Ry(−trim): world X, Y, Z of a body point are row · p.
 * Row 2 is the waterplane normal n = [sin trim cos heel, sin heel, cos trim cos heel].
 */
export function rotationRows(heelDeg = 0, trimDeg = 0) {
  const p = heelDeg * RAD;
  const t = trimDeg * RAD;
  const cp = Math.cos(p), sp = Math.sin(p), ct = Math.cos(t), st = Math.sin(t);
  return [
    [ct, 0, -st],
    [-sp * st, cp, -sp * ct],
    [cp * st, sp, cp * ct],
  ];
}

/** Body coordinates of a world vector: Rᵀ · w. */
export function toBody(R, w) {
  return [0, 1, 2].map((j) => R[0][j] * w[0] + R[1][j] * w[1] + R[2][j] * w[2]);
}

/** World coordinates of a body vector: R · p. */
export function toWorld(R, p) {
  return R.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]);
}

/**
 * A mesh ready to cut: triangles wound outward, its bounds, and whether it is
 * closed. `gap` is |∮ n dA| / ∮ |n| dA, zero for a closed surface.
 * @param {Float64Array|number[]} triangles 9 numbers per triangle, hull frame
 */
export function prepareMesh(triangles) {
  const t = Float64Array.from(triangles);
  let vol6 = 0;
  let sx = 0, sy = 0, sz = 0, area2 = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2];
    const ux = t[i + 3] - ax, uy = t[i + 4] - ay, uz = t[i + 5] - az;
    const vx = t[i + 6] - ax, vy = t[i + 7] - ay, vz = t[i + 8] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    vol6 += ax * cx + ay * cy + az * cz;
    sx += cx; sy += cy; sz += cz;
    area2 += Math.hypot(cx, cy, cz);
    for (let k = 0; k < 9; k += 3)
      for (let c = 0; c < 3; c++) {
        const v = t[i + k + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
  }
  const flipped = vol6 < 0;
  if (flipped)
    for (let i = 0; i < t.length; i += 9)
      for (let c = 0; c < 3; c++) {
        const b = t[i + 3 + c];
        t[i + 3 + c] = t[i + 6 + c];
        t[i + 6 + c] = b;
      }
  const gap = area2 > 0 ? Math.hypot(sx, sy, sz) / area2 : 1;
  const gapAxes = area2 > 0 ? [sx, sy, sz].map((v) => Math.abs(v) / area2) : [1, 1, 1];
  const count = t.length / 9;
  return {
    triangles: t,
    count,
    bounds: count ? { min, max } : null,
    volumeM3: Math.abs(vol6) / 6,
    surfaceM2: area2 / 2,
    flipped,
    gap,
    gapAxes,
    closed: count > 0 && gap < GAP_TOL,
    // Every field here is along world Z, so a hole whose faces would be
    // vertical (an absent flat transom: its normal is along x) changes
    // nothing upright or heeled at zero trim. Only a gap with a y or z
    // component (an open deck, a missing side) does.
    closedForHeel: count > 0 && gapAxes[1] < GAP_TOL && gapAxes[2] < GAP_TOL,
  };
}

/** The mesh's vertical extent in the world at an attitude: [minZ, maxZ]. */
export function heightSpan(mesh, R) {
  const t = mesh.triangles;
  const [a, b, c] = R[2];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < t.length; i += 3) {
    const z = a * t[i] + b * t[i + 1] + c * t[i + 2];
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return [lo, hi];
}

const q12 = (u0, u1, u2, v0, v1, v2) => (u0 * v0 + u1 * v1 + u2 * v2 + (u0 + u1 + u2) * (v0 + v1 + v2)) / 12;

/**
 * Cut the mesh at one waterplane. Everything a Chartroom sample holds, plus
 * the waterline's extent and the deepest immersion.
 * @param {ReturnType<typeof prepareMesh>} mesh
 * @param {{ heelDeg?: number, trimDeg?: number, h: number }} at
 * @param {{ full?: boolean }} [opts] full: false skips everything but ∇ and Aw (the float's inner loop)
 */
export function cut(mesh, { heelDeg = 0, trimDeg = 0, h }, { full = true } = {}) {
  const R = rotationRows(heelDeg, trimDeg);
  const [r0, r1, r2] = R;
  const t = mesh.triangles;
  // integrate about the mesh's middle (world X, Y), not the frame origin, so
  // the central second moments don't lose digits to a far-off origin
  const mid = mesh.bounds ? [0, 1, 2].map((k) => (mesh.bounds.min[k] + mesh.bounds.max[k]) / 2) : [0, 0, 0];
  const X0 = r0[0] * mid[0] + r0[1] * mid[1] + r0[2] * mid[2];
  const Y0 = r1[0] * mid[0] + r1[1] * mid[1] + r1[2] * mid[2];
  let V = 0, Mx = 0, My = 0, Mz = 0, wsa = 0, wsaAft = 0, aftFacing = false, SX = 0, SY = 0;
  let Aw = 0, Cx = 0, Cy = 0, Ixx = 0, Ixy = 0, Iyy = 0;
  let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity, zLo = Infinity;
  const W = new Float64Array(9); // the triangle in world coordinates
  const P = new Float64Array(12); // the clipped polygon, up to 4 points
  const cross = (x, y, z) => {
    if (x < xLo) xLo = x;
    if (x > xHi) xHi = x;
    if (y < yLo) yLo = y;
    if (y > yHi) yHi = y;
  };
  const tri = (o0, o1, o2) => {
    const X0 = P[o0], Y0 = P[o0 + 1], Z0 = P[o0 + 2];
    const X1 = P[o1], Y1 = P[o1 + 1], Z1 = P[o1 + 2];
    const X2 = P[o2], Y2 = P[o2 + 1], Z2 = P[o2 + 2];
    const ux = X1 - X0, uy = Y1 - Y0, uz = Z1 - Z0;
    const vx = X2 - X0, vy = Y2 - Y0, vz = Z2 - Z0;
    const cz = ux * vy - uy * vx;
    const A = cz / 2; // n_Z dA, signed
    const z0 = Z0 - h, z1 = Z1 - h, z2 = Z2 - h;
    V += (A * (z0 + z1 + z2)) / 3;
    Aw -= A;
    if (!full) return;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz;
    const da = Math.hypot(cx, cy, cz) / 2;
    wsa += da;
    SX += cx;
    SY += cy;
    if (aftFacing) wsaAft += da;
    Mx += A * q12(X0, X1, X2, z0, z1, z2);
    My += A * q12(Y0, Y1, Y2, z0, z1, z2);
    Mz += (A * q12(z0, z1, z2, Z0 + h, Z1 + h, Z2 + h)) / 2;
    Cx -= (A * (X0 + X1 + X2)) / 3;
    Cy -= (A * (Y0 + Y1 + Y2)) / 3;
    Ixx -= A * q12(X0, X1, X2, X0, X1, X2);
    Ixy -= A * q12(X0, X1, X2, Y0, Y1, Y2);
    Iyy -= A * q12(Y0, Y1, Y2, Y0, Y1, Y2);
  };
  for (let i = 0; i < t.length; i += 9) {
    let below = 0;
    for (let k = 0; k < 3; k++) {
      const x = t[i + 3 * k], y = t[i + 3 * k + 1], z = t[i + 3 * k + 2];
      W[3 * k] = r0[0] * x + r0[1] * y + r0[2] * z - X0;
      W[3 * k + 1] = r1[0] * x + r1[1] * y + r1[2] * z - Y0;
      const Z = (W[3 * k + 2] = r2[0] * x + r2[1] * y + r2[2] * z);
      if (Z <= h) below++;
    }
    if (below === 0) continue;
    if (full) {
      // a face looking aft (a transom): its wetted area is reported apart
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      const nx = uy * vz - uz * vy;
      aftFacing = nx < -AFT_FACING * Math.hypot(nx, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    if (below === 3) {
      P.set(W);
      if (full) for (let k = 0; k < 3; k++) if (W[3 * k + 2] < zLo) zLo = W[3 * k + 2];
      tri(0, 3, 6);
      continue;
    }
    // Sutherland–Hodgman against Z ≤ h
    let n = 0;
    for (let k = 0; k < 3; k++) {
      const a = 3 * k, b = 3 * ((k + 1) % 3);
      const za = W[a + 2] - h, zb = W[b + 2] - h;
      if (za <= 0) {
        P[n++] = W[a];
        P[n++] = W[a + 1];
        P[n++] = W[a + 2];
        if (full && W[a + 2] < zLo) zLo = W[a + 2];
      }
      if ((za <= 0) !== (zb <= 0)) {
        const s = za / (za - zb);
        const X = W[a] + s * (W[b] - W[a]);
        const Y = W[a + 1] + s * (W[b + 1] - W[a + 1]);
        P[n++] = X;
        P[n++] = Y;
        P[n++] = h;
        if (full) cross(X, Y, h);
      }
    }
    const m = n / 3;
    for (let k = 1; k + 1 < m; k++) tri(0, 3 * k, 3 * (k + 1));
  }
  if (!full) return { volumeM3: Math.max(0, V), waterplaneAreaM2: Math.max(0, Aw) };
  const vol = V > 0 ? V : 0;
  const Bw = vol > 0 ? [X0 + Mx / V, Y0 + My / V, Mz / V] : null;
  let waterplane = null;
  if (Aw > 1e-12 * Math.max(1, mesh.surfaceM2)) {
    const xf = Cx / Aw, yf = Cy / Aw;
    let xx = Math.max(0, Ixx - Aw * xf * xf);
    let yy = Math.max(0, Iyy - Aw * yf * yf);
    let xy = Ixy - Aw * xf * yf;
    // a sliver waterplane can leave xy a hair past √(xx·yy) in round-off
    const lim = Math.sqrt(xx * yy);
    if (Math.abs(xy) > lim) xy = Math.sign(xy) * lim;
    const c = [X0 + xf, Y0 + yf, h];
    waterplane = { areaM2: Aw, centroidWorld: c, centroidM: toBody(R, c), secondMomentsM4: { xx, xy, yy } };
  }
  return {
    heelDeg,
    trimDeg,
    h,
    volumeM3: vol,
    buoyancyCenterWorld: Bw,
    buoyancyCenterM: Bw ? toBody(R, Bw) : null,
    waterplane,
    wettedAreaM2: wsa,
    aftFacingWetM2: wsaAft,
    // the immersed skin plus the waterplane closes iff its horizontal Σ n dA is zero
    // (the cap is horizontal, so it closes Z by construction): a hole below this
    // waterplane shows here, a hole above it can't change anything
    immersedGap: wsa > 0 ? Math.hypot(SX, SY) / 2 / wsa : 0,
    immersedGapAxes: wsa > 0 ? [Math.abs(SX) / 2 / wsa, Math.abs(SY) / 2 / wsa] : [0, 0],
    waterline: xLo <= xHi ? { xAft: X0 + xLo, xFwd: X0 + xHi, yStbd: Y0 + yLo, yPort: Y0 + yHi, length: xHi - xLo, beam: yHi - yLo } : null,
    deepestZ: Number.isFinite(zLo) ? zLo : null,
  };
}

/** ∇ and Aw at one waterplane (the float's inner loop). */
export const volumeAt = (mesh, heelDeg, trimDeg, h) => cut(mesh, { heelDeg, trimDeg, h }, { full: false });

/**
 * The plane offset h at which the mesh displaces `volumeM3` at a fixed heel
 * and trim, or null when it can't (more than the whole envelope, or none).
 * Safeguarded Newton (dV/dh = Aw) inside a bisection bracket.
 */
export function immerse(mesh, volumeM3, { heelDeg = 0, trimDeg = 0 } = {}) {
  if (!(volumeM3 > 0) || !mesh.count) return null;
  const R = rotationRows(heelDeg, trimDeg);
  let [lo, hi] = heightSpan(mesh, R);
  const span = hi - lo;
  if (!(span > 0)) return null;
  const vHi = volumeAt(mesh, heelDeg, trimDeg, hi).volumeM3;
  if (volumeM3 > vHi * (1 + 1e-9)) return null;
  const tol = 1e-10 * Math.max(volumeM3, 1e-9);
  let h = lo + 0.5 * span;
  for (let i = 0; i < 100; i++) {
    const { volumeM3: v, waterplaneAreaM2: aw } = volumeAt(mesh, heelDeg, trimDeg, h);
    const f = v - volumeM3;
    if (Math.abs(f) <= tol) return h;
    if (f > 0) hi = h;
    else lo = h;
    let next = aw > 0 ? h - f / aw : NaN;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (hi - lo < 1e-12 * span) return next;
    h = next;
  }
  return h;
}

/**
 * The immersed area of the transverse section at world X = x0 (upright or
 * not), and the waterline's half-breadths there. Green's theorem on the
 * section's skin segments, with (Z − h) vanishing on the waterline.
 */
export function sectionAt(mesh, { heelDeg = 0, trimDeg = 0, h }, x0) {
  const R = rotationRows(heelDeg, trimDeg);
  const t = mesh.triangles;
  let area = 0;
  let yPort = -Infinity, yStbd = Infinity;
  const W = new Float64Array(9);
  const pts = [];
  for (let i = 0; i < t.length; i += 9) {
    let lo = 0, hi = 0;
    for (let k = 0; k < 3; k++) {
      const x = t[i + 3 * k], y = t[i + 3 * k + 1], z = t[i + 3 * k + 2];
      for (let r = 0; r < 3; r++) W[3 * k + r] = R[r][0] * x + R[r][1] * y + R[r][2] * z;
      if (W[3 * k] < x0) lo++;
      else hi++;
    }
    if (!lo || !hi) continue;
    pts.length = 0;
    for (let k = 0; k < 3; k++) {
      const a = 3 * k, b = 3 * ((k + 1) % 3);
      const da = W[a] - x0, db = W[b] - x0;
      if (da < 0 !== db < 0) {
        const s = da / (da - db);
        pts.push([W[a + 1] + s * (W[b + 1] - W[a + 1]), W[a + 2] + s * (W[b + 2] - W[a + 2])]);
      }
    }
    if (pts.length !== 2) continue;
    // the in-plane outward normal is the skin normal's (Y, Z); the region's
    // counter-clockwise tangent is (−n_Z, n_Y)
    const ux = W[3] - W[0], uy = W[4] - W[1], uz = W[5] - W[2];
    const vx = W[6] - W[0], vy = W[7] - W[1], vz = W[8] - W[2];
    const nY = uz * vx - ux * vz, nZ = ux * vy - uy * vx;
    let [p, q] = pts;
    if ((q[0] - p[0]) * -nZ + (q[1] - p[1]) * nY < 0) [p, q] = [q, p];
    const pa = p[1] - h, qa = q[1] - h;
    if (pa > 0 && qa > 0) continue;
    if ((pa > 0) !== (qa > 0)) {
      const s = pa / (pa - qa);
      const c = [p[0] + s * (q[0] - p[0]), h];
      if (c[0] > yPort) yPort = c[0];
      if (c[0] < yStbd) yStbd = c[0];
      if (pa > 0) p = c;
      else q = c;
    }
    area -= ((p[1] + q[1]) / 2 - h) * (q[0] - p[0]);
  }
  return { areaM2: Math.max(0, area), yPort: Number.isFinite(yPort) ? yPort : null, yStbd: Number.isFinite(yStbd) ? yStbd : null };
}

/**
 * The upright side view (trim 0): per station, the mesh's lowest and highest
 * point and its half-breadths, plus the ends. Body coordinates.
 * @returns {{ x: number, zMin: number, zMax: number, yPort: number, yStbd: number }[]}
 */
export function sideView(mesh, stations = 120) {
  const t = mesh.triangles;
  const b = mesh.bounds;
  if (!b) return [];
  const [x0, x1] = [b.min[0], b.max[0]];
  const L = x1 - x0;
  const rows = [];
  const ends = (xEnd, near) => {
    let zMin = Infinity, zMax = -Infinity, yP = -Infinity, yS = Infinity;
    for (let i = 0; i < t.length; i += 3)
      if (Math.abs(t[i] - xEnd) <= near) {
        zMin = Math.min(zMin, t[i + 2]);
        zMax = Math.max(zMax, t[i + 2]);
        yP = Math.max(yP, t[i + 1]);
        yS = Math.min(yS, t[i + 1]);
      }
    return { x: xEnd, zMin, zMax, yPort: yP, yStbd: yS };
  };
  rows.push(ends(x0, 1e-9 * Math.max(1, L)));
  for (let s = 0; s < stations; s++) {
    const xs = x0 + ((s + 0.5) / stations) * L;
    let zMin = Infinity, zMax = -Infinity, yP = -Infinity, yS = Infinity;
    for (let i = 0; i < t.length; i += 9) {
      let lo = 0;
      for (let k = 0; k < 3; k++) if (t[i + 3 * k] < xs) lo++;
      if (lo === 0 || lo === 3) continue;
      for (let k = 0; k < 3; k++) {
        const a = i + 3 * k, c = i + 3 * ((k + 1) % 3);
        const da = t[a] - xs, dc = t[c] - xs;
        if (da < 0 !== dc < 0) {
          const f = da / (da - dc);
          const y = t[a + 1] + f * (t[c + 1] - t[a + 1]);
          const z = t[a + 2] + f * (t[c + 2] - t[a + 2]);
          if (z < zMin) zMin = z;
          if (z > zMax) zMax = z;
          if (y > yP) yP = y;
          if (y < yS) yS = y;
        }
      }
    }
    if (zMin <= zMax) rows.push({ x: xs, zMin, zMax, yPort: yP, yStbd: yS });
  }
  rows.push(ends(x1, 1e-9 * Math.max(1, L)));
  return rows.filter((r) => Number.isFinite(r.zMin) && Number.isFinite(r.zMax));
}

/** Linear interpolation of a side-view column at x (null outside it). */
export function sideAt(view, x, key) {
  if (!view.length || x < view[0].x || x > view[view.length - 1].x) return null;
  for (let i = 1; i < view.length; i++)
    if (x <= view[i].x) {
      const a = view[i - 1], b = view[i];
      const s = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
      return a[key] + s * (b[key] - a[key]);
    }
  return view[view.length - 1][key];
}

/**
 * The underwater lateral profile (upright, the waterline at z = zWl): the
 * side view clipped below the waterline. Area, centroid and the polygon
 * (forward along the waterline, back along the keel line).
 */
export function lateralProfile(view, zWl = 0) {
  const wet = view.filter((r) => r.zMin < zWl).map((r) => ({ x: r.x, top: Math.min(r.zMax, zWl), bot: r.zMin }));
  let A = 0, Sx = 0, Sz = 0;
  for (let i = 1; i < wet.length; i++) {
    const a = wet[i - 1], b = wet[i];
    const dx = b.x - a.x;
    const ha = a.top - a.bot, hb = b.top - b.bot;
    const dA = (dx * (ha + hb)) / 2;
    A += dA;
    // trapezoid strip: x centroid weighted by heights, z by mid-heights
    Sx += (dx * (ha * (2 * a.x + b.x) + hb * (a.x + 2 * b.x))) / 6;
    Sz += (dx * (ha * (a.top + a.bot) + hb * (b.top + b.bot))) / 4;
  }
  const polygon = wet.length ? [...wet.map((r) => [r.x, r.top]), ...wet.reverse().map((r) => [r.x, r.bot])] : [];
  return { areaM2: A, centroid: A > 0 ? [Sx / A, Sz / A] : null, polygon };
}

const finite = (v) => (Number.isFinite(v) ? v : null);

/**
 * The upright hydrostatics at a waterplane (heel 0, trim 0 in the hull
 * frame): the DSYHS inputs and camber's vocabulary. Lengths in metres,
 * centres in the hull frame, K the mesh's lowest point.
 * Cp and Cm follow DSYHS (the largest section, Ax); cpMid and cmMid use the
 * section at mid-LWL, as camber does. wsaM2 is every immersed face;
 * wsaCanoeM2 leaves out faces looking aft (an immersed transom, transomWetM2),
 * which is the skin camber's own wetted area measures.
 */
export function uprightHydrostatics(mesh, h, { stations = 41 } = {}) {
  const c = cut(mesh, { heelDeg: 0, trimDeg: 0, h });
  if (!(c.volumeM3 > 0) || !c.waterline) return { ok: false, cut: c, reason: c.volumeM3 > 0 ? "no waterplane" : "nothing below the waterline" };
  const { xAft, xFwd, length: lwl, beam: bwl } = c.waterline;
  const tc = h - c.deepestZ;
  const K = mesh.bounds.min[2];
  const vol = c.volumeM3;
  const B = c.buoyancyCenterM;
  const wp = c.waterplane;
  const at = { heelDeg: 0, trimDeg: 0, h };
  let amax = 0, xAmax = null;
  const sac = [];
  for (let i = 0; i < stations; i++) {
    const x = xAft + ((i + 0.5) / stations) * lwl;
    const a = sectionAt(mesh, at, x).areaM2;
    sac.push([x, a]);
    if (a > amax) {
      amax = a;
      xAmax = x;
    }
  }
  // refine the largest section with a parabola through its neighbours
  const iMax = sac.findIndex(([x]) => x === xAmax);
  if (iMax > 0 && iMax < sac.length - 1) {
    const [a0, a1, a2] = [sac[iMax - 1][1], sac[iMax][1], sac[iMax + 1][1]];
    const den = a0 - 2 * a1 + a2;
    if (den < 0) {
      const d = (0.5 * (a0 - a2)) / den;
      const dx = lwl / stations;
      const x = xAmax + d * dx;
      const a = sectionAt(mesh, at, x).areaM2;
      if (a > amax) {
        amax = a;
        xAmax = x;
      }
    }
  }
  const mid = sectionAt(mesh, at, (xAft + xFwd) / 2);
  const am = mid.areaM2;
  const near = sectionAt(mesh, at, xFwd - 0.1 * lwl);
  const halfEntranceDeg = near.yPort != null ? Math.atan(Math.abs(near.yPort - (c.waterline.yPort + c.waterline.yStbd) / 2) / (0.1 * lwl)) / RAD : null;
  const yy = wp?.secondMomentsM4.yy;
  const xx = wp?.secondMomentsM4.xx;
  const kb = B[2] - K;
  return {
    ok: true,
    h,
    volumeM3: vol,
    lwl,
    bwl,
    tc,
    xAft,
    xFwd,
    wsaM2: c.wettedAreaM2,
    transomWetM2: c.aftFacingWetM2,
    wsaCanoeM2: c.wettedAreaM2 - c.aftFacingWetM2,
    awM2: wp?.areaM2 ?? 0,
    lcb: B[0],
    tcb: B[1],
    vcb: B[2],
    lcf: wp ? wp.centroidM[0] : null,
    kb,
    kRefZ: K,
    bmt: yy != null ? yy / vol : null,
    bml: xx != null ? xx / vol : null,
    kmt: yy != null ? kb + yy / vol : null,
    kml: xx != null ? kb + xx / vol : null,
    amaxM2: amax,
    xAmax,
    amM2: am,
    cb: finite(vol / (lwl * bwl * tc)),
    cp: finite(vol / (amax * lwl)),
    cm: finite(amax / (bwl * tc)),
    cpMid: finite(vol / (am * lwl)),
    cmMid: finite(am / (bwl * tc)),
    cw: finite((wp?.areaM2 ?? NaN) / (lwl * bwl)),
    halfEntranceDeg: finite(halfEntranceDeg),
    sac,
    cut: c,
  };
}
