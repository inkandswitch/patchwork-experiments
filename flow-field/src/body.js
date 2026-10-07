// A linked body: the flow around the geometry of another doc (a hull), derived
// from one planar section of it. Pure — no DOM, no automerge, no registry.
//
// Everything here is in the FLOATING frame (the flow doc's frame): metres, x
// toward the bow, z up, the design waterline at z = 0. A section is a set of
// closed loops in a horizontal plane z = z0 (see the scene contract, v2 §2).
// Nothing derived here is ever stored: it is rebuilt from the section at view
// and build time, so editing the hull moves the flow with it.
//
// Two models turn a section into flow:
//
//   "waterplane-2d"   Hess–Smith constant-strength SOURCE panels on the
//                     waterline outline, solved so that the normal velocity is
//                     exactly zero at every panel's midpoint. This is 2D flow
//                     past an infinitely deep prism with the waterline's shape.
//                     Sources only (no vortex panels, no Kutta condition): a
//                     hull going straight ahead is a non-lifting body, and a
//                     blunt transom has no trailing edge to put a Kutta
//                     condition on anyway. A closed source-only body is always
//                     uniquely solvable, and its net source strength comes out
//                     zero by itself, to discretisation error (tested). The price is that a hull at a
//                     leeway angle makes no lift or side force (d'Alembert).
//
//   "slender-body-3d" Slender-body theory: an axisymmetric line-source
//                     distribution on the hull's centreline in the section
//                     plane, strength q(x) = Ux · dS/dx with S(x) = π b(x)² from
//                     the section's half-breadth b(x). It is the body of
//                     revolution with the waterplane's breadth, so the section
//                     plane is its plane of symmetry ("double body"). A blunt
//                     end (a transom) is closed with a smooth dead-water
//                     region behind it (see closureLength).

import { velocityAt } from "./field.js";

export const BODY_MODELS = Object.freeze(["waterplane-2d", "slender-body-3d"]);
export const BODY_MODEL_LABELS = Object.freeze({
  "waterplane-2d": "Waterplane (2D panels)",
  "slender-body-3d": "Slender body (3D)",
});
export const DEFAULT_PANELS = 120;
export const MIN_PANELS = 16;
export const MAX_PANELS = 400;
/** The body's own induced speed is capped at this many times the reference speed (sharp corners are singular). */
export const BODY_SPEED_CAP = 10;

const TWO_PI = 2 * Math.PI;
const FOUR_PI = 4 * Math.PI;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** doc.body, validated and defaulted; null when there is no usable link. */
export function normalizeBodySpec(body) {
  if (!body || typeof body !== "object" || typeof body.url !== "string" || !body.url) return null;
  const plane =
    body.plane?.kind === "z" && Number.isFinite(body.plane.z) ? { kind: "z", z: body.plane.z } : { kind: "waterline" };
  const model = body.model === "slender-body-3d" ? "slender-body-3d" : "waterplane-2d";
  const panels = Math.max(MIN_PANELS, Math.min(MAX_PANELS, Math.round(num(body.panels, DEFAULT_PANELS))));
  return { url: body.url, plane, model, panels };
}

/**
 * The doc as a build sees it when a provider param picks the body model
 * ("doc" or anything unknown: the doc's own doc.body.model). Only the top
 * level is copied; nothing is written.
 */
export function withBodyModel(doc, model) {
  if (!doc?.body || !BODY_MODELS.includes(model) || doc.body.model === model) return doc;
  return { ...doc, body: { ...doc.body, model } };
}

/** The height of a plane in the floating frame. */
export function planeZ(plane) {
  return plane?.kind === "z" && Number.isFinite(plane.z) ? plane.z : 0;
}

// ─── loops ────────────────────────────────────────────────────────────────

/** Shoelace area; > 0 when counter-clockwise seen from +z. */
export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function perimeter(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return s;
}

/**
 * Section loops → clean closed polygons: finite points only, no repeated
 * consecutive (or end = start) points, counter-clockwise, and none that is
 * degenerate (under 3 points or next to no area). Open loops are closed by
 * joining their ends (a hull slice without a transom face is a U; closing it
 * draws the transom).
 * @returns {number[][][]} loops of [x, y]
 */
export function normalizeLoops(loops) {
  const out = [];
  let size = 0;
  const cleaned = [];
  for (const loop of Array.isArray(loops) ? loops : []) {
    const src = Array.isArray(loop) ? loop : loop?.points;
    if (!Array.isArray(src)) continue;
    const pts = [];
    for (const p of src) {
      const x = +p?.[0];
      const y = +p?.[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([x, y]);
    }
    if (pts.length < 3) continue;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of pts) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x);
      miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    }
    size = Math.max(size, maxx - minx, maxy - miny);
    cleaned.push(pts);
  }
  const eps = 1e-9 * (size || 1);
  for (const pts of cleaned) {
    const dedup = [];
    for (const p of pts) {
      const q = dedup[dedup.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) dedup.push(p);
    }
    while (dedup.length > 1 && Math.hypot(dedup[0][0] - dedup.at(-1)[0], dedup[0][1] - dedup.at(-1)[1]) <= eps) dedup.pop();
    if (dedup.length < 3) continue;
    const a = signedArea(dedup);
    if (!(Math.abs(a) > 1e-8 * size * size)) continue;
    out.push(a > 0 ? dedup : dedup.reverse());
  }
  return out;
}

