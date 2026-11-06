// A ship's body frame, and where things sit in it (DESIGN.md, "The ship's
// frame"). Pure.
//
// The physics, the crew and the stations reason in the body frame: bow −Z,
// starboard +X, up +Y, the waterline at y = 0, the origin midships. A hull
// modelled some other way (camber's: bow +X, origin at her stern) says where
// that frame sits in its own: its GLB states it (extras.ship: forward, up,
// origin), and the trait's `sailing.ship.frame` = { position, rotation }, in
// the hull object's frame, overrides either part of it. A hull that says
// nothing is her body. Everything that turns the hull object's pose into the
// body's, or back, goes through here.

import { conjQ, eulerFromQuat, headingOf, invert, matrixOf, matrixOfPose, mulQ, multiply, poseOfMatrix, quatFromEuler, quatOfAxes, rotateQ, apply } from "./frames.js";
import { SHIP, parentOf } from "./traits.js";

/** The body frame where the hull's own is (sailing's sloop). */
export const IDENTITY = Object.freeze({ position: Object.freeze([0, 0, 0]), rotation: Object.freeze([0, 0, 0]) });

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(Number(x)));
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : null;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const tidy = (v) => v.map((x) => Math.round(x * 1e9) / 1e9 + 0);

/**
 * The body frame for a hull whose bow points along `forward` with `up` up
 * (its own frame): bow −Z, so +Z is aft; starboard +X = up × aft. null if
 * the two are missing or parallel.
 */
export function frameFromAxes(forward, up = [0, 1, 0]) {
  if (!isVec3(forward) || !isVec3(up)) return null;
  const y = unit(up.map(Number));
  const f = unit(forward.map(Number));
  if (!y || !f) return null;
  // forward made square to up, so a model's rake doesn't tip the frame
  const aft = unit(f.map((v, i) => -(v - dot(f, y) * y[i])));
  if (!aft) return null;
  const x = cross(y, aft);
  return { position: [0, 0, 0], rotation: eulerFromQuat(quatOfAxes(x, y, aft)).map((v) => v + 0) };
}

/**
 * Where a hull's GLB says her body frame sits (extras.ship): turned so her
 * bow is its `forward` and up its `up`; her origin its `origin` (midships on
 * the waterline), else, for a GLB that states which way her bow is but not
 * where her middle is, the middle of her box, level with the model's
 * waterline (through its origin, square to up). A GLB that says neither is
 * her body.
 * @param {{ extras?: object | null, box?: { min, max } | null } | null | undefined} content
 */
export function glbFrame(content) {
  const s = content?.extras?.ship;
  const up = isVec3(s?.up) ? unit(s.up.map(Number)) : [0, 1, 0];
  const turned = s && up ? frameFromAxes(s.forward, up) : null;
  const rotation = turned ? turned.rotation : [0, 0, 0];
  if (isVec3(s?.origin)) return { position: s.origin.map(Number), rotation };
  const box = content?.box;
  if (!turned || !box || !isVec3(box.min) || !isVec3(box.max)) return turned ?? IDENTITY;
  const c = box.min.map((v, i) => (Number(v) + Number(box.max[i])) / 2);
  const h = dot(c, up);
  return { position: tidy(c.map((v, i) => v - h * up[i])), rotation };
}

/**
 * Where a ship's body frame sits in her hull object's frame: what her GLB
 * says (glbFrame), with the trait's `frame` position and rotation, each
 * where it gives one, over it.
 * @param {{ frame?: { position?, rotation? } } | null | undefined} trait  sailing.ship
 * @param {{ extras?: object | null, box?: { min, max } | null } | null | undefined} content  the hull's (api.content(id))
 * @returns {{ position: number[], rotation: number[] }}
 */
export function frameOf(trait, content) {
  const glb = glbFrame(content);
  const f = trait?.frame;
  const position = isVec3(f?.position) ? f.position.map(Number) : null;
  const rotation = isVec3(f?.rotation) ? f.rotation.map(Number) : null;
  if (!position && !rotation) return glb;
  return { position: position ?? [...glb.position], rotation: rotation ?? [...glb.rotation] };
}

