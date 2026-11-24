// The halo's arithmetic (scene.halo, ./halo.js), apart from three.js and the
// stage so it can be tested on its own: what the halo is on, where its
// handles go round a box, which one the pointer is on, and what a drag on
// each does. Matrices are 16 numbers, column-major (transform.js).
//
// Everything is in one frame: the selected object's parent's, as drawn (the
// world for a group, or an object at the root). Its axes are the ones a
// move arrow moves along and a ring turns about, so a winch's handles heel
// with the hull, and a drag is the same drag however the hull is moving.
//
// The handles are outside the thing's box: the corners just beyond its
// corners, the rings round the sphere that holds the box, the arrows beyond
// the rings. So a press on the thing itself is never a press on its halo.

import { IDENTITY_MATRIX, decomposeMatrix, invertMatrix, multiplyMatrices } from "../transform.js";
import { groupChain, isGroup } from "../groups.js";
import { closestOnLine } from "../handles.js";
import { pointing } from "../stage/bodies.js";

/** How big a handle is, as a fraction of its distance from the eye: the same size on screen at any zoom. */
export const HANDLE_SIZE = 0.02;
/** How close (port px) the pointer must be to a handle to take it. */
export const GRAB_PX = 8;
/** The smallest a scale drag makes something, as a fraction of its size when the drag began. */
export const MIN_SCALE = 0.01;
const RING_SEGMENTS = 48;

// ─── what the halo is on ────────────────────────────────────────────────────

/** Every object filed in group `gid`, at any depth (groups themselves left out). */
export function groupMembers(scene, gid) {
  const out = [];
  for (const id of Object.keys(scene?.objects ?? {})) {
    const o = scene.objects[id];
    if (!o || isGroup(o)) continue;
    if (groupChain(scene.groups, id).includes(gid)) out.push(id);
  }
  return out;
}

/**
 * What a group's handles move: its members that aren't locked and aren't
 * attached to another member (those follow their parent).
 */
export function groupRoots(scene, gid) {
  const members = new Set(groupMembers(scene, gid));
  const out = [];
  for (const id of members) {
    if (scene.objects[id]?.locked) continue;
    const p = scene.parents?.get(id);
    if (p != null && members.has(p)) continue;
    out.push(id);
  }
  return out;
}

/**
 * What the halo's handles are on: { kind: "object" | "group", id }, or null.
 * Handles are Move's: they show only with Move held (an editor's tool, so
 * only while editing: STAGE.md, "Commands", H14), for the selection where
 * its doc may be written, while no
 * other pointing tool is held (its clicks are the world's: bodies.js
 * pointing), on an object that isn't locked or a group with something it can
 * move.
 * @param {object} scene  api.scene()
 * @param {object} view  api.view.get()
 * @param {boolean} writable  api.writable()
 */
/** The halo's own tool: Move, picked up and put down (halo.js). */
export const MOVE = Object.freeze({ ext: "scene.halo", command: "move" });

/** Is Move held? */
export const moving = (view) => Array.isArray(view?.held) && view.held.some((t) => t?.ext === MOVE.ext && t?.command === MOVE.command);

export function haloTarget(scene, view, writable = true) {
  if (!writable || !moving(view) || pointing(view, MOVE.ext)) return null;
  const id = view?.selected;
  const o = id != null ? scene?.objects?.[id] : null;
  if (!o) return null;
  if (isGroup(o)) return groupRoots(scene, id).length ? { kind: "group", id } : null;
  if (o.locked) return null;
  return { kind: "object", id };
}

// ─── where the handles go ───────────────────────────────────────────────────

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (i) => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];

/** The two unit axes spanning the plane a ring about axis `i` lies in, so (u, v, axis) is right-handed. */
export function ringBasis(i) {
  return [unit((i + 1) % 3), unit((i + 2) % 3)];
}

/**
 * The halo's handles round a box, in its frame: three move arrows (+X, +Y,
 * +Z), three rotate rings (about X, Y, Z) and eight scale corners. `size` is
 * a handle's size in the frame (HANDLE_SIZE × its distance from the eye), and
 * the gap between the box and its handles too.
 *
 * - corners: each box corner, pushed `size` further out from the centre;
 * - rings: centred on the box, radius = half its diagonal + 2·size, so they
 *   clear the box (inside that sphere) and the corners;
 * - arrows: from a `size` beyond the rings, 3·size long.
 * @param {{ min: number[], max: number[] }} box  in the frame
 * @param {number} size
 */