function loopBox(pts) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of pts) {
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  return { minx, miny, maxx, maxy };
}

/** Even–odd point-in-polygon over several loops (so a loop inside another is a hole). */
export function pointInLoops(loops, x, y, boxes = loops.map(loopBox)) {
  let inside = false;
  for (let l = 0; l < loops.length; l++) {
    const b = boxes[l];
    if (x < b.minx || x > b.maxx || y < b.miny || y > b.maxy) continue;
    const pts = loops[l];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Split `total` into integer shares by `weights`, each at least `min`, summing
 * to exactly `total` (largest remainder). Needs weights.length · min ≤ total.
 */
export function allocate(weights, total, min = 1) {
  const n = weights.length;
  const out = new Array(n).fill(min);
  let left = total - n * min;
  if (n === 0 || left <= 0) return out;
  const W = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (!(W > 0)) {
    for (let i = 0; left > 0; i = (i + 1) % n, left--) out[i]++;
    return out;
  }
  const exact = weights.map((w) => (Math.max(0, w) * left) / W);
  const rem = [];
  exact.forEach((e, i) => {
    const f = Math.floor(e);
    out[i] += f;
    rem.push([e - f, i]);
  });
  left -= exact.reduce((a, e) => a + Math.floor(e), 0);
  rem.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < left; k++) out[rem[k % n][1]]++;
  return out;
}

/**
 * Resample a closed CCW loop to exactly `n` points (so `n` panels). Sharp
 * corners (turning more than `cornerDeg`) and the bow and stern (the points
 * of largest and smallest x) are kept exactly; between them the points are
 * cosine-spaced, which bunches them up at each end of every stretch: at the
 * stem, at the stern, and on both sides of each transom corner, where the
 * flow changes fastest. A loop with more corners than n/2 (a gear, a
 * finely faceted mesh slice) keeps only its sharpest n/2 (bow and stern
 * first), so the count never grows past the budget.
 * @param {"cosine"|"uniform"} [o.spacing="cosine"]
 */
export function resampleLoop(pts, n, { cornerDeg = 30, spacing = "cosine" } = {}) {
  const m = pts.length;
  const total = perimeter(pts);
  if (m < 3 || !(total > 0)) return pts.map((p) => [...p]);
  const target = Math.max(3, Math.round(n));
  const cosLimit = Math.cos((cornerDeg * Math.PI) / 180);
  const corners = []; // [index, cos of the turn]
  let bow = 0;
  let stern = 0;
  for (let i = 0; i < m; i++) {
    if (pts[i][0] > pts[bow][0]) bow = i;
    if (pts[i][0] < pts[stern][0]) stern = i;
    const a = pts[(i - 1 + m) % m];
    const b = pts[i];
    const c = pts[(i + 1) % m];
    const e1x = b[0] - a[0], e1y = b[1] - a[1];
    const e2x = c[0] - b[0], e2y = c[1] - b[1];
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    const cos = l1 > 0 && l2 > 0 ? (e1x * e2x + e1y * e2y) / (l1 * l2) : 1;
    if (cos < cosLimit) corners.push([i, cos]);
  }
  const breaks = new Set();
  if (spacing === "cosine") {
    breaks.add(bow);
    breaks.add(stern);
  }
  const maxBreaks = Math.max(1, Math.floor(target / 2));
  corners.sort((p, q) => p[1] - q[1] || p[0] - q[0]); // sharpest first
  for (const [i] of corners) {
    if (breaks.size >= maxBreaks) break;
    breaks.add(i);
  }
  if (breaks.size === 0) breaks.add(0);
  const bp = [...breaks].sort((a, b) => a - b);

  const chains = [];
  for (let k = 0; k < bp.length; k++) {
    const from = bp[k];
    const to = bp[(k + 1) % bp.length];
    const verts = [];
    let i = from;
    verts.push(pts[i]);
    do {
      i = (i + 1) % m;
      verts.push(pts[i]);
    } while (i !== to);
    let len = 0;
    for (let j = 1; j < verts.length; j++) len += Math.hypot(verts[j][0] - verts[j - 1][0], verts[j][1] - verts[j - 1][1]);
    chains.push({ verts, len });
  }
  // every chain gets at least its starting point; the rest go by length
  const counts = allocate(
    chains.map((c) => c.len),
    Math.max(target, chains.length),
    1,
  );
  const out = [];
  chains.forEach(({ verts, len }, ci) => {
    const count = counts[ci];
    const cum = [0];
    for (let j = 1; j < verts.length; j++) cum.push(cum[j - 1] + Math.hypot(verts[j][0] - verts[j - 1][0], verts[j][1] - verts[j - 1][1]));
    let seg = 1;
    for (let j = 0; j < count; j++) {
      const f = spacing === "cosine" ? (1 - Math.cos((Math.PI * j) / count)) / 2 : j / count;
      const s = f * len;
      if (j === 0) {
        out.push([verts[0][0], verts[0][1]]);
        continue;
      }
      while (seg < cum.length - 1 && cum[seg] < s) seg++;
      const s0 = cum[seg - 1];
      const s1 = cum[seg];
      const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
      const a = verts[seg - 1];
      const b = verts[seg];
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  });
  return out;
}

/** Is (x, y) inside one closed loop (crossing test)? */
function inLoop(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, y) to a closed loop's outline. */
function distToLoop(pts, x, y) {
  let best = Infinity;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
    const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Only the outermost loops: a loop lying inside another (the inner skin of a
 * shelled hull, a cockpit, an island within that) is not wetted by the
 * outside flow, so it is dropped. A loop is inside another when that one is
 * larger and more than half of its points are strictly within it — so loops
 * that merely touch or overlap (two parts meeting at the waterline) both stay.
 * @returns {{ loops: number[][][], holes: number }}
 */
export function outerLoops(loops) {
  const areas = loops.map((l) => Math.abs(signedArea(l)));
  const boxes = loops.map(loopBox);
  const keep = [];
  let holes = 0;
  loops.forEach((pts, i) => {
    const inner = loops.some((other, j) => {
      if (j === i || !(areas[j] > areas[i])) return false;
      const b = boxes[j];
      let n = 0;
      for (const [x, y] of pts) if (x >= b.minx && x <= b.maxx && y >= b.miny && y <= b.maxy && inLoop(other, x, y)) n++;
      return n > pts.length / 2;
    });
    if (inner) holes++;
    else keep.push(pts);
  });
  return { loops: keep, holes };
}

/** Is (x, y) inside any of these (non-nested) loops: their union. */
export function pointInAnyLoop(loops, x, y, boxes = loops.map(loopBox)) {
  for (let l = 0; l < loops.length; l++) {
    const b = boxes[l];
    if (x < b.minx || x > b.maxx || y < b.miny || y > b.maxy) continue;
    if (inLoop(loops[l], x, y)) return true;
  }
  return false;
}

/**
 * Keep the loops a panel (or segment) budget can afford: the largest (by
 * `size`) first, each getting at least `min`, and share the budget among them
 * by size. Returns the kept loops (in their original order), their shares,
 * and how many were dropped.
 */
export function budgetLoops(loops, budget, min, size) {
  const sizes = loops.map(size);
  const fit = Math.max(1, Math.floor(budget / min));
  const order = loops.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  const kept = order.slice(0, fit).sort((a, b) => a - b);
  const shares = allocate(
    kept.map((i) => sizes[i]),
    Math.max(budget, kept.length * min),
    min,
  );
  return { loops: kept.map((i) => loops[i]), shares, dropped: loops.length - kept.length };
}

// ─── Hess–Smith source panels ─────────────────────────────────────────────

/**
 * Panels from closed CCW loops of points: panel i runs from point i to i + 1,
 * with its outward normal on the right of the direction of travel.
 * `keep(ax, ay, bx, by, loopIndex)`, if given, can leave panels out.
 */
export function makePanels(loops, keep = null) {
  const segs = [];
  loops.forEach((pts, li) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!keep || keep(a[0], a[1], b[0], b[1], li)) segs.push([a, b, li]);
    }
  });
  const n = segs.length;
  const P = {
    n,
    ax: new Float64Array(n), ay: new Float64Array(n),
    len: new Float64Array(n),
    tx: new Float64Array(n), ty: new Float64Array(n),
    nx: new Float64Array(n), ny: new Float64Array(n),
    cx: new Float64Array(n), cy: new Float64Array(n),
    loop: new Int32Array(n),
  };
  segs.forEach(([a, b, li], k) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1e-12;
    P.ax[k] = a[0];
    P.ay[k] = a[1];
    P.len[k] = L;
    P.tx[k] = dx / L;
    P.ty[k] = dy / L;
    P.nx[k] = dy / L;
    P.ny[k] = -dx / L;
    P.cx[k] = a[0] + dx / 2;
    P.cy[k] = a[1] + dy / 2;
    P.loop[k] = li;
  });
  return P;
}

