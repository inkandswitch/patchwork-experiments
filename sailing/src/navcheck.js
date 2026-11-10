// Checking a baked navmesh (DESIGN.md, "Verification"). Pure. Two kinds of
// check, both finite:
// - the oracle: questions asked of the raw triangles, never of the mesh (is
//   anything inside this body's cylinder? is there a triangle under these
//   feet?), so a fault in the bake's rasteriser shows up as a disagreement;
// - the static checks C1–C9 over a whole baked hull: every cell, every side,
//   every link.
// Used by the unit tests, the property test (walker.property.slow.test.js), the
// sloop's static checks (sloop-navmesh.test.js) and the camber probe.

import { DIRS, NONE, OPEN, OVERBOARD, STEP, WALL, apexOf, bake, cellRange, columnAt, pointOf, sideBase, surfaceAt } from "./navmesh.js";
import { localFeet } from "./walker.js";

const SUPPORT = 0.002; // feet within 2 mm of a triangle under them
const SLACK = 1e-6;

// ─── the triangles, bucketed in plan ────────────────────────────────────────

/** A plan grid of buckets over triangles (9 numbers each), for the oracle. */
export function indexTriangles(triangles, size = 0.5) {
  const T = Float64Array.from(triangles);
  const n = Math.floor(T.length / 9);
  const buckets = new Map();
  const key = (i, k) => i * 100003 + k;
  let ymax = -Infinity;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const x0 = Math.min(T[o], T[o + 3], T[o + 6]);
    const x1 = Math.max(T[o], T[o + 3], T[o + 6]);
    const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]);
    const z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
    ymax = Math.max(ymax, T[o + 1], T[o + 4], T[o + 7]);
    for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++) {
      for (let k = Math.floor(z0 / size); k <= Math.floor(z1 / size); k++) {
        const b = buckets.get(key(i, k));
        if (b) b.push(t);
        else buckets.set(key(i, k), [t]);
      }
    }
  }
  const near = (x0, z0, x1, z1) => {
    const out = new Set();
    for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++) for (let k = Math.floor(z0 / size); k <= Math.floor(z1 / size); k++) for (const t of buckets.get(key(i, k)) ?? []) out.add(t);
    return out;
  };
  return { T, n, near, ymax, size };
}

/** A triangle clipped to the slab y0 ≤ y ≤ y1: its polygon's plan points [x, z, …], or null. */
function slab(T, o, y0, y1) {
  let poly = [[T[o], T[o + 1], T[o + 2]], [T[o + 3], T[o + 4], T[o + 5]], [T[o + 6], T[o + 7], T[o + 8]]];
  for (const [lim, keepAbove] of [[y0, true], [y1, false]]) {
    const out = [];
    for (let a = 0; a < poly.length; a++) {
      const S = poly[(a + poly.length - 1) % poly.length];
      const E = poly[a];
      const sIn = keepAbove ? S[1] >= lim : S[1] <= lim;
      const eIn = keepAbove ? E[1] >= lim : E[1] <= lim;
      if (sIn !== eIn) {
        const t = (lim - S[1]) / (E[1] - S[1]);
        out.push([S[0] + (E[0] - S[0]) * t, lim, S[2] + (E[2] - S[2]) * t]);
      }
      if (eIn) out.push(E);
    }
    poly = out;
    if (!poly.length) return null;
  }
  return poly;
}

/** Plan distance from q to a polygon's plan projection (0 inside it). */
function planDistance(q, poly) {
  const n = poly.length;
  if (n === 1) return Math.hypot(q[0] - poly[0][0], q[1] - poly[0][2]);
  let best = Infinity;
  let inside = n >= 3;
  let sign = 0;
  for (let a = 0; a < n; a++) {
    const P = poly[a];
    const Q = poly[(a + 1) % n];
    const ex = Q[0] - P[0];
    const ez = Q[2] - P[2];
    const l2 = ex * ex + ez * ez;
    const s = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - P[0]) * ex + (q[1] - P[2]) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(q[0] - (P[0] + ex * s), q[1] - (P[2] + ez * s)));
    const cr = ex * (q[1] - P[2]) - ez * (q[0] - P[0]);
    if (Math.abs(cr) > 1e-15) {
      const sg = Math.sign(cr);
      if (sign === 0) sign = sg;
      else if (sg !== sign) inside = false;
    }
  }
  return inside && sign !== 0 ? 0 : best;
}

