// Water bodies (WATER.md, "Water bodies"): water is a shape, an object with
// the `water` trait, `{ size?: [w, depth, l] }`. Its origin is the surface at
// rest; with `size` it is a box in the object's own frame (w across x, l
// along z, centred on the origin, hanging down to its floor at y = -depth,
// its uniform scale multiplying size), without one it is everything below
// the origin's height. Its extent is data in the trait, never read from
// loaded geometry. Everything here is pure: the matrices are the stage's
// (column-major 4×4, in its doc's root frame), handed in.

/** The water package's object trait: this object is water. */
export const TRAIT = "water";
/** Water's own behaviour trait: a uniform drift, `{ speed (m/s), toward (degrees, from -Z toward +X) }`. */
export const CURRENT = "water.current";
/** How far a rotation may move +Y before an open body is refused (tilted). */
export const TILT_EPS = 1e-9;
/** What the waves' amplitude bound adds, about the level (m): as waterExtent's slab. */
export const BAND = 0.5;

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * What a `water` trait says the body is: "open" (no size), "bounded" with
 * its size, or "invalid" (a size that isn't three positive numbers: it
 * neither floods nor stays a box, so it is no water).
 * @returns {{ kind: "open" } | { kind: "bounded", size: number[] } | { kind: "invalid" }}
 */
export function shapeOf(trait) {
  if (!trait || typeof trait !== "object") return { kind: "invalid" };
  if (trait.size === undefined || trait.size === null) return { kind: "open" };
  const s = trait.size;
  if (Array.isArray(s) && s.length === 3 && s.every((v) => finite(v) && v > 0)) return { kind: "bounded", size: [s[0], s[1], s[2]] };
  return { kind: "invalid" };
}

/** Ids in the order "lowest id" means: plain string order. */
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A doc's water bodies, from its objects: the open body (the lowest id of
 * those without a size: one open body per doc, the keepers' rule for two
 * objects naming one slot), the other open ones (flagged: they draw and
 * offer nothing), the bounded ones (each with its size), and the invalid.
 * @param {{ [id: string]: { traits?: object } } | null | undefined} objects
 */
export function bodiesOf(objects) {
  const open = [];
  const bounded = [];
  const invalid = [];
  for (const id of Object.keys(objects ?? {}).sort(byId)) {
    const t = objects[id]?.traits?.[TRAIT];
    if (t === undefined) continue;
    const s = shapeOf(t);
    if (s.kind === "open") open.push(id);
    else if (s.kind === "bounded") bounded.push({ id, size: s.size });
    else invalid.push(id);
  }
  return { open: open[0] ?? null, extra: open.slice(1), bounded, invalid };
}

// ─── matrices ───────────────────────────────────────────────────────────────

/** A column-major matrix applied to a point. */
export const applyPoint = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
/** A column-major matrix's linear part applied to a direction. */
export const applyDir = (M, v) => [M[0] * v[0] + M[4] * v[1] + M[8] * v[2], M[1] * v[0] + M[5] * v[1] + M[9] * v[2], M[2] * v[0] + M[6] * v[1] + M[10] * v[2]];

/** A similarity's uniform scale: the length of its first column. */
export const scaleOf = (M) => Math.hypot(M[0], M[1], M[2]);

/** A similarity's inverse: (sR)ᵀ / s², then minus that times T. */
export function invertSimilarity(M) {
  const s2 = M[0] * M[0] + M[1] * M[1] + M[2] * M[2];
  const L = [M[0] / s2, M[4] / s2, M[8] / s2, 0, M[1] / s2, M[5] / s2, M[9] / s2, 0, M[2] / s2, M[6] / s2, M[10] / s2, 0, 0, 0, 0, 1];
  const t = applyDir(L, [M[12], M[13], M[14]]);
  L[12] = -t[0];
  L[13] = -t[1];
  L[14] = -t[2];
  return L;
}

