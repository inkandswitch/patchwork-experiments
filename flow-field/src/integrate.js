// Streamlines through a compiled field (see field.js). Pure.
//
// A streamline is integrated in arc length, dx/ds = V/|V|, with classical RK4,
// so a fixed `step` is a fixed distance in metres whatever the local speed.
// It stops when it leaves the domain (the last point is clipped onto the
// boundary), reaches a stagnation point, runs into a point singularity or a
// vortex core, or uses up `maxSteps`.

import { velocityAt, cpFromSpeed, emission } from "./field.js";

export const DEFAULT_TRACE = Object.freeze({ step: 0.1, maxSteps: 600 });

function inside(domain, x, y, z) {
  const { min, max } = domain;
  return x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2];
}

/** Fraction t ∈ [0,1] along a→b where the segment first leaves the box (a is inside). */
function exitFraction(domain, a, b) {
  let t = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (d > 0 && b[k] > domain.max[k]) t = Math.min(t, (domain.max[k] - a[k]) / d);
    else if (d < 0 && b[k] < domain.min[k]) t = Math.min(t, (domain.min[k] - a[k]) / d);
  }
  return Math.max(0, t);
}

/**
 * Integrate one streamline.
 * @param {object} field      from compileField
 * @param {number[]} seed     [x, y, z]
 * @param {object} [o]
 * @param {number} [o.step=0.1]        arc length per step, m
 * @param {number} [o.maxSteps=600]
 * @param {1|-1} [o.direction=1]       −1 integrates upstream
 * @param {boolean} [o.planar=false]   ignore the vertical velocity (a 2D view of a slice)
 * @param {number} [o.captureRadius]   stop this close to a singularity (default 1.5 × step)
 * @param {number} [o.minSpeed]        stagnation threshold, m/s (default 1e-3 × reference speed)
 * @returns {{ points: number[][], speeds: number[], cps: number[],
 *             end: "domain"|"stagnation"|"singularity"|"steps"|"outside"|"body",
 *             endElement: number | null }}
 *   "body": it ran into a linked body (field.body, see body.js), which a
 *   streamline of an exact solution never does; it is a guard for stagnation
 *   points and sharp corners, where a finite step can cut inside.
 */