/**
 * Does any triangle meet the vertical cylinder about plan point q, radius r,
 * from y0 to y1 (open by a hair at every end, so touching isn't meeting)?
 * @returns {number | null}  the first triangle met, or null
 */
export function meets(index, q, y0, y1, r) {
  const { T } = index;
  for (const t of index.near(q[0] - r, q[1] - r, q[0] + r, q[1] + r)) {
    const o = t * 9;
    const lo = Math.min(T[o + 1], T[o + 4], T[o + 7]);
    const hi = Math.max(T[o + 1], T[o + 4], T[o + 7]);
    if (hi <= y0 + SLACK || lo >= y1 - SLACK) continue;
    const poly = slab(T, o, y0 + SLACK, y1 - SLACK);
    if (poly && planDistance(q, poly) < r - SLACK) return t;
  }
  return null;
}

/** Is there a triangle with a point over the closed square [x0, x1] × [z0, z1] at a height in [ya, yb]? */
export function supported(index, [x0, z0, x1, z1], ya, yb) {
  const { T } = index;
  for (const t of index.near(x0, z0, x1, z1)) {
    const o = t * 9;
    const poly = slab(T, o, ya, yb);
    if (!poly) continue;
    // clip the slab's polygon to the square, in plan
    let p = poly.map((v) => [v[0], v[2]]);
    for (const [axis, lim, lower] of [[0, x0 - 1e-9, true], [0, x1 + 1e-9, false], [1, z0 - 1e-9, true], [1, z1 + 1e-9, false]]) {
      const out = [];
      for (let a = 0; a < p.length; a++) {
        const S = p[(a + p.length - 1) % p.length];
        const E = p[a];
        const sIn = lower ? S[axis] >= lim : S[axis] <= lim;
        const eIn = lower ? E[axis] >= lim : E[axis] <= lim;
        if (sIn !== eIn) {
          const k = (lim - S[axis]) / (E[axis] - S[axis]);
          out.push([S[0] + (E[0] - S[0]) * k, S[1] + (E[1] - S[1]) * k]);
        }
        if (eIn) out.push(E);
      }
      p = out;
      if (!p.length) break;
    }
    if (p.length) return true;
  }
  return false;
}

/** The closed square of a cell's column. */
export const squareOf = (mesh, a) => {
  const x0 = mesh.origin[0] + mesh.cells.i[a] * mesh.cell;
  const z0 = mesh.origin[1] + mesh.cells.k[a] * mesh.cell;
  return [x0, z0, x0 + mesh.cell, z0 + mesh.cell];
};

/**
 * The oracle for one walker state aboard, against the raw triangles in her
 * frame (DESIGN.md, "One property test"):
 * - the feet are within h + 2 mm above a triangle in their column;
 * - no triangle meets the body's cylinder (radius r) over [s + step, s + H]
 *   standing, [s + max(h, step), s + h + H] in the air, [b + h, b + h + H]
 *   over a vault's band (b its base): below `step` the legs may overlap what
 *   they step over.
 * @returns {string[]} problems
 */
