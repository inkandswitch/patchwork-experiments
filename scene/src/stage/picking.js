// Picking (STAGE.md, "Picking and camera"): rays through the port, what
// they hit among the bodies they're given, the vertex snap, and building
// the pick acceleration (../pick-accel.js) in idle time. Functions of the
// camera, raycaster and meshes they're handed; nearestScreenVertex is pure.

import { Matrix3, Matrix4, Plane, Vector2, Vector3 } from "three";
import { buildBVH, wantsBVH } from "../pick-accel.js";

const v3 = (a) => (Array.isArray(a) ? new Vector3(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0) : new Vector3().copy(a));

/** The object id a node belongs to: the nearest ancestor (or itself) that carries one. */
export function objectIdOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData?.objectId) return p.userData.objectId;
  return null;
}

/** Is every node from o up drawn? (Raycasting doesn't look at visibility.) */
export function drawn(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Aim `raycaster` through a port-local point of a port `size` ({ w, h }) px; returns it. */
export function aimRay(raycaster, camera, size, x, y) {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new Vector2((x / size.w) * 2 - 1, -(y / size.h) * 2 + 1), camera);
  raycaster.far = Infinity;
  return raycaster;
}

/** Where a world point lands in the port, or null behind the camera or past far. */
export function screenOf(camera, size, world) {
  const p = v3(world).project(camera);
  if (p.z > 1 || p.z < -1) return null;
  return { x: ((p.x + 1) / 2) * size.w, y: ((1 - p.y) / 2) * size.h };
}

/**
 * A world point ([x, y, z] or a vector) in port-local px. visible: in front
 * of the camera, inside its depth range and inside the port.
 * @returns {{ x: number, y: number, visible: boolean }}
 */
export function projectPoint(camera, size, p) {
  camera.updateMatrixWorld();
  const q = v3(p).project(camera);
  const x = ((q.x + 1) / 2) * size.w;
  const y = ((1 - q.y) / 2) * size.h;
  return { x, y, visible: q.z >= -1 && q.z <= 1 && x >= 0 && x <= size.w && y >= 0 && y <= size.h };
}

/**
 * A raycaster hit as the stage hands it out. The normal is the hit face's,
 * in world, turned toward where the ray came from (meshes are double
 * sided); null for lines and points.
 */
export function hitOf(h, ray) {
  let normal = null;
  if (h.face?.normal) {
    const m = h.object.matrixWorld.clone();
    if (h.object.isInstancedMesh && h.instanceId != null) {
      const inst = new Matrix4();
      h.object.getMatrixAt(h.instanceId, inst);
      m.multiply(inst);
    }
    const n = h.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(m)).normalize();
    if (n.dot(ray.direction) > 0) n.negate();
    normal = n.toArray();
  }
  return { id: objectIdOf(h.object), point: h.point.toArray(), normal, distance: h.distance };
}

/** The nearest drawn hit among `targets` for the raycaster as it's aimed (that `accept` takes, if given). */
export function nearestHit(raycaster, targets, accept = null) {
  for (const h of raycaster.intersectObjects(targets, true)) if (drawn(h.object) && (!accept || accept(h))) return h;
  return null;
}

/**
 * The vertex nearest a screen point, in screen space, among `count` vertices
 * of one geometry. Pure.
 *
 * A part's extreme points (a corner, a tip) sit on its silhouette, where a
 * click either misses the mesh by a pixel or lands on a face that doesn't
 * contain them. So the snap looks at every vertex near the cursor, not only
 * the three of the face under it. A vertex further from the eye than
 * `maxDepth` (behind the surface the ray hit) is skipped, so it doesn't snap
 * through a solid to its far side.
 *
 * @param {ArrayLike<number>} array  positions, `stride` floats apart, starting at `offset`
 * @param {ArrayLike<number>} mvp    column-major model → clip matrix
 * @param {ArrayLike<number>} model  column-major model → world matrix
 * @returns {{ index: number, d: number, world: [number, number, number] } | null}
 */
