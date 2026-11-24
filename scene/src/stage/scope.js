// One stage's view of the viewport (STAGE.md, "Views, stages and links"): the one place a
// stage's frame and its keys meet the viewport, so every spatial call an
// extension makes goes through one choke point (invariant I7).
//
// A stage works in its own root frame and its own ids. The viewport works in
// the world and in keys (./paths.js). A stage's frame F is a similarity (the
// link's drawn placement, composed up the path; the identity for the
// outermost stage): points map by F, directions and normals by its rotation,
// distances by its scale, exactly. Boxes are computed in the stage's own
// frame, from each object's own geometry, never by boxing a world box.
//
// "Not mine" is one value: a hit on anything that isn't one of the stage's
// objects (the host's deck, a sibling link, the ground) is
// `{ id: null, point, normal, distance }` in the stage's frame. A hit on
// something inside a link of this stage's is that link: the stage's element
// of the hit's path.

import { applyMatrix, invertMatrix, multiplyMatrices } from "../transform.js";
import { keyOf, parseKey } from "./paths.js";

const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

/**
 * The similarity part of a matrix (column-major 4×4), by one fixed
 * projection: scale the cube root of the determinant, rotation from the
 * polar decomposition (Newton's iteration from M/s, which is already
 * orthonormal, and so left as it is, for a similarity). Pure.
 * @returns {{ matrix: number[], scale: number, rotation: number[] }}  rotation: 3×3 column-major
 */
export function similarityOf(m) {
  const d = det3(m);
  const s = Math.cbrt(d) || 1;
  let r = [m[0] / s, m[1] / s, m[2] / s, m[4] / s, m[5] / s, m[6] / s, m[8] / s, m[9] / s, m[10] / s];
  for (let k = 0; k < 8; k++) {
    // R ← (R + R⁻ᵀ) / 2, until R Rᵀ = I
    const [a, b, c, e, f, g, h, i, j] = r;
    const dd = a * (f * j - i * g) - e * (b * j - i * c) + h * (b * g - f * c);
    if (Math.abs(dd) < 1e-12) break;
    // inverse-transpose of a column-major 3×3 is its cofactor matrix / det
    const it = [(f * j - g * i) / dd, (g * h - e * j) / dd, (e * i - f * h) / dd, (c * i - b * j) / dd, (a * j - c * h) / dd, (b * h - a * i) / dd, (b * g - c * f) / dd, (c * e - a * g) / dd, (a * f - b * e) / dd];
    const next = r.map((v, n) => (v + it[n]) / 2);
    const moved = Math.max(...next.map((v, n) => Math.abs(v - r[n])));
    r = next;
    if (moved < 1e-14) break;
  }
  const matrix = [r[0] * s, r[1] * s, r[2] * s, 0, r[3] * s, r[4] * s, r[5] * s, 0, r[6] * s, r[7] * s, r[8] * s, 0, m[12], m[13], m[14], 1];
  return { matrix, scale: s, rotation: r };
}

/**
 * Conversions between the world and a frame, a similarity's matrix or null
 * (the identity: every conversion returns what it was given). Pure.
 */
export function frameOf(m) {
  if (!m) {
    const same = (v) => v;
    return { matrix: null, inverse: null, scale: 1, pointIn: same, pointOut: same, dirIn: same, dirOut: same, lengthIn: same, lengthOut: same, matrixIn: same, matrixOut: same };
  }
  const { matrix, scale, rotation: r } = similarityOf(m);
  const inverse = invertMatrix(matrix);
  const rot = (v) => [r[0] * v[0] + r[3] * v[1] + r[6] * v[2], r[1] * v[0] + r[4] * v[1] + r[7] * v[2], r[2] * v[0] + r[5] * v[1] + r[8] * v[2]];
  const unrot = (v) => [r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[3] * v[0] + r[4] * v[1] + r[5] * v[2], r[6] * v[0] + r[7] * v[1] + r[8] * v[2]];
  return {
    matrix,
    inverse,
    scale,
    pointIn: (p) => applyMatrix(inverse, p),
    pointOut: (p) => applyMatrix(matrix, p),
    dirIn: unrot,
    dirOut: rot,
    lengthIn: (d) => d / scale,
    lengthOut: (d) => d * scale,
    matrixIn: (w) => multiplyMatrices(inverse, w),
    matrixOut: (l) => multiplyMatrices(matrix, l),
  };
}