export function haloHandles(box, size) {
  const c = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
  const half = [0, 1, 2].map((k) => Math.max(0, (box.max[k] - box.min[k]) / 2));
  const r = len(half);
  const radius = r + 2 * size;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const from = add(c, scale(unit(i), radius + size));
    out.push({ kind: "move", axis: i, from, to: add(from, scale(unit(i), 3 * size)) });
  }
  for (let i = 0; i < 3; i++) out.push({ kind: "rotate", axis: i, center: c, radius });
  for (let k = 0; k < 8; k++) {
    const corner = [k & 1 ? box.max[0] : box.min[0], k & 2 ? box.max[1] : box.min[1], k & 4 ? box.max[2] : box.min[2]];
    const out1 = sub(corner, c);
    const d = len(out1);
    // a box with no size: its corners go out along the diagonal they'd have
    const dir = d > 1e-12 ? scale(out1, 1 / d) : scale([k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1], 1 / Math.sqrt(3));
    out.push({ kind: "scale", corner: k, at: add(corner, scale(dir, size)) });
  }
  return { center: c, radius, size, handles: out };
}

/** The points a handle is drawn through (a polyline; one point for a corner), in its frame. */
export function handlePoints(h) {
  if (h.kind === "move") return [h.from, h.to];
  if (h.kind === "scale") return [h.at];
  const [u, v] = ringBasis(h.axis);
  const pts = [];
  for (let s = 0; s <= RING_SEGMENTS; s++) {
    const a = (s / RING_SEGMENTS) * Math.PI * 2;
    pts.push(add(h.center, add(scale(u, h.radius * Math.cos(a)), scale(v, h.radius * Math.sin(a)))));
  }
  return pts;
}

/** How square on an arrow must be seen, and how open a ring, to be used (|cos| of the angle to the eye). */
const END_ON = 0.95;
const EDGE_ON = 0.2;

/**
 * Can a handle be dragged from where the eye is (in the frame)? Not an arrow
 * seen end on, nor a ring seen edge on: neither says anything to a drag, and
 * an edge-on ring would lie across the thing's middle. Those aren't drawn.
 */
export function usable(h, eye) {
  if (!eye || h.kind === "scale") return true;
  const at = h.kind === "move" ? h.from : h.center;
  const v = sub(eye, at);
  const d = len(v);
  if (!(d > 1e-12)) return false;
  const c = Math.abs(v[h.axis]) / d;
  return h.kind === "move" ? c < END_ON : c > EDGE_ON;
}

/**
 * The handle the pointer is on: the nearest within `px` of it on screen (of
 * those `usable` from the eye), with the point on it nearest the pointer (in
 * the frame); of two the same on screen, the nearer the eye. null when none is.
 * @param {object[]} handles  haloHandles(…).handles
 * @param {(p: number[]) => ({ x: number, y: number, visible?: boolean } | null)} project  a frame point to port px
 * @param {{ x: number, y: number }} pointer
 * @param {{ eye?: number[] | null, px?: number }} [opts]  the eye in the frame
 */
export function handleAt(handles, project, pointer, { eye = null, px = GRAB_PX } = {}) {
  let best = null;
  const depth = (p) => (eye ? len(sub(p, eye)) : 0);
  for (const h of handles) {
    if (!usable(h, eye)) continue;
    const pts = handlePoints(h);
    const scr = pts.map(project);
    const consider = (d, point) => {
      if (d > px) return;
      if (!best || d < best.d - 0.5 || (d <= best.d + 0.5 && depth(point) < depth(best.point))) best = { handle: h, point, d };
    };
    if (pts.length === 1) {
      const s = scr[0];
      if (s && s.visible !== false) consider(Math.hypot(s.x - pointer.x, s.y - pointer.y), pts[0]);
      continue;
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = scr[i];
      const b = scr[i + 1];
      if (!a || !b || a.visible === false || b.visible === false) continue;
      const ab = [b.x - a.x, b.y - a.y];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1];
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((pointer.x - a.x) * ab[0] + (pointer.y - a.y) * ab[1]) / l2)) : 0;
      const d = Math.hypot(a.x + ab[0] * t - pointer.x, a.y + ab[1] * t - pointer.y);
      consider(d, add(pts[i], scale(sub(pts[i + 1], pts[i]), t)));
    }
  }
  return best;
}

// ─── what a drag does ───────────────────────────────────────────────────────