export function oracle(index, mesh, st) {
  const P = mesh.params;
  const bad = [];
  const local = localFeet(st);
  if (!local) return bad;
  const q = [local[0], local[2]];
  if (st.mode === "vaulting") {
    const base = sideBase(mesh, st.cell, st.side);
    const t = meets(index, q, base + st.h, base + st.h + P.height, P.radius);
    if (t != null) bad.push(`vaulting body meets triangle ${t} at ${q.map((v) => v.toFixed(3))} h ${st.h.toFixed(3)}`);
    return bad;
  }
  const h = st.mode === "airborne" ? st.h : 0;
  const s = local[1] - h;
  if (!supported(index, squareOf(mesh, st.cell), s - SUPPORT, s + h + SUPPORT)) bad.push(`no triangle under the feet at ${local.map((v) => v.toFixed(3))}`);
  const t = meets(index, q, s + Math.max(h, P.step), s + h + P.height, P.radius);
  if (t != null) bad.push(`body meets triangle ${t} at ${local.map((v) => v.toFixed(3))} (${st.mode}, h ${h.toFixed(3)})`);
  return bad;
}

/** A swimmer's oracle in one ship's frame: no triangle within r of the plan point, at any height. */
export function swimmerClear(index, q, r) {
  return meets(index, q, -1e6, 1e6, r) == null;
}

// ─── the bake properties ────────────────────────────────────────────────────

/**
 * B1, B3, B4, B5 from the mesh alone (cheap: every case of the property test
 * runs them).
 * @returns {string[]} problems
 */
export function checkMesh(mesh) {
  const bad = [];
  const { cells, side, count } = mesh;
  const H = mesh.params.height;
  const isOutside = (x, z) => {
    const col = columnAt(mesh, x, z);
    return col < 0 || mesh.outside[col] === 1;
  };
  for (let a = 0; a < count; a++) {
    const [, smax] = cellRange(cells, a, mesh.cell);
    if (!(cells.ceil[a] - smax >= H - 1e-4)) bad.push(`B1: cell ${a} has ${(cells.ceil[a] - smax).toFixed(3)} headroom`);
    for (let s = 0; s < 4; s++) {
      const e = a * 4 + s;
      const kind = side.kind[e];
      const to = side.to[e];
      if (kind === STEP) {
        if (!(to >= 0 && to < count)) bad.push(`B3: STEP side ${e} to ${to}`);
        else if (side.kind[to * 4 + (s ^ 1)] !== STEP || side.to[to * 4 + (s ^ 1)] !== a) bad.push(`B4: STEP ${a}→${to} not mirrored`);
        else if (cells.i[to] !== cells.i[a] + DIRS[s][0] || cells.k[to] !== cells.k[a] + DIRS[s][1]) bad.push(`B3: STEP ${a}→${to} isn't to the column beside it`);
      } else if (kind === WALL) {
        if (!(to >= 0 ? to < count : to === OVERBOARD || to === NONE)) bad.push(`B3: WALL side ${e} to ${to}`);
        if (!(side.rise[e] >= 0)) bad.push(`WALL side ${e} rise ${side.rise[e]}`);
      } else if (kind === OPEN) {
        if (to !== OVERBOARD) bad.push(`B3: OPEN side ${e} to ${to}`);
      } else bad.push(`side ${e} has no record (${kind})`);
      if (to === OVERBOARD && !isOutside(side.exit[e * 2], side.exit[e * 2 + 1])) bad.push(`B5: exit of side ${e} inside D_r`);
    }
  }
  for (let col = 0; col < mesh.nx * mesh.nz; col++) {
    if (mesh.outside[col]) continue;
    const x = mesh.putOut[col * 2];
    const z = mesh.putOut[col * 2 + 1];
    if (!Number.isFinite(x) || !isOutside(x, z)) {
      bad.push(`B5: putOut of column ${col} inside D_r`);
      break;
    }
  }
  for (const l of mesh.links) {
    if (count > 0 && !(l.at && l.at.cell >= 0 && l.at.cell < count)) bad.push(`link ${l.kind} ${l.id} not on a cell`);
    if (l.foot && !isOutside(l.foot[0], l.foot[1])) bad.push(`B5: the ladder's foot is inside D_r`);
  }
  return bad;
}