export function nearestScreenVertex(array, { count, stride = 3, offset = 0 }, mvp, model, { width, height, x, y, maxPx, eye, maxDepth = Infinity }) {
  const m = mvp;
  let best = null;
  let bestD = maxPx;
  const maxDepth2 = maxDepth * maxDepth;
  for (let i = 0; i < count; i++) {
    const k = offset + i * stride;
    const px = array[k], py = array[k + 1], pz = array[k + 2];
    const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (!(w > 0)) continue; // behind the camera
    const sx = (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w + 1) / 2) * width;
    const sy = ((1 - (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) / 2) * height;
    const d = Math.hypot(sx - x, sy - y);
    if (!(d <= bestD)) continue;
    const wx = model[0] * px + model[4] * py + model[8] * pz + model[12];
    const wy = model[1] * px + model[5] * py + model[9] * pz + model[13];
    const wz = model[2] * px + model[6] * py + model[10] * pz + model[14];
    if ((wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2 > maxDepth2) continue;
    bestD = d;
    best = { index: i, d, world: [wx, wy, wz] };
  }
  return best;
}

/** The nearest vertex of any visible mesh under `targets` within `maxPx` of (sx, sy), in front of `maxDepth`. rect: { width, height } of the port. */
export function nearestVertex(cam, targets, sx, sy, maxPx, rect, maxDepth) {
  cam.updateMatrixWorld();
  const viewProj = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const mvp = new Matrix4();
  const eye = cam.position.toArray();
  let best = null;
  const model = new Matrix4();
  const inst = new Matrix4();
  // Cull before scanning vertices: skip any piece whose bounding sphere
  // can't come within maxPx of the cursor (or lies past maxDepth). Scanning
  // every vertex of every shown object costs tens of ms at a few million.
  const fPx = rect.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
  const view = cam.matrixWorldInverse;
  const centre = new Vector3();
  const far = (o, m, px) => {
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const bs = g.boundingSphere;
    if (!bs || !Number.isFinite(bs.radius)) return false;
    const r = bs.radius * m.getMaxScaleOnAxis();
    centre.copy(bs.center).applyMatrix4(m);
    if (Math.hypot(centre.x - eye[0], centre.y - eye[1], centre.z - eye[2]) - r > maxDepth) return true;
    centre.applyMatrix4(view);
    const cz = -centre.z;
    if (cz + r < 0) return true; // all behind the camera
    if (cz - r <= 1e-6) return false; // around the camera: can't tell
    const bx = (fPx * r * (1 + Math.abs(centre.x) / cz)) / (cz - r);
    const by = (fPx * r * (1 + Math.abs(centre.y) / cz)) / (cz - r);
    const px0 = rect.width / 2 + (centre.x / cz) * fPx;
    const py0 = rect.height / 2 - (centre.y / cz) * fPx;
    return Math.abs(px0 - sx) > bx + px || Math.abs(py0 - sy) > by + px;
  };
  // For a mesh that has its pick BVH (built in idle time after it loads),
  // visit only the triangles in BVH nodes that come within the snap
  // distance of the pick ray, not every vertex.
  const dir = new Vector3((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
  const c = new Vector3();
  const size = new Vector3();
  const viaBVH = (bvh, m, mw, limit) => {
    const scaleMax = model.getMaxScaleOnAxis();
    let found = null;
    const test = (v) => {
      const px = v.x, py = v.y, pz = v.z;
      const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
      if (!(w > 0)) return;
      const qx = (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w + 1) / 2) * rect.width;
      const qy = ((1 - (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) / 2) * rect.height;
      const d = Math.hypot(qx - sx, qy - sy);
      if (!(d <= limit)) return;
      const wx = mw[0] * px + mw[4] * py + mw[8] * pz + mw[12];
      const wy = mw[1] * px + mw[5] * py + mw[9] * pz + mw[13];
      const wz = mw[2] * px + mw[6] * py + mw[10] * pz + mw[14];
      if ((wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2 > maxDepth * maxDepth) return;
      limit = d;
      found = { d, world: [wx, wy, wz] };
    };
    bvh.shapecast({
      intersectsBounds: (box) => {
        box.getCenter(c).applyMatrix4(model);
        const r = (box.getSize(size).length() / 2) * scaleMax;
        const vx = c.x - eye[0], vy = c.y - eye[1], vz = c.z - eye[2];
        const dist = Math.hypot(vx, vy, vz);
        if (dist - r > maxDepth) return false;
        const t = vx * dir.x + vy * dir.y + vz * dir.z;
        if (t + r < 0) return false;
        const perp = Math.sqrt(Math.max(0, dist * dist - t * t));
        // a pixel off the ray at distance D is at least D / fPx away from it
        return perp <= r + ((dist + r) * limit * 1.1) / fPx;
      },
      intersectsTriangle: (tri) => {
        test(tri.a);
        test(tri.b);
        test(tri.c);
        return false;
      },
    });
    return found;
  };
  for (const group of targets) {
    group.traverseVisible((o) => {
      const attr = o.geometry?.getAttribute?.("position");
      if (!attr || attr.itemSize !== 3 || attr.normalized) return;
      const interleaved = !!attr.isInterleavedBufferAttribute;
      const layout = { count: attr.count, stride: interleaved ? attr.data.stride : 3, offset: interleaved ? attr.offset : 0 };
      const copies = o.isInstancedMesh ? o.count : 1;
      for (let c = 0; c < copies; c++) {
        model.copy(o.matrixWorld);
        if (o.isInstancedMesh) model.multiply((o.getMatrixAt(c, inst), inst));
        if (far(o, model, best ? best.d : maxPx)) continue;
        mvp.multiplyMatrices(viewProj, model);
        const bvh = o.isMesh ? o.geometry.boundsTree : null;
        if (bvh) {
          const r = viaBVH(bvh, mvp.elements, model.elements, best ? best.d : maxPx);
          if (r) best = { ...r, objectId: objectIdOf(o) };
          continue;
        }
        const r = nearestScreenVertex(interleaved ? attr.data.array : attr.array, layout, mvp.elements, model.elements, {
          width: rect.width,
          height: rect.height,
          x: sx,
          y: sy,
          maxPx: best ? best.d : maxPx,
          eye,
          maxDepth,
        });
        if (!r) continue;
        best = { ...r, objectId: objectIdOf(o) };
      }
    });
  }
  return best;
}

/**
 * What's under a port-local point among `targets` (bodies): the nearest
 * one's surface, or, with snapPx, the nearest vertex within that many px
 * (one on the silhouette beside the hit face counts too), or, with ground,
 * the y = 0 plane. Line and point objects are hit within 5 px at
 * `focusDistance` (how far ahead the camera looks).
 * @returns {{ id: string | null, point: number[], normal: number[] | null, distance: number, snapped: boolean, ground?: true } | null}
 */
export function pickAt({ raycaster, camera, size, targets, focusDistance }, x, y, { ground = false, snapPx = 0 } = {}) {
  const rect = { width: size.w, height: size.h };
  const rc = aimRay(raycaster, camera, size, x, y);
  const worldPerPx = (2 * focusDistance * Math.tan((camera.fov * Math.PI) / 360)) / rect.height;
  rc.params.Line.threshold = worldPerPx * 5;
  rc.params.Points.threshold = worldPerPx * 5;
  const eye = camera.position;
  const atVertex = (near) => ({ id: near.objectId, point: near.world, normal: null, distance: eye.distanceTo(v3(near.world)), snapped: true });

  const hit = nearestHit(rc, targets);
  if (hit) {
    const out = hitOf(hit, rc.ray);
    if (!(snapPx > 0)) return { ...out, snapped: false };
    let point = null;
    let best = snapPx;
    const pos = hit.object.geometry?.getAttribute?.("position");
    const candidates = hit.face ? [hit.face.a, hit.face.b, hit.face.c] : hit.index != null ? [hit.index, hit.index + 1] : [];
    const v = new Vector3();
    const instM = hit.object.isInstancedMesh && hit.instanceId != null ? new Matrix4() : null;
    if (instM) hit.object.getMatrixAt(hit.instanceId, instM);
    for (const i of candidates) {
      if (!pos || i >= pos.count) continue;
      v.fromBufferAttribute(pos, i);
      if (instM) v.applyMatrix4(instM);
      v.applyMatrix4(hit.object.matrixWorld);
      const p = screenOf(camera, size, v);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= best) {
        best = d;
        point = v.clone();
      }
    }
    // a nearer vertex that isn't on the hit face (a tip on the silhouette)
    const near = nearestVertex(camera, targets, x, y, point ? best : snapPx, rect, hit.distance + Math.max(worldPerPx * snapPx * 3, 1e-4));
    if (near && (!point || near.d < best)) return { ...atVertex(near), id: near.objectId ?? out.id };
    if (point) return { ...out, point: point.toArray(), distance: eye.distanceTo(point), snapped: true };
    return { ...out, snapped: false };
  }
  // missed every object by a hair: still snap to a vertex under the cursor
  const near = snapPx > 0 ? nearestVertex(camera, targets, x, y, snapPx, rect, Infinity) : null;
  if (near) return atVertex(near);
  if (ground) {
    const p = new Vector3();
    if (rc.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), p)) {
      return { id: null, point: p.toArray(), normal: [0, 1, 0], distance: rc.ray.origin.distanceTo(p), snapped: false, ground: true };
    }
  }
  return null;
}

/**
 * The nearest of `targets` along a world ray, up to `far`. Lines and points
 * are never hit. @param {number[]} origin  @param {number[]} dir  (need not be unit)
 * @returns {{ id: string, point: number[], normal: number[] | null, distance: number } | null}
 */
export function castRay(raycaster, targets, origin, dir, far = Infinity) {
  const d = v3(dir);
  if (d.lengthSq() < 1e-24) return null;
  raycaster.set(v3(origin), d.normalize());
  raycaster.far = Number(far) > 0 ? Number(far) : Infinity;
  raycaster.params.Line.threshold = 0;
  raycaster.params.Points.threshold = 0;
  try {
    const hit = nearestHit(raycaster, targets, (h) => !h.object.isLine && !h.object.isPoints);
    return hit ? hitOf(hit, raycaster.ray) : null;
  } finally {
    raycaster.far = Infinity;
  }
}

/**
 * Pick BVHs built in idle time for the big meshes of what's added (a pick
 * builds any it still lacks). @returns {{ add(root), dispose() }}
 */
export function bvhQueue() {
  const queue = new Set();
  let timer = null;
  let live = true;
  const idle = globalThis.requestIdleCallback
    ? (f) => ({ cancel: globalThis.cancelIdleCallback.bind(globalThis), id: globalThis.requestIdleCallback(f, { timeout: 3000 }) })
    : (f) => ({ cancel: clearTimeout, id: setTimeout(() => f({ timeRemaining: () => 10 }), 100) });
  const schedule = () => {
    if (timer != null || !queue.size || !live) return;
    timer = idle((deadline) => {
      timer = null;
      if (!live) return;
      for (const g of queue) {
        queue.delete(g);
        buildBVH(g);
        if (deadline.timeRemaining() < 12) break;
      }
      schedule();
    });
  };
  return {
    add(root) {
      root.traverse((o) => {
        if (o.isMesh && wantsBVH(o.geometry)) queue.add(o.geometry);
      });
      schedule();
    },
    dispose() {
      live = false;
      if (timer) timer.cancel(timer.id);
      queue.clear();
    },
  };
}