/**
 * Velocity at (x, y) induced by panel j with unit source strength per metre,
 * written into out[0..1]. Exact for a straight constant-strength segment:
 *   along the panel  u_ξ = ln(r₁/r₂) / 2π
 *   normal to it     u_η = β / 2π,   β = the angle the panel subtends at the point
 * β comes from one atan2 of (a × b, a · b), so it never wraps; it is π just
 * outside the panel and −π just inside. Distances are clamped a hair above
 * zero, so the endpoints (where u_ξ is log-singular) give a large, finite value.
 */
export function panelInfluence(P, j, x, y, out) {
  const L = P.len[j];
  const rx = x - P.ax[j];
  const ry = y - P.ay[j];
  const xi = rx * P.tx[j] + ry * P.ty[j];
  const eta = rx * P.nx[j] + ry * P.ny[j];
  const tiny = 1e-18 * L * L + 1e-30;
  const r1 = Math.max(tiny, xi * xi + eta * eta);
  const r2 = Math.max(tiny, (xi - L) * (xi - L) + eta * eta);
  const uXi = Math.log(r1 / r2) / (2 * TWO_PI);
  const uEta = Math.atan2(eta * L, xi * (xi - L) + eta * eta) / TWO_PI;
  out[0] = uXi * P.tx[j] + uEta * P.nx[j];
  out[1] = uXi * P.ty[j] + uEta * P.ny[j];
  return out;
}