/** A world hit in a frame: point by it, normal by its rotation, distance by its scale; `id` as given. */
export function hitIn(f, hit, id) {
  if (!hit) return null;
  const out = { ...hit, id };
  if (Array.isArray(hit.point)) out.point = f.pointIn(hit.point);
  if (Array.isArray(hit.normal)) out.normal = f.dirIn(hit.normal);
  if (Number.isFinite(hit.distance)) out.distance = f.lengthIn(hit.distance);
  return out;
}

/** A world ray { origin, dir } in a frame. */
export const rayIn = (f, r) => (r ? { origin: f.pointIn(r.origin), dir: f.dirIn(r.dir) } : null);

/** A camera ({ position?, target?, quaternion? } and the rest) between a frame and the world. */
function cameraThrough(f, cam, out) {
  if (!cam || !f.matrix) return cam;
  const c = { ...cam };
  const p = out ? f.pointOut : f.pointIn;
  if (Array.isArray(cam.position)) c.position = p(cam.position);
  if (Array.isArray(cam.target)) c.target = p(cam.target);
  if (Array.isArray(cam.up)) c.up = (out ? f.dirOut : f.dirIn)(cam.up);
  if (Array.isArray(cam.quaternion)) delete c.quaternion; // a frame turn on a quaternion: a target says the same (cameras here look at targets)
  return c;
}