/** Is this frame the hull's own (nothing to convert)? */
export const isIdentity = (frame) => !frame || [...frame.position, ...frame.rotation].every((v) => v === 0);

/** The frame as a matrix in the hull's frame (body → hull object). */
export const frameMatrix = (frame) => matrixOf({ position: frame.position, rotation: frame.rotation, scale: 1 });

/**
 * The hull object's pose → her body's, at the object's scale (the frame's
 * offset is in the hull's units). Poses are { position, quaternion }.
 */
export function toBody(pose, frame, scale = 1) {
  if (isIdentity(frame)) return { position: [...pose.position], quaternion: [...pose.quaternion] };
  const off = rotateQ(pose.quaternion, frame.position.map((v) => v * scale));
  return { position: pose.position.map((v, i) => v + off[i]), quaternion: mulQ(pose.quaternion, quatFromEuler(frame.rotation)) };
}

/** Her body's pose → the hull object's (toBody's inverse). */
export function toObject(pose, frame, scale = 1) {
  if (isIdentity(frame)) return { position: [...pose.position], quaternion: [...pose.quaternion] };
  const q = mulQ(pose.quaternion, conjQ(quatFromEuler(frame.rotation)));
  const off = rotateQ(q, frame.position.map((v) => v * scale));
  return { position: pose.position.map((v, i) => v - off[i]), quaternion: q };
}

/** Which way a pose's bow (body −Z) points, as a yaw about +Y (0: down −Z). */
export const yawOf = (q) => headingOf(matrixOfPose([0, 0, 0], q));

/** A box in the hull's frame ({ min, max }) as the box around it in the body frame. */
export function bodyBox(box, frame) {
  if (!box || isIdentity(frame)) return box;
  const back = invert(frameMatrix(frame));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = apply(back, [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]]);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min: tidy(min), max: tidy(max) };
}

// ─── where things sit ───────────────────────────────────────────────────────

/**
 * Where `id` sits in `root`'s frame, by the doc's transforms (not the poses
 * drawn: a boom's swing and a wheel's turn are play's, not where they were
 * put): the product of the transforms from just under `root` down to `id`.
 * `root` null is the world. null if `id` isn't under `root`.
 * @param {{ objects, parents? }} scene  a snapshot (parents resolved), or a doc (each object's `parent`)
 */
export function placeIn(scene, id, root = null) {
  const up = (at) => (scene?.parents?.get ? parentOf(scene, at) : (scene?.objects?.[at]?.parent ?? null));
  let m = null;
  for (let at = id, n = 0; at != null && n < 64; at = up(at), n++) {
    if (at === root) return m ?? matrixOf(null);
    const o = scene?.objects?.[at];
    if (!o) return null;
    const own = matrixOf(o.transform);
    m = m ? multiply(own, m) : own;
  }
  return root == null ? (m ?? matrixOf(null)) : null;
}

/** A ship's frame (frameOf) from the stage: her trait and her GLB's extras. */
export const shipFrame = (api, id) => frameOf(api.scene?.()?.objects?.[id]?.traits?.[SHIP], api.content?.(id));

/**
 * A ship's box in her body frame, in metres (her hull's box through her
 * frame, at her hull object's scale in the world, as bodyOf is), or null
 * until her model has loaded.
 */
export function bodyBoxOf(api, id) {
  const box = bodyBox(api.content?.(id)?.box ?? null, shipFrame(api, id));
  if (!box) return null;
  const m = api.worldOf?.(id);
  const k = m ? poseOfMatrix(m).scale : 1;
  return { min: box.min.map((v) => v * k), max: box.max.map((v) => v * k) };
}

/**
 * A ship's body frame in the world, as drawn this frame (her worldOf through
 * her frame), or null. Rigid: metres, whatever her hull object's scale (a
 * hull drawn a metre long and scaled up is still sailed, walked and steered
 * in metres), as toBody gives the physics.
 */
export function bodyOf(api, id) {
  const m = api.worldOf(id);
  if (!m) return null;
  const { position, quaternion, scale } = poseOfMatrix(m);
  const body = toBody({ position, quaternion }, shipFrame(api, id), scale);
  return matrixOfPose(body.position, body.quaternion);
}