const translation = (d) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0], d[1], d[2], 1];

/** A rotation by `angle` about frame axis `i`, through point `c`. */
function rotationAbout(i, angle, c) {
  const co = Math.cos(angle);
  const si = Math.sin(angle);
  // column-major rotation about X, Y or Z
  const R =
    i === 0
      ? [1, 0, 0, 0, 0, co, si, 0, 0, -si, co, 0, 0, 0, 0, 1]
      : i === 1
        ? [co, 0, -si, 0, 0, 1, 0, 0, si, 0, co, 0, 0, 0, 0, 1]
        : [co, si, 0, 0, -si, co, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return multiplyMatrices(translation(c), multiplyMatrices(R, translation(scale(c, -1))));
}

/** A uniform scale by `k` about point `c`. */
function scalingAbout(k, c) {
  return multiplyMatrices(translation(c), multiplyMatrices([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1], translation(scale(c, -1))));
}

/** Where a ray meets the plane through `p` with normal `n`, or null (parallel, or behind its origin). */
export function planeHit(ray, p, n) {
  const den = dot(ray.dir, n);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(sub(p, ray.origin), n) / den;
  return t >= 0 ? add(ray.origin, scale(ray.dir, t)) : null;
}

/** The angle of a point about a ring's centre, in its plane (radians), or null at the centre. */
function angleOn(h, p) {
  const [u, v] = ringBasis(h.axis);
  const d = sub(p, h.center);
  const x = dot(d, u);
  const y = dot(d, v);
  return Math.hypot(x, y) > 1e-12 ? Math.atan2(y, x) : null;
}

/**
 * A drag on handle `h` from the press's ray to this ray (both in the frame):
 * the matrix that moves what the halo is on, in the frame (apply it before
 * each moved thing's matrix in the frame), or null where this ray says
 * nothing (it runs along the arrow, or misses the ring's plane).
 * @param {{ handle: object, point: number[], center: number[] }} grab  what was pressed: the handle, the point on it, the box's centre
 * @param {{ origin: number[], dir: number[] }} ray0  the press's ray
 * @param {{ origin: number[], dir: number[] }} ray  the ray now
 */
export function dragDelta(grab, ray0, ray) {
  const h = grab.handle;
  if (!ray0 || !ray) return null;
  if (h.kind === "move") {
    const e = unit(h.axis);
    const s0 = closestOnLine(grab.point, e, ray0.origin, ray0.dir);
    const s = closestOnLine(grab.point, e, ray.origin, ray.dir);
    if (s0 == null || s == null || !Number.isFinite(s0) || !Number.isFinite(s)) return null;
    return translation(scale(e, s - s0));
  }
  if (h.kind === "rotate") {
    const n = unit(h.axis);
    const p0 = planeHit(ray0, h.center, n) ?? grab.point;
    const p = planeHit(ray, h.center, n);
    const a0 = p0 ? angleOn(h, p0) : null;
    const a = p ? angleOn(h, p) : null;
    if (a0 == null || a == null) return null;
    return rotationAbout(h.axis, a - a0, h.center);
  }
  // scale: on the plane through the grabbed corner that faces the press's
  // ray, by how much further the pointer is from the centre (seen in that
  // plane: as on the screen) than at the press
  const n = ray0.dir;
  const nn = dot(n, n);
  const c = sub(grab.center, scale(n, dot(sub(grab.center, grab.point), n) / (nn || 1)));
  const p0 = planeHit(ray0, grab.point, n);
  const p = planeHit(ray, grab.point, n);
  const from = p0 ? len(sub(p0, c)) : 0;
  if (!p || !(from > 1e-12)) return null;
  return scalingAbout(Math.max(MIN_SCALE, len(sub(p, c)) / from), grab.center);
}

/** `delta` applied to a matrix in the frame. */
export const moved = (delta, m) => multiplyMatrices(delta, m);

// ─── into the doc ───────────────────────────────────────────────────────────

const matrix = (m) => (Array.isArray(m) && m.length === 16 ? m : IDENTITY_MATRIX);

/** A world matrix as a local transform under a parent whose world matrix is `parentWorld` (null: the scene). */
export function localFrom(parentWorld, world) {
  if (!parentWorld) return decomposeMatrix(matrix(world));
  const inv = invertMatrix(matrix(parentWorld));
  return decomposeMatrix(inv ? multiplyMatrices(inv, matrix(world)) : matrix(world));
}