/**
 * C5: B1, B2 and B7 recomputed by brute force from the triangles.
 * - B2 and the airborne envelope, per cell, exactly as the erosion promises
 *   it: the cylinder of radius r + c/√2 about the cell's centre (so every
 *   (u, v) in the cell, radius r) is clear from `smin + step` up to
 *   `smax + H + headroom` (up for ever where headroom is infinite: the air
 *   over every point an airborne body can reach in the cell, at any h).
 * - The headroom isn't understated or stale: where it's finite, a triangle
 *   stands just above that top within the disc's columns (r + c/√2 + c√2).
 * - B1: a triangle at the surface in the cell's column.
 * - B7: along every vault band, at its rise and at its top where that's finite.
 * @returns {string[]} problems (the first `limit`)
 */
export function checkAgainst(mesh, index, { limit = 20 } = {}) {
  const bad = [];
  const P = mesh.params;
  const c = mesh.cell;
  const R = P.radius + c / Math.SQRT2;
  const EPS = 0.005;
  const push = (m) => bad.length < limit && bad.push(m);
  for (let a = 0; a < mesh.count && bad.length < limit; a++) {
    const p = pointOf(mesh, a, 0.5, 0.5);
    const q = [p[0], p[2]];
    const [smin, smax] = cellRange(mesh.cells, a, c);
    const room = mesh.cells.headroom[a];
    const top = Number.isFinite(room) ? smax + P.height + room : 1e6;
    const t = meets(index, q, smin + P.step, top, R);
    if (t != null) push(`B2: cell ${a} at ${p.map((x) => x.toFixed(3))}: triangle ${t} in the body's reach (step to H + headroom ${room.toFixed?.(3) ?? room})`);
    if (Number.isFinite(room) && meets(index, q, smin + P.step, top + EPS, R + c * Math.SQRT2) == null) push(`headroom: cell ${a} at ${p.map((x) => x.toFixed(3))}: nothing just above its headroom ${room.toFixed(3)} (understated or stale)`);
    if (!supported(index, squareOf(mesh, a), p[1] - SUPPORT, p[1] + SUPPORT)) push(`B1: cell ${a}: no triangle at its surface ${p.map((x) => x.toFixed(3))}`);
    for (let s = 0; s < 4; s++) {
      const e = a * 4 + s;
      if (mesh.side.kind[e] !== WALL || mesh.side.to[e] === NONE) continue;
      const base = sideBase(mesh, a, s);
      const gap = mesh.side.gap[e];
      const [dx, dz] = DIRS[s];
      for (const w of [0, 0.5, 1]) {
        const u = dx ? (dx > 0 ? 1 : 0) : w;
        const v = dz ? (dz > 0 ? 1 : 0) : w;
        const p = pointOf(mesh, a, u, v);
        for (let d = 0; d <= gap + 1e-9; d += mesh.cell / 2) {
          const q = [p[0] + dx * d, p[2] + dz * d];
          for (const h of [mesh.side.rise[e], Number.isFinite(mesh.side.top[e]) ? mesh.side.top[e] : null]) {
            if (h == null) continue;
            const t = meets(index, q, base + h, base + h + P.height, P.radius);
            if (t != null) push(`B7: side ${e} band at d ${d.toFixed(3)} h ${h.toFixed(3)}: triangle ${t}`);
          }
        }
      }
    }
  }
  return bad;
}

// ─── the static checks over a whole hull ────────────────────────────────────

/** Ray parity: is a point inside the closed surfaces of `index`, along direction d? */
function parity(index, p, d) {
  const { T } = index;
  const reach = Math.max(1, index.ymax - p[1] + 1) / d[1];
  const end = [p[0] + d[0] * reach, p[2] + d[2] * reach];
  const ts = index.near(Math.min(p[0], end[0]), Math.min(p[2], end[1]), Math.max(p[0], end[0]), Math.max(p[2], end[1]));
  let n = 0;
  for (const t of ts) {
    const o = t * 9;
    const e1 = [T[o + 3] - T[o], T[o + 4] - T[o + 1], T[o + 5] - T[o + 2]];
    const e2 = [T[o + 6] - T[o], T[o + 7] - T[o + 1], T[o + 8] - T[o + 2]];
    const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-14) continue;
    const tv = [p[0] - T[o], p[1] - T[o + 1], p[2] - T[o + 2]];
    const uu = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
    if (uu < 0 || uu > 1) continue;
    const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
    if (vv < 0 || uu + vv > 1) continue;
    const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
    if (tt > 1e-9) n++;
  }
  return n % 2 === 1;
}