export function traceStreamline(field, seed, o = {}) {
  const step = o.step > 0 ? o.step : DEFAULT_TRACE.step;
  const maxSteps = Number.isInteger(o.maxSteps) && o.maxSteps >= 0 ? o.maxSteps : DEFAULT_TRACE.maxSteps;
  const dir = o.direction === -1 ? -1 : 1;
  const planar = !!o.planar;
  const capture = o.captureRadius ?? step * 1.5;
  const capture2 = capture * capture;
  const minSpeed = o.minSpeed ?? 1e-3 * (field.U > 1e-9 ? field.U : 1);
  const domain = o.domain ?? field.domain;
  const els = field.elements;
  const body = field.body ?? null;

  const points = [];
  const speeds = [];
  const cps = [];
  const V = [0, 0, 0];

  let x = seed[0];
  let y = seed[1];
  let z = seed[2];
  if (!inside(domain, x, y, z)) return { points, speeds, cps, end: "outside", endElement: null };
  if (body?.contains(x, y, z)) return { points, speeds, cps, end: "body", endElement: null };

  const push = (px, py, pz) => {
    velocityAt(field, px, py, pz, V);
    if (planar) V[2] = 0;
    const s = Math.hypot(V[0], V[1], V[2]);
    points.push([px, py, pz]);
    speeds.push(s);
    cps.push(cpFromSpeed(field, s));
  };

  // unit tangent, or null at stagnation
  const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0], prev = [0, 0, 0];
  const tangent = (px, py, pz, out) => {
    velocityAt(field, px, py, pz, out);
    if (planar) out[2] = 0;
    const s = Math.hypot(out[0], out[1], out[2]);
    if (!(s > minSpeed)) return false;
    const f = dir / s;
    out[0] *= f;
    out[1] *= f;
    out[2] *= f;
    return true;
  };

  // A point singularity wins over a vortex line when both are in range: the
  // point one says where the fluid came from, the vortex only that it swirls.
  const nearSingularity = (px, py, pz) => {
    let vortex = -1;
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const ex = px - e.x;
      const ey = py - e.y;
      if (e.kind === "vortex-line") {
        if (vortex < 0 && ex * ex + ey * ey < capture2) vortex = i;
      } else {
        const ez = pz - e.z;
        if (ex * ex + ey * ey + ez * ez < capture2) return i;
      }
    }
    return vortex;
  };

  push(x, y, z);
  // A seed next to a point singularity may leave it (a forward trace out of a
  // source), but one heading INTO it has arrived: a step longer than the
  // distance would overshoot the singularity, flip the tangent and read as a
  // stagnation point, which is how a point beside a source used to test as
  // outside its own body.
  const start = nearSingularity(x, y, z);
  if (start >= 0 && els[start].kind !== "vortex-line") {
    const e = els[start];
    const ex = e.x - x;
    const ey = e.y - y;
    const ez = planar ? 0 : e.z - z;
    const d2 = ex * ex + ey * ey + ez * ez;
    const heading = tangent(x, y, z, k1) ? k1[0] * ex + k1[1] * ey + k1[2] * ez : 0;
    if (d2 < 1e-12 || heading > 0) return { points, speeds, cps, end: "singularity", endElement: start };
  }
  for (let n = 0; n < maxSteps; n++) {
    // not at n = 0: a seed that starts next to a singularity is allowed to leave it
    const hit = n > 0 ? nearSingularity(x, y, z) : -1;
    if (hit >= 0) return { points, speeds, cps, end: "singularity", endElement: hit };
    const h = step;
    if (!tangent(x, y, z, k1)) return { points, speeds, cps, end: "stagnation", endElement: null };
    // stepped over a stagnation point: the tangent flips; stop instead of dithering
    if (n > 0 && k1[0] * prev[0] + k1[1] * prev[1] + k1[2] * prev[2] < 0)
      return { points, speeds, cps, end: "stagnation", endElement: null };
    prev[0] = k1[0];
    prev[1] = k1[1];
    prev[2] = k1[2];
    if (!tangent(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], z + 0.5 * h * k1[2], k2))
      return { points, speeds, cps, end: "stagnation", endElement: null };
    if (!tangent(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], z + 0.5 * h * k2[2], k3))
      return { points, speeds, cps, end: "stagnation", endElement: null };
    if (!tangent(x + h * k3[0], y + h * k3[1], z + h * k3[2], k4))
      return { points, speeds, cps, end: "stagnation", endElement: null };
    let nx = x + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    let ny = y + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    let nz = z + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    if (planar) nz = z;
    // the RK stages cancelled out: we are sitting on a stagnation point
    if (Math.hypot(nx - x, ny - y, nz - z) < 0.25 * h)
      return { points, speeds, cps, end: "stagnation", endElement: null };
    if (!inside(domain, nx, ny, nz)) {
      const t = exitFraction(domain, [x, y, z], [nx, ny, nz]);
      push(x + t * (nx - x), y + t * (ny - y), z + t * (nz - z));
      return { points, speeds, cps, end: "domain", endElement: null };
    }
    if (body?.contains(nx, ny, nz)) return { points, speeds, cps, end: "body", endElement: null };
    x = nx;
    y = ny;
    z = nz;
    push(x, y, z);
  }
  return { points, speeds, cps, end: "steps", endElement: null };
}

/**
 * Seed points on a rake across the upstream face of the domain: `count` seeds
 * per row, evenly spread perpendicular to the stream (horizontally), in `rows`
 * rows at heights `height`, `height − rowSpacing`, … (rows outside the domain
 * are skipped). Each seed sits just inside the box where a line parallel to the
 * stream enters it, so this works for any heading.
 * @returns {number[][]} [[x, y, z], …]
 */