/** A box { min, max } (or null) out of a frame: the box of its eight corners. */
export function boxOut(f, b) {
  if (!b || !f.matrix) return b;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = f.pointOut([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max };
}

/**
 * The viewport as stage `n` sees it.
 * @param {import("./viewport.js").Viewport} vp
 * @param {{
 *   n: number,                         // the stage's number in the view (0: the outermost)
 *   root?: string | null,              // the key of the node its root hangs under (the link's), null for the outermost
 *   frame?: () => number[] | null,     // its frame now (world matrix), null: the identity
 *   elementOf?: (key: string) => string | null,  // its element of the path a hit's key names (null: not mine)
 * }} o
 */
export function scopeViewport(vp, { n, root = null, frame = () => null, elementOf = null }) {
  const key = (id) => keyOf(n, id);
  const mine = (k) => {
    const p = parseKey(k);
    return p && p.n === n ? p.id : null;
  };
  const element = elementOf ?? mine;
  const f = () => frameOf(frame());
  const box = (b) => (b && !b.isEmpty() ? { min: b.min.toArray(), max: b.max.toArray() } : null);
  const within = () => f().inverse;
  const worldHit = (h) => (h ? hitIn(f(), h, h.id == null ? null : element(h.id)) : null);
  /** A label item `on` an object: at `offset` in its frame as drawn now, nowhere while it isn't drawn (hidden, gone). */
  const follow = (it) => (it?.on == null ? it : { ...it, at: () => ((w) => (w ? applyMatrix(f().matrixIn(w), it.offset ?? [0, 0, 0]) : null))(vp.isShown(key(it.on)) && vp.worldOf(key(it.on))) });

  return {
    n,
    key,
    /** this stage's id of a key, or null for another stage's */
    idOf: mine,
    /** the frame now: conversions (frameOf) */
    frame: f,
    get ok() {
      return vp.ok;
    },
    // objects (local ids; a root object hangs under the link's node)
    ids: () => [...vp.objects.keys()].map(mine).filter((id) => id != null),
    setGLB: (id, bytes) => vp.setGLB(key(id), bytes),
    setHint: (id, b) => vp.setHint(key(id), b),
    applyDisplay: (id, o, parent, inh) => vp.applyDisplay(key(id), o, parent != null ? key(parent) : root, inh),
    setOutline: (id, colors) => vp.setOutline(key(id), colors),
    removeObject: (id) => vp.removeObject(key(id)),
    contentOf: (id) => vp.contentOf(key(id)),
    poseOf: (id) => vp.poses.get(key(id)) ?? null,
    get posed() {
      for (const k of vp.poses.keys()) if (mine(k) != null) return true;
      return false;
    },
    setPose: (id, t) => vp.setPose(key(id), t),
    setGroups: (members) => vp.setGroups(new Map([...members].map(([g, ids]) => [key(g), ids.map(key)])), n),
    worldOf: (id) => {
      const w = vp.worldOf(key(id));
      return w ? f().matrixIn(w) : null;
    },
    // boxes, in this stage's frame, or in one of its objects' (`in`: its displayed frame); what its
    // own doc shows (I7): a host hiding the link doesn't take them away
    objectBox: (id, { hints = true, in: frameId = null } = {}) => {
      if (frameId == null) return box(vp.objectBox(key(id), { hints, within: within(), inStage: true }));
      const w = vp.worldOf(key(frameId));
      return w ? box(vp.objectBox(key(id), { hints, within: invertMatrix(w), inStage: true })) : null;
    },
    sceneBox: ({ hints = true } = {}) => box(vp.sceneBox({ hints, within: within(), stage: n })),
    // picking, in this stage's frame; "not mine" is id null
    pick: (x, y, opts) => worldHit(vp.pick(x, y, opts)),
    centerRay: () => rayIn(f(), vp.centerRay()),
    ray: (x, y) => rayIn(f(), vp.ray(x, y)),
    raycast: (origin, dir, { skip = null, far = Infinity, ...rest } = {}) => {
      const fr = f();
      const s = typeof skip === "function" ? (k) => { const id = mine(k); return id != null && skip(id); } : null;
      const h = vp.raycast(fr.pointOut(origin), fr.dirOut(dir), { ...rest, skip: s, far: Number.isFinite(far) ? fr.lengthOut(far) : far });
      return worldHit(h);
    },
    project: (p) => vp.project(f().pointOut(p)),
    // the camera, in this stage's frame
    camera: {
      get: () => cameraThrough(f(), vp.getCamera(), false),
      set: (cam) => vp.setCamera(cameraThrough(f(), cam, true)),
      frame: (b) => vp.frame(boxOut(f(), b && typeof b.isEmpty === "function" ? (b.isEmpty() ? null : { min: b.min.toArray(), max: b.max.toArray() }) : b)),
      /** ride an object of this stage, or its root (null: the link; nothing for the outermost) */
      ride: (id, opts) => (id != null ? vp.ride(key(id), opts) : root ? vp.ride(root, opts) : () => {}),
    },
    /** a body's ride spec in the viewport's keys (id null: this stage's root) */
    rideSpec: (spec) => (spec && typeof spec === "object" ? (spec.id != null ? { ...spec, id: key(spec.id) } : root ? { ...spec, id: root } : null) : null),
    // drawing, in this stage's frame: a layer hangs where the stage's root does (worldLayer's
    // `under`; the frame's similarity is the link's drawn matrix, every transform being a similarity)
    worldLayer: (owner, { onTop = false } = {}) => vp.worldLayer(keyOf(n, owner), { onTop, under: root }),
    removeLayers: (owner) => vp.removeLayers(keyOf(n, owner)),
    labels: {
      // positions in this stage's frame, which the labels follow as it moves, or an object's (`on`)
      // (shown while the link's content is: a hidden link hides its doc's labels too)
      sync: (owner, items) => vp.labels.sync(keyOf(n, owner), items.map(follow), root ? () => f().matrix : null, root ? () => vp.contentShown(root) : null),
      clear: (owner) => vp.labels.clear(keyOf(n, owner)),
    },
    setExtent: (owner, b) => vp.setExtent(keyOf(n, owner), boxOut(f(), b)),
  };
}