/** Solve A x = b in place (dense, partial pivoting). Returns x (a new array). */
export function solveDense(A, b, n) {
  const M = A; // row-major n × n, overwritten
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = Math.abs(M[c * n + c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(M[r * n + c]);
      if (v > best) {
        best = v;
        p = r;
      }
    }
    if (!(best > 1e-300)) throw new Error("panel system is singular");
    if (p !== c) {
      for (let k = 0; k < n; k++) {
        const t = M[c * n + k];
        M[c * n + k] = M[p * n + k];
        M[p * n + k] = t;
      }
      const t = x[c];
      x[c] = x[p];
      x[p] = t;
    }
    const d = M[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}

/**
 * Source strengths σ (m/s) that make every panel midpoint impermeable in the
 * external flow `ext(x, y) → [u, v]` (freestream plus anything else).
 * The self-influence is exactly ½ along the normal and nothing along the panel.
 */
export function solvePanels(P, ext) {
  const n = P.n;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  const w = [0, 0];
  for (let i = 0; i < n; i++) {
    const cx = P.cx[i];
    const cy = P.cy[i];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        A[i * n + j] = 0.5;
        continue;
      }
      panelInfluence(P, j, cx, cy, w);
      A[i * n + j] = w[0] * P.nx[i] + w[1] * P.ny[i];
    }
    const [u, v] = ext(cx, cy);
    b[i] = -(u * P.nx[i] + v * P.ny[i]);
  }
  return solveDense(A, b, n);
}

/**
 * Velocity at each panel midpoint, on the fluid side: [tangential, normal]
 * components. Normal should be ~0 (it is the boundary condition); the
 * tangential speed gives the surface Cp. For tests and diagnostics.
 */
export function surfaceVelocities(P, sigma, ext) {
  const n = P.n;
  const vt = new Float64Array(n);
  const vn = new Float64Array(n);
  const w = [0, 0];
  for (let i = 0; i < n; i++) {
    const [u0, v0] = ext(P.cx[i], P.cy[i]);
    let u = u0;
    let v = v0;
    for (let j = 0; j < n; j++) {
      if (j === i) {
        u += 0.5 * sigma[j] * P.nx[j];
        v += 0.5 * sigma[j] * P.ny[j];
        continue;
      }
      panelInfluence(P, j, P.cx[i], P.cy[i], w);
      u += sigma[j] * w[0];
      v += sigma[j] * w[1];
    }
    vt[i] = u * P.tx[i] + v * P.ty[i];
    vn[i] = u * P.nx[i] + v * P.ny[i];
  }
  return { vt, vn };
}

/** Add the panels' induced velocity at (x, y) into acc[0..1]. Far panels act as point sources. */
function addPanelVelocity(P, sigma, x, y, acc) {
  const w = [0, 0];
  let u = 0;
  let v = 0;
  for (let j = 0; j < P.n; j++) {
    const s = sigma[j];
    if (s === 0) continue;
    const L = P.len[j];
    const dx = x - P.cx[j];
    const dy = y - P.cy[j];
    const r2 = dx * dx + dy * dy;
    if (r2 > 16 * L * L) {
      // a panel seen from over 4 lengths away is a point source to O((L/r)²)
      const k = (s * L) / (TWO_PI * r2);
      u += k * dx;
      v += k * dy;
      continue;
    }
    panelInfluence(P, j, x, y, w);
    u += s * w[0];
    v += s * w[1];
  }
  acc[0] = u;
  acc[1] = v;
  return acc;
}

// ─── slender body ─────────────────────────────────────────────────────────

/**
 * How far the flow closes behind a blunt end, in multiples of its half-breadth.
 * Downstream of a transom the flow separates and a region of dead water rides
 * along with the hull; slender-body practice closes the body smoothly over
 * about one and a half transom beams. A blunt end facing upstream (a barge
 * bow) gets only a short rounded cap.
 */
export const CLOSURE = Object.freeze({ downstream: 3, upstream: 0.5, stations: 12 });

/** Half-breadth b and centreline c of a loop at x, from its crossings; null when x misses it. */
function breadthAt(pts, x) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x1, y1] = pts[j];
    const [x2, y2] = pts[i];
    if (x1 === x2) continue;
    if ((x1 - x) * (x2 - x) > 0) continue;
    const y = y1 + ((x - x1) * (y2 - y1)) / (x2 - x1);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  if (!(hi >= lo)) return null;
  return { b: (hi - lo) / 2, c: (hi + lo) / 2 };
}

/**
 * The equivalent body of revolution of one loop: stations x (ascending),
 * radius r(x) = the half-breadth, centreline c(x), with blunt ends closed.
 * `ux` is the stream's component along +x (it decides which end is downstream).
 */