export function rakeSeeds(field, { count = 15, height = 0, rows = 1, rowSpacing = 0.5, inset } = {}) {
  const { min, max } = field.domain;
  const dx = field.dx;
  const dy = field.dy;
  const px = -dy;
  const py = dx;
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  let smin = Infinity;
  let smax = -Infinity;
  for (const X of [min[0], max[0]])
    for (const Y of [min[1], max[1]]) {
      const s = (X - cx) * px + (Y - cy) * py;
      smin = Math.min(smin, s);
      smax = Math.max(smax, s);
    }
  const n = Math.max(0, Math.floor(count));
  const r = Math.max(1, Math.floor(rows));
  const eps = inset ?? 1e-6 * Math.max(max[0] - min[0], max[1] - min[1]);
  const seeds = [];
  for (let j = 0; j < r; j++) {
    const z = height - j * rowSpacing;
    if (z < min[2] || z > max[2]) continue;
    for (let i = 0; i < n; i++) {
      const s = smin + ((i + 0.5) / n) * (smax - smin);
      const ox = cx + s * px;
      const oy = cy + s * py;
      // slab intersection of the line o + t·d with the horizontal box
      let t0 = -Infinity;
      let t1 = Infinity;
      let ok = true;
      for (const [o, d, lo, hi] of [
        [ox, dx, min[0], max[0]],
        [oy, dy, min[1], max[1]],
      ]) {
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) ok = false;
          continue;
        }
        let a = (lo - o) / d;
        let b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (!ok || !(t1 > t0)) continue;
      const t = t0 + Math.min(eps, (t1 - t0) / 2);
      seeds.push([ox + t * dx, oy + t * dy, z]);
    }
  }
  return seeds;
}

/**
 * Is this point inside a closed (or half-) body, i.e. is the fluid here fluid
 * that came out of a source (or circulates around a doublet) rather than fluid
 * that arrived with the stream? Answered by tracing upstream: body fluid leads
 * back to an emitting singularity, stream fluid leads back to the boundary.
 */
export function isInsideBody(field, point, o = {}) {
  // a linked body is geometry: inside it is exact (point-in-polygon, or the
  // body of revolution's radius), no tracing needed
  if (field.body?.contains(point[0], point[1], point[2])) return true;
  const opts = {
    step: o.step ?? 0.2,
    maxSteps: o.maxSteps ?? 400,
    planar: o.planar,
    captureRadius: o.captureRadius,
  };
  const back = traceStreamline(field, point, { ...opts, direction: -1 });
  if (back.end === "singularity") {
    const e = field.elements[back.endElement];
    if (e.kind === "vortex-line") return vortexCaptureInsideBody(field, back.points.at(-1), opts);
    const emits = e.kind === "doublet" || emission(e) > 0;
    // Stream fluid just off the axis of a wake rides the dividing streamline:
    // upstream past the rear stagnation point, along the body, into the front
    // one — where a coarse step cuts the corner and lands on the source. Body
    // fluid never passes a stagnation point on its way back to a source, so a
    // trace that slowed right down and sped up again proves nothing; ask where
    // the fluid goes instead (body fluid ends in a sink or doublet).
    if (emits && passedStagnation(back.speeds, field.U)) return endsInAbsorber(field, point, opts);
    return emits;
  }
  // Right behind a sink, body fluid curls back into it past the rear
  // stagnation point, and a coarse upstream trace lands on that point instead
  // of going round. Stream fluid only reaches a stagnation point on the
  // dividing streamline itself, so: a stagnation point behind, and a sink or
  // doublet ahead, means body.
  if (back.end !== "stagnation") return false;
  return endsInAbsorber(field, point, opts);
}

function endsInAbsorber(field, point, opts) {
  const fwd = traceStreamline(field, point, opts);
  if (fwd.end !== "singularity") return false;
  const e = field.elements[fwd.endElement];
  return e.kind === "doublet" || emission(e) < 0;
}

/**
 * Did the trace slow to under half the free-stream speed somewhere in the
 * middle (fast before and after)? That is a stagnation point passed on the
 * way. Speeding up towards a singularity at the end, or starting slow next to
 * a stagnation point, does not count.
 */
export function passedStagnation(speeds, U) {
  if (!(U > 1e-9)) return false;
  const slow = 0.5 * U;
  let fast = false;
  let dipped = false;
  for (const s of speeds) {
    if (s >= slow) {
      if (dipped) return true;
      fast = true;
    } else if (fast) dipped = true;
  }
  return false;
}

