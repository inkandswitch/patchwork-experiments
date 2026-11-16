// A home view that frames given boxes, for a publisher (scene/probes and
// sailing/probes hold the same file: packages are independent, so it is
// copied, not shared; keep the two copies byte for byte the same).
//
// The stage's camera is a 45° (top to bottom) perspective looking from
// `home.position` at `home.target`, world up (viewport.js), and its field
// sideways is the pane's: so a home fitted to the narrowest pane a doc is
// opened in frames it in every wider one, since the field top to bottom
// doesn't change and the field across only grows. Patchwork's pane between
// its sidebars is about 640 × 800 at 1440 × 900 (HOST Decision 47), so that
// is the pane a publisher fits, with MARGIN to spare (everything inside the
// middle 90% each way: still whole down to a 576 px pane), and the panes it
// checks are that one and the whole window.
//
// Pure: no three, no DOM. Points are [x, y, z]; a transform is the scene's
// { position, rotation (Euler, XYZ), scale }.

/** The stage's camera's field, top to bottom (degrees; viewport.js). */
export const FOV = 45;
/** How much of the pane each way a fitted home uses. */
export const MARGIN = 0.9;
/** The panes a home is checked in: Patchwork's narrow pane, and the whole window. */
export const PANES = Object.freeze([Object.freeze({ name: "640×800", width: 640, height: 800 }), Object.freeze({ name: "1440×900", width: 1440, height: 900 })]);
/** The pane a home is fitted to: the narrowest. */
export const FIT_PANE = PANES[0];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A 4×4 matrix (column-major, as three's) from a transform: T · R(XYZ) · S. */
export function matrixOf(t = {}) {
  const p = t.position ?? [0, 0, 0];
  const [x, y, z] = t.rotation ?? [0, 0, 0];
  const s = t.scale ?? 1;
  const [sx, sy, sz] = Array.isArray(s) ? s : [s, s, s];
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // three's makeRotationFromEuler, order XYZ
  const r = [c * e, af + be * d, bf - ae * d, -c * f, ae - bf * d, be + af * d, d, -b * c, a * c];
  return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0, r[6] * sz, r[7] * sz, r[8] * sz, 0, p[0], p[1], p[2], 1];
}

/** m · n (4×4, column-major). */
export function multiply(m, n) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) out[col * 4 + row] += m[k * 4 + row] * n[col * 4 + k];
  return out;
}

export const IDENTITY = Object.freeze(matrixOf());

/** Point p carried by matrix m. */
export const apply = (m, p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);

/** The eight corners of the box min..max, carried by m. */
export function corners(min, max, m = IDENTITY) {
  const out = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push(apply(m, [x, y, z]));
  return out;
}

/**
 * The corners of a box written "cx,cy,cz:w,h,l[@yawDegrees]" (its centre,
 * its size, its turn about y; publish-links' --box), carried by m; null when
 * the text isn't one.
 */
export function specPoints(spec, m = IDENTITY) {
  const [box, yawText, extra] = String(spec).split("@");
  const [c, size, more] = box.split(":").map((part) => part.split(",").map((v) => (v.trim() === "" ? NaN : Number(v))));
  const yaw = yawText == null ? 0 : yawText.trim() === "" ? NaN : Number(yawText);
  if (extra != null || more || c?.length !== 3 || size?.length !== 3 || ![...c, yaw].every(Number.isFinite) || !size.every((v) => Number.isFinite(v) && v > 0)) return null;
  const at = multiply(m, matrixOf({ position: c, rotation: [0, (yaw * Math.PI) / 180, 0] }));
  return corners(size.map((v) => -v / 2), size.map((v) => v / 2), at);
}

/** An object's matrix in its doc's frame: its own transform under its parents'. */
export function worldOf(doc, id) {
  let m = IDENTITY;
  const seen = new Set();
  for (let at = id; at != null && doc.objects?.[at] && !seen.has(at); at = doc.objects[at].parent) {
    seen.add(at);
    m = multiply(matrixOf(doc.objects[at].transform ?? {}), m);
  }
  return m;
}

/**
 * Every drawn thing's box that its doc states: each visible object whose
 * file (doc.assets, by its sourceUrl) carries a hint's bounds, those bounds
 * carried to the doc's frame and then by m (a link's matrix, say). What a
 * doc draws without a hint (a body of water, a linked doc) isn't here.
 * @returns {{ id: string, name: string, points: number[][] }[]}
 */
export function drawnBoxes(doc, m = IDENTITY) {
  const bounds = new Map();
  for (const a of Object.values(doc?.assets ?? {})) if (a?.url && a.hint?.bounds?.min && a.hint.bounds.max) bounds.set(a.url, a.hint.bounds);
  const out = [];
  for (const [id, o] of Object.entries(doc?.objects ?? {})) {
    const b = bounds.get(o?.sourceUrl);
    if (!b || o.visible === false) continue;
    out.push({ id, name: o.name ?? id, points: corners(b.min, b.max, multiply(m, worldOf(doc, id))) });
  }
  return out;
}

/** A link's provider (scene/src/stage/links.js): its sourceUrl is a doc shown in place. */
export const LINK = "scene.link";