export function slenderProfile(pts, segments, ux) {
  let xa = Infinity;
  let xb = -Infinity;
  for (const [x] of pts) {
    if (x < xa) xa = x;
    if (x > xb) xb = x;
  }
  const L = xb - xa;
  const M = Math.max(4, Math.round(segments));
  const eps = 1e-6 * L;
  let xs = [];
  let rs = [];
  let cs = [];
  let lastC = 0;
  for (let k = 0; k <= M; k++) {
    const x = Math.min(xb - eps, Math.max(xa + eps, xa + (L * (1 - Math.cos((Math.PI * k) / M))) / 2));
    const s = breadthAt(pts, x);
    const c = s ? s.c : lastC;
    lastC = c;
    xs.push(x);
    rs.push(s ? s.b : 0);
    cs.push(c);
  }
  // pin the ends to the loop's extent
  xs[0] = xa;
  xs[M] = xb;
  const rmax = Math.max(...rs);
  const blunt = Math.max(1e-3, 0.02 * rmax);
  const closures = { aft: null, fore: null };
  for (const end of ["aft", "fore"]) {
    const i = end === "aft" ? 0 : xs.length - 1;
    const r0 = rs[i];
    if (!(r0 > blunt)) {
      rs[i] = 0; // a pointed end: exactly closed
      continue;
    }
    const downstream = end === "aft" ? ux < 0 : ux > 0;
    const Lc = (downstream ? CLOSURE.downstream : CLOSURE.upstream) * r0;
    closures[end] = { length: Lc, halfBreadth: r0, deadWater: downstream };
    const J = CLOSURE.stations;
    const dir = end === "aft" ? -1 : 1;
    const ext = [];
    for (let j = 1; j <= J; j++) {
      const s = j / J;
      // S = S0 (1 + cos(pi s)) / 2: a smooth taper to nothing
      const r = j === J ? 0 : r0 * Math.sqrt(Math.max(0, (1 + Math.cos(Math.PI * s)) / 2));
      ext.push([xs[i] + dir * s * Lc, r, cs[i]]);
    }
    if (end === "aft") ext.reverse();
    const col = (k) => ext.map((e) => e[k]);
    if (end === "aft") {
      xs = col(0).concat(xs);
      rs = col(1).concat(rs);
      cs = col(2).concat(cs);
    } else {
      xs = xs.concat(col(0));
      rs = rs.concat(col(1));
      cs = cs.concat(col(2));
    }
  }
  return { xs, rs, cs, closures, length: L, maxHalfBreadth: rmax };
}

/**
 * Line-source segments for a profile: segment k runs x_k → x_{k+1} on the
 * centreline at height z0 with q_k = ux · ΔS/Δx (m²/s, volume flux per metre).
 */
export function slenderSegments(profile, ux, z0) {
  const { xs, rs, cs } = profile;
  const n = xs.length - 1;
  const seg = { n, a: new Float64Array(n), b: new Float64Array(n), yc: new Float64Array(n), zc: z0, q: new Float64Array(n) };
  for (let k = 0; k < n; k++) {
    const dx = xs[k + 1] - xs[k];
    const S0 = Math.PI * rs[k] * rs[k];
    const S1 = Math.PI * rs[k + 1] * rs[k + 1];
    seg.a[k] = xs[k];
    seg.b[k] = xs[k + 1];
    seg.yc[k] = (cs[k] + cs[k + 1]) / 2;
    seg.q[k] = dx > 1e-12 ? (ux * (S1 - S0)) / dx : 0;
  }
  return seg;
}

/**
 * Stokes stream function of the stream plus the segments, at station x and
 * radius ρ from the axis (all segments taken on one axis):
 *   ψ = ½ ux ρ² + Σ q_k/4π (R_b − R_a),   R = √((x − s)² + ρ²)
 * The body's surface is ψ = 0 (the segments add no net flux).
 */
function streamFunction(seg, ux, x, rho) {
  let psi = 0.5 * ux * rho * rho;
  const r2 = rho * rho;
  for (let k = 0; k < seg.n; k++) {
    const q = seg.q[k];
    if (q === 0) continue;
    const da = x - seg.a[k];
    const db = x - seg.b[k];
    psi += (q / FOUR_PI) * (Math.sqrt(db * db + r2) - Math.sqrt(da * da + r2));
  }
  return psi;
}

/**
 * The radius of the dividing stream surface at each station: where the
 * line sources' own fluid meets the stream (ψ = 0). Slender-body theory
 * puts it at the nominal radius, but a finite body's lies a few per cent
 * inside (more for a stubby one); streamlines hug this surface, not the
 * nominal one, so it is what `contains` tests. Bisection, per station.
 */