const RAYS = [
  [0.1307, 0.9823, 0.1336],
  [-0.1588, 0.9779, 0.1361],
  [0.0731, 0.9811, -0.1792],
];

/** Inside her closed hull: odd along all three rays (and when they disagree, `null`: not sure). */
export function insideHull(index, p) {
  const votes = RAYS.map((d) => parity(index, p, d));
  if (votes.every((v) => v)) return true;
  if (votes.every((v) => !v)) return false;
  return null;
}

/** The cells reachable on foot (STEP sides only) from a cell: a Uint8Array mark. */
export function reachable(mesh, from) {
  const seen = new Uint8Array(mesh.count);
  if (!(from >= 0)) return seen;
  const queue = [from];
  seen[from] = 1;
  while (queue.length) {
    const a = queue.pop();
    for (let s = 0; s < 4; s++) {
      const e = a * 4 + s;
      if (mesh.side.kind[e] !== STEP) continue;
      const b = mesh.side.to[e];
      if (!seen[b]) {
        seen[b] = 1;
        queue.push(b);
      }
    }
  }
  return seen;
}

/**
 * The static checks over one baked hull (DESIGN.md C1–C9). `rebake(params)`
 * bakes the same input again (C7, C9); `triangles` are what it was baked from.
 * @returns {{ ok: boolean, checks: { [name]: { ok: boolean, detail } } }}
 */