/** Does this matrix keep +Y up (no tilt, no flip)? An open body that doesn't gives no water. */
export function isLevel(M) {
  if (!M) return true;
  const s = M[5];
  if (!(s > 0)) return false;
  for (const i of [1, 4, 6, 9]) if (Math.abs(M[i]) > TILT_EPS * s) return false;
  return true;
}

// ─── waves on a body ────────────────────────────────────────────────────────

/** The waves' amplitude bound about the level: Σ|amp| and BAND more (no crest or trough passes it). */
export function amplitudeBound(components) {
  let h = BAND;
  for (const c of components ?? []) h += Math.abs(c.amp) || 0;
  return h;
}

/** A current trait as a velocity [ux, uz] in its holder's doc frame (m/s); none, or no speed, is [0, 0]. */
export function currentOf(trait) {
  const speed = finite(trait?.speed) ? trait.speed : 0;
  if (!trait || !(speed !== 0)) return [0, 0];
  const r = ((finite(trait.toward) ? trait.toward : 0) * Math.PI) / 180;
  // bearing from -Z toward +X: 0 is north (-Z), 90 east (+X)
  return [speed * Math.sin(r) + 0, -speed * Math.cos(r) + 0];
}

/**
 * The components carried by a uniform current U ([ux, uz]): each wave's
 * pattern drifts with the water, so its frequency is shifted by k (dir · U)
 * (θ = k·(x − U t) − ω t). The same list feeds the drawn surface and the
 * reader, so what floats is still what is drawn. No current: the same list.
 */
export function shiftByCurrent(components, U) {
  if (!components?.length || !U || (U[0] === 0 && U[1] === 0)) return components ?? [];
  return components.map((c) => ({ ...c, omega: c.omega + c.k * (c.dir[0] * U[0] + c.dir[1] * U[1]) }));
}

/**
 * A bounded body's components: those whose wavelength fits its footprint's
 * shorter side (`span`, in the doc's units), so a basin doesn't carry an
 * ocean swell. Any wave maker gets this from the water package. An open
 * body (span Infinity) keeps all.
 */
export function clipToSpan(components, span) {
  if (!components?.length) return components ?? [];
  if (!(span < Infinity)) return components;
  return components.filter((c) => (2 * Math.PI) / c.k <= span);
}

// ─── a bounded body's region ────────────────────────────────────────────────

/**
 * A bounded body as the choice and its reader see it, from its size and its
 * drawn world matrix M (in the stage's frame): its level (the origin's
 * height: the free surface stays level in the doc's frame through it), its
 * footprint's shorter side and its volume, both scaled, and its inverse.
 */
export function boxOf(size, M) {
  const s = scaleOf(M);
  return {
    size,
    M,
    Mi: invertSimilarity(M),
    level: M[13],
    span: Math.min(size[0], size[2]) * s,
    volume: size[0] * size[1] * size[2] * s * s * s,
  };
}

/** Is the column through p (its x and z, at the body's level) inside the body's footprint? In the body's own frame. */
export function inFootprint(box, p) {
  const q = applyPoint(box.Mi, [p[0], box.level, p[2]]);
  return Math.abs(q[0]) <= box.size[0] / 2 && Math.abs(q[2]) <= box.size[2] / 2;
}

/** Is p above the body's floor (in its own frame)? */
export function aboveFloor(box, p) {
  return applyPoint(box.Mi, p)[1] >= -box.size[1];
}

/**
 * The floor's height under (x, z) in the stage's frame, and its normal: the
 * plane y = -depth of the body's frame, wherever it is turned.
 */
export function floorAt(box, x, z) {
  const M = box.M;
  const o = applyPoint(M, [0, -box.size[1], 0]);
  const n = applyDir(M, [0, 1, 0]);
  const l = Math.hypot(n[0], n[1], n[2]);
  const ny = n[1] / l, nx = n[0] / l, nz = n[2] / l;
  if (Math.abs(ny) < 1e-12) return { y: o[1], normal: [0, 1, 0] };
  return { y: o[1] - (nx * (x - o[0]) + nz * (z - o[2])) / ny, normal: ny > 0 ? [nx, ny, nz] : [-nx, -ny, -nz] };
}