export function streamSurfaceRadii(profile, seg, ux) {
  const { xs, rs } = profile;
  const out = new Float64Array(xs.length);
  if (!(Math.abs(ux) > 1e-12)) {
    out.set(rs);
    return out;
  }
  const rmax = Math.max(1e-6, ...rs);
  const sgn = Math.sign(ux);
  for (let i = 0; i < xs.length; i++) {
    if (!(rs[i] > 0)) continue;
    const x = xs[i];
    let lo = 1e-9 * rmax;
    let hi = Math.max(2 * rs[i], 0.25 * rmax);
    let grow = 0;
    while (sgn * streamFunction(seg, ux, x, hi) <= 0 && grow++ < 20) hi *= 2;
    if (sgn * streamFunction(seg, ux, x, lo) >= 0) {
      out[i] = 0; // no source fluid here (the tip of a pointed end)
      continue;
    }
    for (let it = 0; it < 40; it++) {
      const mid = 0.5 * (lo + hi);
      if (sgn * streamFunction(seg, ux, x, mid) > 0) hi = mid;
      else lo = mid;
    }
    out[i] = 0.5 * (lo + hi);
  }
  return out;
}

/**
 * Add a line-source segment set's velocity at (x, y, z). A constant-strength
 * segment on a line parallel to x, from a to b, at radial distance ρ:
 *   u_x = q/4π (1/r_b − 1/r_a)
 *   u_ρ = q/(4πρ) ((b − x)/r_b − (a − x)/r_a)
 */
function addSegmentVelocity(seg, x, y, z, acc) {
  let u = 0;
  let v = 0;
  let w = 0;
  const dzc = z - seg.zc;
  for (let k = 0; k < seg.n; k++) {
    const q = seg.q[k];
    if (q === 0) continue;
    const dy = y - seg.yc[k];
    const a0 = seg.a[k];
    const b0 = seg.b[k];
    const len = b0 - a0;
    const mx = x - 0.5 * (a0 + b0);
    const d2 = mx * mx + dy * dy + dzc * dzc;
    if (d2 > 16 * len * len) {
      // seen from over 4 lengths away, a segment is a point source of flux q·len, to O((len/r)²)
      const kf = (q * len) / (FOUR_PI * d2 * Math.sqrt(d2));
      u += kf * mx;
      v += kf * dy;
      w += kf * dzc;
      continue;
    }
    const rho0 = Math.sqrt(dy * dy + dzc * dzc);
    const rho = Math.max(1e-6, rho0);
    const a = a0;
    const b = b0;
    const ra = Math.sqrt((x - a) * (x - a) + rho * rho);
    const rb = Math.sqrt((x - b) * (x - b) + rho * rho);
    const K = q / FOUR_PI;
    u += K * (1 / rb - 1 / ra);
    if (rho0 > 0) {
      const ur = (K / rho) * ((b - x) / rb - (a - x) / ra);
      v += (ur * dy) / rho0;
      w += (ur * dzc) / rho0;
    }
  }
  acc[0] = u;
  acc[1] = v;
  acc[2] = w;
  return acc;
}

function profileContains(profile, x, y, z, z0) {
  const { xs, cs } = profile;
  const rs = profile.surface ?? profile.rs;
  if (x < xs[0] || x > xs[xs.length - 1]) return false;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = xs[hi] > xs[lo] ? (x - xs[lo]) / (xs[hi] - xs[lo]) : 0;
  const r = rs[lo] + t * (rs[hi] - rs[lo]);
  const c = cs[lo] + t * (cs[hi] - cs[lo]);
  const dy = y - c;
  const dz = z - z0;
  return dy * dy + dz * dz < r * r;
}

// ─── compiled body ────────────────────────────────────────────────────────

const EMPTY_BODY = Object.freeze({
  add() {},
  contains: () => false,
  outlineAt: () => [],
});

/**
 * A slender body's cut at height z, as polygons: at each station the body of
 * revolution (the radii `contains` tests) is c ± √(r² − (z − z0)²) across, so
 * one side runs bow-ward and the other back. It is exact at the stations and
 * linear between them, which is what the editor fills to cover the inside.
 * @returns {number[][][]}
 */
export function slenderOutlineAt(profiles, z, z0) {
  const dz = z - z0;
  const out = [];
  for (const profile of profiles) {
    const { xs, cs } = profile;
    const rs = profile.surface ?? profile.rs;
    const lower = [];
    const upper = [];
    for (let i = 0; i < xs.length; i++) {
      const w2 = rs[i] * rs[i] - dz * dz;
      const w = w2 > 0 ? Math.sqrt(w2) : 0;
      lower.push([xs[i], cs[i] - w]);
      upper.push([xs[i], cs[i] + w]);
    }
    if (!lower.some((p, i) => upper[i][1] - p[1] > 0)) continue;
    out.push(lower.concat(upper.reverse())); // counter-clockwise: stern to bow on −y, back on +y
  }
  return out;
}

/** Panels fewer than this per loop can't outline it; loops past what the budget allows at this are dropped. */
export const MIN_LOOP_PANELS = 6;
export const MIN_LOOP_SEGMENTS = 4;
/** A slender body is one hull per loop (a catamaran, a trimaran); past this many the smallest are dropped. */
export const MAX_SLENDER_LOOPS = 8;
/** The panel solve is suspect when a strength exceeds this many times the largest normal inflow. */
export const SIGMA_LIMIT = 1e3;
/** How many heights a waterplane body keeps a panel solution for (see compileBody). */
const HEIGHT_CACHE = 16;