/**
 * An upstream trace that ends on a vortex line says nothing about where the
 * fluid came from: near its axis a vortex only swirls it round. Whatever region
 * the axis passes through at that height, the swirl belongs to, so ask the same
 * question at the capture point of the flow with the vortex lines taken out
 * (they add no flux, so they don't move sources' fluid from one region to
 * another, only reshape the boundary a little).
 */
function vortexCaptureInsideBody(field, point, opts) {
  const points = field.elements.filter((e) => e.kind !== "vortex-line");
  if (points.length === 0) return false;
  return isInsideBody({ ...field, elements: points }, point, opts);
}

/**
 * Seeds for streamlines that hug a linked body (field.body): `count` per side,
 * just outside its widest points across the stream (the points of its cut at
 * this height, body.outlineAt, furthest to either side of the stream direction), at distances that grow
 * geometrically from `first` (default 1.5% of the body's width across the
 * stream) by `ratio`. A rake on the upstream face can't do this: a streamline
 * that passes the hull 2 cm off starts within a few centimetres of the
 * dividing streamline, which evenly spaced seeds almost never hit. Traced
 * both ways from these seeds (traceThrough), they pass the body at exactly
 * those distances where it is widest.
 * @returns {{ seed: number[], side: 1 | -1, offset: number }[]}
 */
export function bodyHugSeeds(field, { count = 3, height = 0, first, ratio = 3 } = {}) {
  const body = field?.body;
  const n = Math.max(0, Math.floor(count));
  if (!body || body.empty || !n) return [];
  // the body's own cut at this height: for a slender body that is the stream
  // surface its line sources make, which is not quite the section it came from
  const cut = typeof body.outlineAt === "function" ? body.outlineAt(height) : body.loops;
  if (!Array.isArray(cut) || !cut.length) return [];
  const px = -field.dy;
  const py = field.dx;
  let hi = null;
  let lo = null;
  for (const loop of cut)
    for (const p of loop) {
      const s = p[0] * px + p[1] * py;
      if (!hi || s > hi.s) hi = { s, p };
      if (!lo || s < lo.s) lo = { s, p };
    }
  const width = hi.s - lo.s;
  if (!(width > 0)) return [];
  const d0 = first > 0 ? first : 0.015 * width;
  const { min, max } = field.domain;
  const seeds = [];
  for (const [side, at] of [
    [1, hi.p],
    [-1, lo.p],
  ])
    for (let k = 0; k < n; k++) {
      const offset = d0 * ratio ** k;
      const seed = [at[0] + side * offset * px, at[1] + side * offset * py, height];
      if (seed[0] < min[0] || seed[0] > max[0] || seed[1] < min[1] || seed[1] > max[1] || height < min[2] || height > max[2]) continue;
      if (body.contains(seed[0], seed[1], seed[2])) continue;
      seeds.push({ seed, side, offset });
    }
  return seeds;
}

/**
 * The whole streamline through a point: traced upstream and downstream from
 * it and joined, in the direction of the flow. `end` is how the downstream
 * half ended.
 */
export function traceThrough(field, seed, o = {}) {
  const fwd = traceStreamline(field, seed, { ...o, direction: 1 });
  const back = traceStreamline(field, seed, { ...o, direction: -1 });
  if (!back.points.length) return fwd;
  if (!fwd.points.length) return { ...back, points: back.points.slice().reverse(), speeds: back.speeds.slice().reverse(), cps: back.cps.slice().reverse() };
  const rev = (a) => a.slice(1).reverse();
  return {
    points: rev(back.points).concat(fwd.points),
    speeds: rev(back.speeds).concat(fwd.speeds),
    cps: rev(back.cps).concat(fwd.cps),
    end: fwd.end,
    endElement: fwd.endElement,
  };
}

/**
 * The domain widened across the stream by `fraction` of its size on each side
 * (not along it), for tracing: a streamline pushed sideways by a body keeps
 * going to the downstream face instead of stopping where it crosses the side.
 */
export function widenAcross(field, fraction = 0.25) {
  const { min, max } = field.domain;
  const ax = Math.abs(field.dy) * fraction * (max[0] - min[0]);
  const ay = Math.abs(field.dx) * fraction * (max[1] - min[1]);
  return { min: [min[0] - ax, min[1] - ay, min[2]], max: [max[0] + ax, max[1] + ay, max[2]] };
}