// ─── carrier velocity ───────────────────────────────────────────────────────

/**
 * A body's rigid velocity in its doc from two drawn poses dt apart: v, the
 * origin's velocity, and ω, from R_now R_prevᵀ (small-angle), about the
 * origin `o` now. Zero for no previous pose or dt ≤ 0 (paused).
 * @returns {{ v: number[], w: number[], o: number[] }}
 */
export function rigidVelocity(prev, now, dt) {
  const o = [now[12], now[13], now[14]];
  if (!prev || !(dt > 0)) return { v: [0, 0, 0], w: [0, 0, 0], o };
  const v = [(now[12] - prev[12]) / dt, (now[13] - prev[13]) / dt, (now[14] - prev[14]) / dt];
  // the rotation parts, scale divided out
  const sa = scaleOf(now) || 1, sb = scaleOf(prev) || 1;
  const A = (i) => now[i] / sa;
  const B = (i) => prev[i] / sb;
  // D = A Bᵀ: D[r][c] = Σk A[r][k] B[c][k]; column-major X[r][c] = X[c*4+r]
  const D = (r, c) => A(r) * B(c) + A(4 + r) * B(4 + c) + A(8 + r) * B(8 + c);
  // the axis-angle of D: ω dt = angle · axis, with axis·sin(angle) = vee(D − Dᵀ)/2
  const vx = (D(2, 1) - D(1, 2)) / 2, vy = (D(0, 2) - D(2, 0)) / 2, vz = (D(1, 0) - D(0, 1)) / 2;
  const sin = Math.hypot(vx, vy, vz);
  const cos = (D(0, 0) + D(1, 1) + D(2, 2) - 1) / 2;
  const angle = Math.atan2(sin, cos);
  const k = sin > 1e-15 ? angle / sin / dt : 1 / dt;
  return { v, w: [vx * k, vy * k, vz * k], o };
}

/** v + ω × (p − o): what a point riding with the carrier moves at. */
export function carried(rv, p, out = [0, 0, 0]) {
  const rx = p[0] - rv.o[0], ry = p[1] - rv.o[1], rz = p[2] - rv.o[2];
  const w = rv.w;
  out[0] = rv.v[0] + w[1] * rz - w[2] * ry;
  out[1] = rv.v[1] + w[2] * rx - w[0] * rz;
  out[2] = rv.v[2] + w[0] * ry - w[1] * rx;
  return out;
}

/**
 * The water a bounded body holds, level in its doc however the box is
 * turned: the part of its column (its footprint, above its floor, no lid)
 * below the horizontal plane through its origin, in the body's own units.
 * While that plane meets only the sides, the depth over the footprint is
 * linear with its mean at the centre, so the volume is w·l·depth whatever
 * the tilt; `meets` says "floor" where the plane dips below the floor at a
 * corner (the volume is then the clipped integral, by a 64×64 midpoint rule).
 * @returns {{ volume: number, meets: "sides" | "floor" }}
 */
export function heldVolume(size, M) {
  const [w, d, l] = size;
  // the stage's height above the origin, per unit of the body's (qx, qy, qz): row 1 of M's linear part
  const a = M[1], b = M[5], c = M[9];
  const depth = (x, z) => d - (a * x + c * z) / b;
  const corners = [[-w / 2, -l / 2], [w / 2, -l / 2], [-w / 2, l / 2], [w / 2, l / 2]];
  if (b > 0 && corners.every(([x, z]) => depth(x, z) >= 0)) return { volume: w * l * d, meets: "sides" };
  const n = 64;
  let v = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) v += Math.max(0, depth(-w / 2 + (w * (i + 0.5)) / n, -l / 2 + (l * (j + 0.5)) / n));
  return { volume: (v * w * l) / (n * n), meets: "floor" };
}