export function staticChecks(mesh, triangles, { seeds = [], rebake = null, shuffled = null, ship = "sloop" } = {}) {
  const checks = {};
  const index = indexTriangles(triangles);
  const P = mesh.params;
  const apex = apexOf(P);
  const put = (name, ok, detail) => (checks[name] = { ok: !!ok, detail });

  // C1: spawn, each station's stand spot and the ladder's top on a kept cell, near where asked
  const c1 = (m) =>
    m.links.map((l) => {
      const p = l.at ? pointOf(m, l.at.cell, l.at.u, l.at.v) : null;
      const plan = p ? Math.hypot(p[0] - l.asked[0], p[2] - l.asked[2]) : Infinity;
      const dy = p ? Math.abs(p[1] - l.asked[1]) : Infinity;
      return { kind: l.kind, id: l.id, plan: +plan.toFixed(3), dy: +dy.toFixed(3), ok: plan <= 0.35 && dy <= m.params.step };
    });
  const links = c1(mesh);
  put("C1 links on the mesh", links.length > 0 && links.every((l) => l.ok), links);

  // C2: every kept cell, and so every link, reachable on foot from spawn
  const spawn = mesh.links.find((l) => l.kind === "spawn");
  const c2 = (m) => {
    const sp = m.links.find((l) => l.kind === "spawn");
    const seen = reachable(m, sp?.at?.cell ?? -1);
    let missing = 0;
    for (let a = 0; a < m.count; a++) if (!seen[a]) missing++;
    return { missing, links: m.links.filter((l) => !seen[l.at.cell]).map((l) => `${l.kind} ${l.id ?? ""}`) };
  };
  const reach = c2(mesh);
  put("C2 all reachable from spawn", !!spawn && reach.missing === 0 && reach.links.length === 0, reach);

  // C3: nothing dropped that you could walk or jump to. Every dropped component is inside her
  // hull, or small, or no jump (a march across a WALL side, over the bake's intervals, at a rise
  // no more than the apex) could come down on it before the march's own stop
  const landable = droppedLandings(mesh, apex);
  const c3 = mesh.dropped.map((d) => {
    const inside = insideHull(index, [d.centroid[0], d.centroid[1] + 0.05, d.centroid[2]]);
    const small = d.area < 0.25;
    const jump = landable.get(d.region) ?? null;
    return { area: +d.area.toFixed(3), centroid: d.centroid.map((v) => +v.toFixed(2)), inside, small, jump, ok: inside === true || small || !jump };
  });
  put("C3 nothing reachable dropped", c3.every((d) => d.ok), c3);

  // C4: one record per side; B1, B3, B4, B5
  const c4 = checkMesh(mesh);
  put("C4 every side one record; B1 B3 B4 B5", c4.length === 0, c4.slice(0, 10));

  // C5: B1, B2, B7 by brute force from the triangles
  const c5 = checkAgainst(mesh, index);
  put("C5 B2 and B7 from the triangles", c5.length === 0, c5);

  // C6: no kept cell inside her closed hull
  let inside = 0;
  let unsure = 0;
  const examples = [];
  for (let a = 0; a < mesh.count; a++) {
    const p = pointOf(mesh, a, 0.5, 0.5);
    const v = insideHull(index, [p[0], p[1] + 0.05, p[2]]);
    if (v === true) {
      inside++;
      if (examples.length < 5) examples.push(p.map((x) => +x.toFixed(2)));
    } else if (v === null) unsure++;
  }
  put("C6 no cell inside the hull", inside === 0, { inside, unsure, examples });

  // C7: stable under small changes of step and radius
  if (rebake) {
    const runs = [{ step: P.step - 0.02 }, { step: P.step + 0.02 }, { radius: P.radius - 0.02 }, { radius: P.radius + 0.02 }].map((d) => {
      const m = rebake({ ...P, ...d });
      const l = c1(m);
      const r = c2(m);
      return { ...d, cells: m.count, links: l.every((x) => x.ok), missing: r.missing, unreached: r.links };
    });
    put("C7 stable under step ±0.02 and radius ±0.02", runs.every((r) => r.links && r.missing === 0 && r.unreached.length === 0), runs);
  }

  // C8 (a ship with rails): no OPEN anywhere; every way overboard a WALL above the step
  if (ship === "sloop") {
    let open = 0;
    let lowRail = 0;
    let jumpable = { port: 0, starboard: 0 };
    let unjumpable = 0;
    for (let e = 0; e < mesh.count * 4; e++) {
      if (mesh.side.kind[e] === OPEN) open++;
      if (mesh.side.to[e] !== OVERBOARD || mesh.side.kind[e] !== WALL) continue;
      const r = mesh.side.rise[e];
      if (r <= P.step) lowRail++;
      if (r <= apex) jumpable[mesh.side.exit[e * 2] < 0 ? "port" : "starboard"]++;
      else unjumpable++;
    }
    put("C8 never walk off her; jump over either side", open === 0 && lowRail === 0 && jumpable.port > 0 && jumpable.starboard > 0, { open, lowRail, jumpable, unjumpable });
  }

  // C9: deterministic, and independent of triangle order
  if (rebake) {
    const again = rebake(P);
    const same = sameMesh(mesh, again);
    const shuffledSame = shuffled ? sameMesh(mesh, shuffled()) : null;
    put("C9 deterministic and order-independent", same && shuffledSame !== false, { same, shuffled: shuffledSame });
  }

  return { ok: Object.values(checks).every((c) => c.ok), checks };
}

/**
 * For each dropped component, a jump that could come down on it (or none):
 * every non-STEP side of every kept cell marched again over the bake's
 * intervals, as the bake marches, with the dropped floors offered as places
 * to land, until the march's own stop or a rise over the apex.
 * @returns {Map<number, object>} region → the first such jump
 */