/** A body that adds nothing, with the reason it isn't there. */
function failedBody(common, reason) {
  return { ...EMPTY_BODY, ...common, empty: true, failed: reason, info: { model: common.model, loops: 0, panels: 0, warnings: [] } };
}

/**
 * Turn a section into a body the field can evaluate.
 * @param {object} section  a SectionResult (loops in the floating frame)
 * @param {object} spec     normalizeBodySpec(doc.body)
 * @param {object} base     compileField(doc): the freestream and the user's elements
 * @returns {{ model, z0, loops, add(x,y,z,acc), contains(x,y,z), info }}
 *          `add` adds the body's velocity into acc[0..2]. When the section
 *          can't be made into a sound body, the result adds nothing, has
 *          `failed` (why), and `empty`.
 */
export function compileBody(section, spec, base) {
  const model = spec?.model === "slender-body-3d" ? "slender-body-3d" : "waterplane-2d";
  const panels = Math.max(MIN_PANELS, Math.min(MAX_PANELS, Math.round(num(spec?.panels, DEFAULT_PANELS))));
  const z0 = num(section?.plane?.z, planeZ(spec?.plane));
  const all = normalizeLoops(section?.loops);
  // holes (an inner skin, a cockpit) aren't wetted: the outside flow sees only the outermost loops
  const { loops: outer, holes } = outerLoops(all);
  const Uref = base.U > 1e-9 ? base.U : 1;
  const cap = BODY_SPEED_CAP * Uref;
  const warnings = [];
  if (holes) warnings.push(`${holes} inner loop${holes === 1 ? "" : "s"} (holes) ignored`);
  const common = { model, z0, loops: outer, panelsRequested: panels };
  if (!outer.length) return { ...EMPTY_BODY, ...common, empty: true, info: { model, loops: 0, panels: 0, warnings } };
  const boxes = outer.map(loopBox);

  const capAdd = (acc, u, v, w) => {
    const s = Math.hypot(u, v, w);
    if (!Number.isFinite(s)) return; // a NaN from a degenerate spot: leave the body out there
    const f = s > cap ? cap / s : 1;
    acc[0] += u * f;
    acc[1] += v * f;
    acc[2] += w * f;
  };

  if (model === "waterplane-2d") {
    const budget = budgetLoops(outer, panels, MIN_LOOP_PANELS, perimeter);
    if (budget.dropped) warnings.push(`${budget.dropped} smallest loop${budget.dropped === 1 ? "" : "s"} dropped to stay within ${panels} panels`);
    const loops = budget.loops;
    const lboxes = loops.map(loopBox);
    const size = Math.max(...lboxes.map((b) => Math.max(b.maxx - b.minx, b.maxy - b.miny)));
    const onTol = 1e-6 * size;
    const resampled = loops.map((pts, i) => resampleLoop(pts, budget.shares[i]));
    // Where loops touch or overlap (two parts meeting at the waterline), the
    // panels inside or on another loop are interior to their union: drop them,
    // so what is left outlines the union (and the system isn't singular).
    let merged = 0;
    const pan = makePanels(resampled, (ax, ay, bx, by, li) => {
      const mx = 0.5 * (ax + bx);
      const my = 0.5 * (ay + by);
      for (let l = 0; l < loops.length; l++) {
        if (l === li) continue;
        const b = lboxes[l];
        if (mx < b.minx - onTol || mx > b.maxx + onTol || my < b.miny - onTol || my > b.maxy + onTol) continue;
        if (inLoop(loops[l], mx, my) || distToLoop(loops[l], mx, my) <= onTol) {
          merged++;
          return false;
        }
      }
      return true;
    });
    if (merged) warnings.push(`touching loops merged (${merged} shared panel${merged === 1 ? "" : "s"} dropped)`);
    if (pan.n < 3) return failedBody(common, "the section's loops leave no outline to put panels on");

    // The doc's own point elements are 3D, so the inflow the panels must
    // cancel differs with height: solve per height (lazily, a few kept).
    // Without them the inflow is the same at every height: one solve.
    const layered = base.elements.some((e) => e.kind !== "vortex-line");
    const solveAt = (z) => {
      const V = [0, 0, 0];
      let bmax = 0;
      const ext = (x, y) => {
        velocityAt(base, x, y, z, V);
        return [V[0], V[1]];
      };
      let sigma;
      try {
        sigma = solvePanels(pan, ext);
      } catch (err) {
        return { error: String(err?.message ?? err) };
      }
      for (let i = 0; i < pan.n; i++) {
        ext(pan.cx[i], pan.cy[i]);
        bmax = Math.max(bmax, Math.abs(V[0] * pan.nx[i] + V[1] * pan.ny[i]));
      }
      let smax = 0;
      let finite = true;
      for (let j = 0; j < pan.n; j++) {
        if (!Number.isFinite(sigma[j])) finite = false;
        smax = Math.max(smax, Math.abs(sigma[j]));
      }
      if (!finite || smax > SIGMA_LIMIT * Math.max(bmax, 1e-9 * Uref)) {
        return { error: "the panel system is ill-conditioned (overlapping or degenerate loops?)" };
      }
      return { sigma };
    };
    const first = solveAt(z0);
    if (first.error) return failedBody(common, first.error);
    const sigma0 = first.sigma;
    let net = 0;
    for (let j = 0; j < pan.n; j++) net += sigma0[j] * pan.len[j];
    const byZ = new Map([[z0, sigma0]]);
    const sigmaAt = (z) => {
      if (!layered) return sigma0;
      const key = Math.round(z * 1000) / 1000; // to the millimetre
      let s = byZ.get(key);
      if (s) {
        byZ.delete(key);
        byZ.set(key, s); // most recently used last
        return s;
      }
      const r = solveAt(key);
      s = r.sigma ?? sigma0;
      byZ.set(key, s);
      while (byZ.size > HEIGHT_CACHE) byZ.delete(byZ.keys().next().value);
      return s;
    };
    const tmp = [0, 0];
    return {
      ...common,
      panelLoops: resampled,
      panels: pan,
      sigma: sigma0,
      sigmaAt,
      add(x, y, z, acc) {
        addPanelVelocity(pan, sigmaAt(z), x, y, tmp);
        capAdd(acc, tmp[0], tmp[1], 0);
      },
      contains: (x, y) => pointInAnyLoop(outer, x, y, boxes),
      // the same at every height: a waterplane body is a vertical prism
      outlineAt: () => outer,
      info: { model, loops: loops.length, panels: pan.n, netSource: net, perHeight: layered, warnings },
    };
  }

  // slender body: the stream's component along the hull axis
  const ux = base.U * base.dx;
  const budget = budgetLoops(outer, panels, Math.max(MIN_LOOP_SEGMENTS, Math.ceil(panels / MAX_SLENDER_LOOPS)), (pts) => {
    const b = loopBox(pts);
    return b.maxx - b.minx;
  });
  if (budget.dropped) warnings.push(`${budget.dropped} smallest loop${budget.dropped === 1 ? "" : "s"} dropped to stay within ${panels} segments`);
  const perLoop = budget.loops.map((pts, i) => {
    const profile = slenderProfile(pts, budget.shares[i], ux);
    const seg = slenderSegments(profile, ux, z0);
    profile.surface = streamSurfaceRadii(profile, seg, ux);
    return { profile, seg };
  });
  const tmp = [0, 0, 0];
  let net = 0;
  for (const { seg } of perLoop) for (let k = 0; k < seg.n; k++) net += seg.q[k] * (seg.b[k] - seg.a[k]);
  return {
    ...common,
    loops: budget.loops,
    profiles: perLoop.map((p) => p.profile),
    segments: perLoop.map((p) => p.seg),
    add(x, y, z, acc) {
      let u = 0, v = 0, w = 0;
      for (const { seg } of perLoop) {
        addSegmentVelocity(seg, x, y, z, tmp);
        u += tmp[0];
        v += tmp[1];
        w += tmp[2];
      }
      capAdd(acc, u, v, w);
    },
    contains: (x, y, z) => perLoop.some(({ profile }) => profileContains(profile, x, y, z, z0)),
    outlineAt: (z) => slenderOutlineAt(perLoop.map((p) => p.profile), z, z0),
    info: {
      model,
      loops: perLoop.length,
      segments: perLoop.reduce((a, p) => a + p.seg.n, 0),
      netSource: net,
      closures: perLoop.map((p) => p.profile.closures),
      warnings,
    },
  };
}