/**
 * What a doc shows, as boxes in m's frame: its drawn boxes, the boxes
 * `more(doc, m)` gives (what a package knows its doc holds that no hint
 * states: a body of water, say), and, through each visible link whose doc
 * `docs` holds ({ [url]: doc }), the linked doc's, carried by the link. Each
 * box says which links it came `via`. A link whose doc isn't held is listed
 * in `missing` with its `depth` (0: one of this doc's own); a link back to a
 * doc it is inside (`inside`: their urls, this doc's own first) is not
 * followed.
 * @returns {{ boxes: { id: string, name: string, points: number[][], via: string[] }[], missing: { id: string, url: string, depth: number }[] }}
 */
export function contentOf(doc, docs, { m = IDENTITY, more = () => [], inside = [], depth = 0 } = {}) {
  const boxes = [...drawnBoxes(doc, m), ...more(doc, m)].map((b) => ({ ...b, via: [] }));
  const missing = [];
  for (const [id, o] of Object.entries(doc?.objects ?? {})) {
    if (o?.providerId !== LINK || o.visible === false) continue;
    const d = docs?.[o.sourceUrl];
    if (!d) {
      missing.push({ id, url: o.sourceUrl, depth });
      continue;
    }
    if (inside.includes(o.sourceUrl)) continue;
    const inner = contentOf(d, docs, { m: multiply(m, worldOf(doc, id)), more, inside: [...inside, o.sourceUrl], depth: depth + 1 });
    for (const b of inner.boxes) boxes.push({ ...b, via: [id, ...b.via] });
    missing.push(...inner.missing);
  }
  return { boxes, missing };
}

/** The camera's frame looking from `position` at `target`, world up: right, up, forward. */
function basis(position, target) {
  const f = unit(sub(target, position));
  const r = unit(cross(f, [0, 1, 0]));
  return { r, u: cross(r, f), f };
}

/**
 * Where point p lands in a pane, seen from `home` (the stage's camera): x and
 * y from −1 to 1 across the pane (as three's normalized device coordinates),
 * and its depth in front of the camera (m; ≤ 0 is behind it).
 */
export function project(home, p, pane, fov = home.fov ?? FOV) {
  const { r, u, f } = basis(home.position, home.target);
  const d = sub(p, home.position);
  const z = dot(d, f);
  const ty = Math.tan((fov * Math.PI) / 360);
  return { x: dot(d, r) / (z * ty * (pane.width / pane.height)), y: dot(d, u) / (z * ty), depth: z };
}

/**
 * How points sit in a pane from `home`: the extremes of x and y, the nearest
 * depth, and whether every point is in front and inside the middle `within`
 * of the pane each way (1: the whole pane).
 */
export function framing(home, points, pane, { within = 1, fov } = {}) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, near = Infinity;
  for (const p of points) {
    const q = project(home, p, pane, fov);
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); near = Math.min(near, q.depth);
  }
  const lim = within + 1e-9;
  return { x: [x0, x1], y: [y0, y1], near, inside: near > 0 && x0 >= -lim && x1 <= lim && y0 >= -lim && y1 <= lim };
}

/**
 * The nearest home looking down `pitch` degrees, along `heading` degrees
 * (0: towards −z; positive turns left, as a yaw), from which every point is
 * inside the middle `margin` of a pane of `aspect` (width over height). The
 * target is on the line of sight, as deep as the points' middle.
 *
 * In the camera's frame (right r, up u, forward f) a point p is inside when
 * |p·r − c·r| ≤ tx (p·f − c·f), and the same for up with ty: linear in the
 * camera's place c. Across alone the nearest c·f is the largest
 * min(A + c·r/tx, B − c·r/tx), with A = min(p·f − p·r/tx) and
 * B = min(p·f + p·r/tx): (A + B)/2, at c·r = (B − A)·tx/2; up alike; the
 * camera goes to the nearer of the two depths, each way at its own middle.
 */
export function fitHome(points, { aspect = FIT_PANE.width / FIT_PANE.height, fov = FOV, pitch = 27, heading = 0, margin = MARGIN } = {}) {
  if (!points.length) throw new Error("fitHome: nothing to frame");
  if (!(pitch > -90 && pitch < 90)) throw new Error("fitHome: a pitch between −90° and 90°, please (straight down has no right)");
  const P = (pitch * Math.PI) / 180, H = (heading * Math.PI) / 180;
  const f = [-Math.sin(H) * Math.cos(P), -Math.sin(P), -Math.cos(H) * Math.cos(P)];
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const ty = margin * Math.tan((fov * Math.PI) / 360);
  const tx = ty * aspect;
  const across = (axis, t) => {
    let A = Infinity, B = Infinity;
    for (const p of points) {
      const z = dot(p, f), s = dot(p, axis);
      A = Math.min(A, z - s / t);
      B = Math.min(B, z + s / t);
    }
    return { at: ((B - A) * t) / 2, depth: (A + B) / 2 };
  };
  const X = across(r, tx), Y = across(u, ty);
  const cz = Math.min(X.depth, Y.depth);
  const position = [0, 1, 2].map((i) => X.at * r[i] + Y.at * u[i] + cz * f[i]);
  const lo = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
  const mid = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2);
  const d = Math.max(dot(sub(mid, position), f), 1e-3);
  const target = [0, 1, 2].map((i) => position[i] + d * f[i]);
  const tidy = (v) => Math.round(v * 1e4) / 1e4 + 0;
  return { position: position.map(tidy), target: target.map(tidy) };
}

/** Each pane's framing of `points` from `home`: { pane, ...framing }. */
export function panesReport(home, points, panes = PANES) {
  return panes.map((pane) => ({ pane: pane.name, ...framing(home, points, pane) }));
}