export function droppedLandings(mesh, apex) {
  const P = mesh.params;
  const c = mesh.cell;
  const R = P.radius + c * Math.SQRT1_2;
  const K = Math.ceil(R / c + 0.5);
  const disc = [];
  for (let dk = -K; dk <= K; dk++) for (let di = -K; di <= K; di++) if (Math.hypot(Math.max(0, Math.abs(di) * c - c / 2), Math.max(0, Math.abs(dk) * c - c / 2)) <= R + 1e-9) disc.push([di, dk]);
  const byCol = new Map();
  for (const d of mesh.dropped) {
    for (const [x, y, z, ceil] of d.floors ?? []) {
      const col = columnAt(mesh, x, z);
      if (col < 0) continue;
      if (!byCol.has(col)) byCol.set(col, []);
      byCol.get(col).push({ region: d.region, y, ceil, at: [x, y, z] });
    }
  }
  const out = new Map();
  if (!byCol.size) return out;
  const { start, lo, hi } = mesh.intervals;
  const fit = (col, base) => {
    const i = col % mesh.nx;
    const k = (col - i) / mesh.nx;
    let z = base;
    for (let moved = true; moved; ) {
      moved = false;
      for (const [di, dk] of disc) {
        const ii = i + di;
        const kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= mesh.nx || kk >= mesh.nz) continue;
        const cl = kk * mesh.nx + ii;
        for (let b = start[cl]; b < start[cl + 1]; b++) {
          if (hi[b] <= z + 1e-7 || lo[b] >= z + P.height - 1e-7) continue;
          z = hi[b];
          moved = true;
        }
      }
    }
    return z - base;
  };
  const J = Math.floor(P.march / c + 1e-9);
  for (let a = 0; a < mesh.count; a++) {
    for (let s = 0; s < 4; s++) {
      const e = a * 4 + s;
      if (mesh.side.kind[e] === STEP) continue;
      const base = sideBase(mesh, a, s);
      let rise = 0;
      for (let j = 1; j <= J; j++) {
        const ci = mesh.cells.i[a] + DIRS[s][0] * j;
        const ck = mesh.cells.k[a] + DIRS[s][1] * j;
        if (ci < 0 || ck < 0 || ci >= mesh.nx || ck >= mesh.nz) break;
        const col = ck * mesh.nx + ci;
        if (mesh.outside[col]) break;
        rise = Math.max(rise, fit(col, base));
        if (rise > apex) break;
        for (const g of byCol.get(col) ?? []) {
          if (g.y <= base + rise + 1e-6 && base + rise + P.height <= g.ceil + 1e-6 && !out.has(g.region)) out.set(g.region, { from: pointOf(mesh, a, 0.5, 0.5).map((v) => +v.toFixed(2)), to: g.at.map((v) => +v.toFixed(2)), rise: +rise.toFixed(3) });
        }
        if (mesh.side.to[e] >= 0 && mesh.cells.i[mesh.side.to[e]] === ci && mesh.cells.k[mesh.side.to[e]] === ck) break;
      }
    }
  }
  return out;
}

/** Are two meshes byte-identical in everything the walker reads? */
export function sameMesh(a, b) {
  if (a.count !== b.count || a.nx !== b.nx || a.nz !== b.nz || a.origin[0] !== b.origin[0] || a.origin[1] !== b.origin[1]) return false;
  const eq = (x, y) => {
    if (x.length !== y.length) return false;
    const p = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    const q = new Uint8Array(y.buffer, y.byteOffset, y.byteLength);
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
    return true;
  };
  for (const k of Object.keys(a.cells)) if (!eq(a.cells[k], b.cells[k])) return false;
  for (const k of Object.keys(a.side)) if (!eq(a.side[k], b.side[k])) return false;
  if (!eq(a.column, b.column) || !eq(a.outside, b.outside) || !eq(a.putOut, b.putOut)) return false;
  return JSON.stringify(a.links) === JSON.stringify(b.links);
}

/** Bake helper for the checks: the same input, other parameters. */
export const rebaker = (input) => (params) => bake(input, params);

/** A triangle list shuffled by a seeded permutation (whole triangles, each one's vertices in order). */
export function shuffleTriangles(triangles, seed = 1) {
  const n = Math.floor(triangles.length / 9);
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = new Array(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = triangles[order[i] * 9 + k];
  return out;
}

export { surfaceAt };