/**
 * The slender body as ordinary point elements, for unlinking: each run of
 * segments becomes one point source or sink carrying the run's total flux
 * (m³/s) at its flux-weighted centre. Runs never mix signs, and there are at
 * most `max` of them per loop.
 * @returns {{ [id]: { kind, position, strength } }}
 */
export function snapshotElements(body, { max = 32, taken = {}, prefix = "hull" } = {}) {
  const out = {};
  if (body?.model !== "slender-body-3d" || !body.segments) return out;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  let n = 0;
  body.segments.forEach((seg, li) => {
    const group = Math.max(1, Math.ceil(seg.n / max));
    let run = null;
    const flush = () => {
      if (!run || !(Math.abs(run.flux) > 1e-9)) return (run = null);
      const x = run.wx / run.w;
      const y = run.wy / run.w;
      let id;
      do id = `${prefix}-${li > 0 ? `${li + 1}-` : ""}${String(++n).padStart(2, "0")}`;
      while (id in taken || id in out);
      out[id] = {
        kind: run.flux > 0 ? "source" : "sink",
        position: [r3(x), r3(y), r3(seg.zc)],
        strength: r4(Math.abs(run.flux)),
      };
      run = null;
    };
    for (let k = 0; k < seg.n; k++) {
      const flux = seg.q[k] * (seg.b[k] - seg.a[k]);
      if (flux === 0) continue;
      const sign = Math.sign(flux);
      if (run && (run.sign !== sign || run.count >= group)) flush();
      run ??= { sign, flux: 0, w: 0, wx: 0, wy: 0, count: 0 };
      const a = Math.abs(flux);
      run.flux += flux;
      run.w += a;
      run.wx += a * (seg.a[k] + seg.b[k]) * 0.5;
      run.wy += a * seg.yc[k];
      run.count++;
    }
    flush();
  });
  return out;
}
