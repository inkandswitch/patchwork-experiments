// How near the nearest geometry is to the camera, and the depth range that
// follows from it: the near plane as far out as it can go without cutting
// anything, since depth precision goes with it. Functions of the boxes and
// meshes they're given; depthRange and sceneDepth are pure.

import { Box3, Matrix4, Sphere, Triangle, Vector3 } from "three";
import { ensureBVH, triangleCount } from "./pick-accel.js";

/**
 * The near and far planes. Depth precision goes with near / distance (a
 * 24-bit buffer resolves about z² / (near · 2²⁴)), so near goes as far out
 * as it can without cutting anything: half of `clear` (nearestClear's lower
 * bound on the distance to any geometry). The half is a safety factor: the
 * near plane's corners lie further out than its centre, and what moves
 * before the next fit may come closer. When that couldn't be told (the
 * camera inside something it can't measure) near is dist / 200. Far reaches well past the
 * scene. A camera holder's own planes, where it gave them, win.
 * @param {{ dist: number, radius: number, clear: number, known?: boolean, held?: { near?: number, far?: number } | null }} o
 */
export function depthRange({ dist, radius, clear, known = true, held = null }) {
  const near = known ? Math.max(clear / 2, 1e-4) : Math.max(dist / 200, 1e-4);
  const far = Math.max(dist * 100, dist + radius * 20, 10);
  return { near: held?.near ?? near, far: held?.far ?? far };
}

/**
 * What the depth range is fitted from, given each shown object's content
 * (null while it's a hint) and world box, and the boxes extensions said the
 * near plane must not cut (extents): each object's box with a margin of 5%
 * (at least 5 cm), so what moves without a refit (a loop's dressing of an
 * object's nodes) stays clear of the near plane, and the radius of
 * everything together (1 when there's nothing).
 * @param {Iterable<{ content: object | null, box: Box3 }>} shown  @param {Iterable<Box3>} extents
 * @returns {{ near: [object | null, Box3][], radius: number }}
 */
export function sceneDepth(shown, extents) {
  const all = new Box3();
  const near = [];
  for (const { content, box } of shown) {
    all.union(box);
    const r = box.getBoundingSphere(new Sphere()).radius;
    near.push([content, box.clone().expandByScalar(Math.max(0.05, r * 0.05))]);
  }
  for (const b of extents) all.union(b);
  return { near, radius: all.isEmpty() ? 1 : Math.max(all.getBoundingSphere(new Sphere()).radius, 1e-4) };
}

/**
 * How near the nearest geometry is to world point p: { clear, known }.
 * clear is a lower bound: the nearest box's distance, and for a box p is
 * inside, the distance to that object's triangles (its BVH, built on the
 * way). known is false when p is inside something that can't be measured
 * (a skinned mesh, a box still loading, an extent).
 * @param {Vector3} p  @param {Iterable<Box3>} extents  @param {[object | null, Box3][]} near  sceneDepth's
 */
export function nearestClear(p, extents, near) {
  let clear = Infinity;
  for (const b of extents) {
    const d = b.distanceToPoint(p);
    if (d === 0) return { clear: 0, known: false };
    if (d < clear) clear = d;
  }
  const inside = [];
  for (const [content, b] of near) {
    const d = b.distanceToPoint(p);
    if (d > 0) clear = Math.min(clear, d);
    else inside.push(content);
  }
  for (const content of inside) {
    if (!content) return { clear: 0, known: false };
    const d = contentClear(content, p, clear);
    if (d == null) return { clear: 0, known: false };
    clear = d;
  }
  return Number.isFinite(clear) ? { clear, known: true } : { clear: 0, known: false };
}

/** Meshes up to this many triangles are measured triangle by triangle when they move their own vertices. */
const BRUTE_MAX = 4_000;
const _inv = new Matrix4();
const _inst = new Matrix4();
const _mw = new Matrix4();
const _lp = new Vector3();
const _wb = new Box3();
const _tri = new Triangle();
const _ta = new Vector3();
const _tb = new Vector3();
const _tc = new Vector3();
const _cp = new Vector3();
const _hit = {};
const _walk = [];

/** The smallest stretch a matrix gives any direction (its columns' shortest, for a TRS matrix). */
function minScale(m) {
  const e = m.elements;
  return Math.min(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
}

/** The nearest of a geometry's triangles to local point p, one by one. */
function bruteClosest(g, p) {
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  let best = Infinity;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
    _tri.set(_ta.fromBufferAttribute(pos, a), _tb.fromBufferAttribute(pos, b), _tc.fromBufferAttribute(pos, c));
    _tri.closestPointToPoint(p, _cp);
    const d = _cp.distanceToSquared(p);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * A lower bound on how far world point p is from a geometry drawn with world
 * matrix m: its box's distance when p is outside it, else its nearest
 * triangle's (by BVH, or one by one for a mesh that moves its own vertices,
 * whose box and BVH are stale). null: it can't tell (skinned, morphing, or
 * too big to measure by hand).
 */
function geometryClear(g, m, p, mesh, best = Infinity) {
  if (!g?.attributes?.position) return Infinity;
  const moving = mesh.frustumCulled === false;
  if (mesh.isSkinnedMesh || g.morphAttributes?.position?.length) {
    if (!g.boundingBox) g.computeBoundingBox();
    _wb.copy(g.boundingBox).applyMatrix4(m);
    const d = _wb.expandByVector(_wb.getSize(_ta).multiplyScalar(0.5)).distanceToPoint(p);
    return d > 0 ? d : null;
  }
  if (!moving) {
    if (!g.boundingBox) g.computeBoundingBox();
    const d = _wb.copy(g.boundingBox).applyMatrix4(m).distanceToPoint(p);
    if (d > 0) return d;
  }
  const s = minScale(m);
  if (!(s > 0)) return null;
  _lp.copy(p).applyMatrix4(_inv.copy(m).invert());
  if (!moving && ensureBVH(g)) {
    // nothing within `best` (scaled into its frame) is as good as Infinity
    const hit = g.boundsTree.closestPointToPoint(_lp, _hit, 0, Number.isFinite(best) ? best / s : Infinity);
    return hit ? hit.distance * s : Infinity;
  }
  if (triangleCount(g) <= BRUTE_MAX) return bruteClosest(g, _lp) * s;
  return null;
}

/** A lower bound on how far p is from what's drawn under root, or `best` if that's nearer (null: it can't tell). */
function contentClear(root, p, best) {
  root.updateWorldMatrix(true, true);
  _walk.length = 0;
  _walk.push(root);
  let clear = best;
  while (_walk.length) {
    const o = _walk.pop();
    if (!o.visible) continue;
    if (o.isMesh && o.geometry) {
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, _inst);
          const d = geometryClear(o.geometry, _mw.multiplyMatrices(o.matrixWorld, _inst), p, o, clear);
          if (d == null) return null;
          if (d < clear) clear = d;
        }
      } else {
        const d = geometryClear(o.geometry, o.matrixWorld, p, o, clear);
        if (d == null) return null;
        if (d < clear) clear = d;
      }
    }
    for (const c of o.children) _walk.push(c);
  }
  return clear;
}
