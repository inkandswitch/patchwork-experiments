// The camera rig (STAGE.md, `camera`): the orbit on the canvas, getting,
// setting and framing the camera, holding it (orbit off), and riding
// (./ride.js: carried by a moving object). One rig per viewport, on the
// camera and DOM element it's given.

import { Box3, Sphere, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const v3 = (a) => (Array.isArray(a) ? new Vector3(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0) : new Vector3().copy(a));

/**
 * Where the orbit target goes when the camera is let go: straight ahead of
 * it, as far as the orbit was looking before it was held (1 if that's
 * unknown), so the first orbit after a release turns about what's in front.
 * @param {number[]} position  [x, y, z]
 * @param {number[]} forward   the camera's view direction (need not be unit)
 * @returns {[number, number, number]}
 */
export function reseatTarget(position, forward, distance) {
  const len = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  const d = Number.isFinite(distance) && distance > 1e-6 ? distance : 1;
  return [position[0] + (forward[0] / len) * d, position[1] + (forward[1] / len) * d, position[2] + (forward[2] / len) * d];
}

/**
 * Drop whatever motion OrbitControls still has queued (the damped tail of a
 * fling, a half-applied pan or zoom, toward the cursor or not), so a camera
 * that was just set or let go stays where it was put. These are
 * OrbitControls' private fields (three 0.186); anything missing is left alone.
 */
export function resetOrbitMotion(controls) {
  controls?._sphericalDelta?.set?.(0, 0, 0);
  controls?._panOffset?.set?.(0, 0, 0);
  if (controls && "_scale" in controls) controls._scale = 1;
  if (controls && "_performCursorZoom" in controls) controls._performCursorZoom = false;
}

/** A Box3 from a Box3 or a { min, max } of arrays (or vectors); null if it isn't one. */
export function toBox3(box) {
  if (!box) return null;
  if (box.isBox3) return box;
  if (!box.min || !box.max) return null;
  const b = new Box3(v3(box.min), v3(box.max));
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite) ? b : null;
}

/**
 * The rig on `camera`, its orbit listening on `dom`; `ended(how)` when
 * someone finishes moving it: an orbit or zoom ("orbit") or a Frame ("frame").
 * @param {{ camera: import("three").PerspectiveCamera, dom: HTMLElement, rides: ReturnType<import("./ride.js").createRides>, worldOf: (id: string) => number[] | null, invalidate: () => void, ended: (how: string) => void }} o
 */
export function createCamera({ camera, dom, rides, worldOf, invalidate, ended }) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  // the wheel zooms toward what's under the pointer, and the orbit's centre moves with it: a
  // camera whose centre is elsewhere (at the edge of what it looks over) zooms where you point
  controls.zoomToCursor = true;
  /** how many hold() calls are outstanding */
  let holds = 0;
  /** how far ahead the orbit target was when the camera was taken (or set while held) */
  let holdDistance = 1;
  /** a holder's own { near, far }, given through set while held */
  let heldDepth = null;
  let touched = false;

  const forward = () => camera.getWorldDirection(new Vector3());

  /** @returns {{ position: number[], target: number[], fov: number, up: number[] }} (while held, target is straight ahead; up: the picture's, rolled as the camera is) */
  function get() {
    const position = camera.position.toArray();
    const target = holds > 0 ? reseatTarget(position, forward().toArray(), holdDistance) : controls.target.toArray();
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray();
    return { position, target, fov: camera.fov, up };
  }

  controls.addEventListener("change", () => invalidate());
  controls.addEventListener("start", () => {
    touched = true;
  });
  controls.addEventListener("end", () => ended("orbit"));

  /**
   * Move the camera. Every field is optional. While the orbit has it, the
   * camera always looks at its target: a quaternion without a target moves
   * the target in front of it. While held, it goes exactly where it's put
   * (quaternion, else looking at target), and near / far given here replace
   * the automatic ones until the last release.
   * @param {{ position?, target?, quaternion?: number[] | Quaternion, fov?: number, near?: number, far?: number }} cam
   */
  function set(cam) {
    if (!cam) return;
    if (cam.position) camera.position.copy(v3(cam.position));
    const fov = Number(cam.fov);
    if (cam.fov != null && Number.isFinite(fov) && fov !== camera.fov) {
      camera.fov = Math.min(179, Math.max(1, fov));
      camera.updateProjectionMatrix();
    }
    const q = cam.quaternion ? (Array.isArray(cam.quaternion) ? cam.quaternion.map(Number) : [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w]) : null;
    const quat = q && q.length === 4 && q.every(Number.isFinite) ? q : null;
    const target = cam.target ? v3(cam.target) : null;
    if (holds > 0) {
      const near = Number(cam.near);
      const far = Number(cam.far);
      if (cam.near != null && near > 0) heldDepth = { ...heldDepth, near };
      if (cam.far != null && far > 0) heldDepth = { ...heldDepth, far };
      if (quat) camera.quaternion.fromArray(quat).normalize();
      else if (target) camera.lookAt(target);
      if (target) holdDistance = Math.max(camera.position.distanceTo(target), 1e-6);
      camera.updateMatrixWorld();
    } else {
      if (target) controls.target.copy(target);
      else if (quat) {
        const dist = Math.max(camera.position.distanceTo(controls.target), 1e-6);
        camera.quaternion.fromArray(quat).normalize();
        controls.target.fromArray(reseatTarget(camera.position.toArray(), forward().toArray(), dist));
      }
      resetOrbitMotion(controls);
      controls.update();
    }
    invalidate();
  }

  /** Look at a box ({ min, max } or Box3; a 1 m cube on the ground if it's empty) from the current direction. */
  function frame(box) {
    let b = toBox3(box);
    if (!b || b.isEmpty()) b = new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
    const sphere = b.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 1e-4);
    const fov = (camera.fov * Math.PI) / 180;
    const fit = radius / Math.sin(Math.min(fov, fov * camera.aspect) / 2);
    let dir = holds > 0 ? forward().negate() : camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-12) dir = new Vector3(1, 0.8, 1.4);
    dir.normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, fit * 1.1);
    if (holds > 0) {
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      holdDistance = fit * 1.1;
    } else {
      controls.target.copy(sphere.center);
      resetOrbitMotion(controls);
      controls.update();
    }
    invalidate();
    ended("frame");
  }

  function release() {
    if (holds <= 0 || --holds > 0) return;
    heldDepth = null;
    controls.target.fromArray(reseatTarget(camera.position.toArray(), forward().toArray(), holdDistance));
    resetOrbitMotion(controls);
    controls.enabled = true;
    controls.update();
    invalidate();
  }

  /**
   * Take the camera from the orbit. While anything holds it the orbit is off
   * and not updated. The last release puts the orbit
   * target straight ahead, as far as it was, so orbiting resumes about
   * what's in front of the camera, without any motion left over from before.
   * @returns {() => void} release (calling it again does nothing)
   */
  function hold() {
    if (holds++ === 0) {
      holdDistance = Math.max(camera.position.distanceTo(controls.target), 1e-6);
      heldDepth = null;
      resetOrbitMotion(controls);
      controls.enabled = false;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  /** The camera's up, and the orbit's with it (OrbitControls keeps up through its _quat, made from camera.up). */
  function setUp(up) {
    const u = camera.up;
    if (Math.abs(u.x - up[0]) < 1e-12 && Math.abs(u.y - up[1]) < 1e-12 && Math.abs(u.z - up[2]) < 1e-12) return;
    u.set(up[0], up[1], up[2]).normalize();
    if (controls._quat) {
      controls._quat.setFromUnitVectors(u, new Vector3(0, 1, 0));
      controls._quatInverse.copy(controls._quat).invert();
    }
    invalidate();
  }

  return {
    controls,
    get,
    set,
    frame,
    hold,
    forward,
    get held() {
      return holds > 0;
    },
    /** a holder's own { near, far } while held, else null */
    get heldDepth() {
      return holds > 0 ? heldDepth : null;
    },
    /** How far ahead of the camera the orbit is looking (while held: how far it was). */
    focusDistance: () => (holds > 0 ? holdDistance : camera.position.distanceTo(controls.target)),
    /** What the camera looks about: the orbit's target, or, held, the camera itself. */
    focusPoint: () => (holds > 0 ? camera.position.toArray() : controls.target.toArray()),
    /**
     * Carry the orbit camera with object `id` as it moves (./ride.js): each
     * frame, after the loops, the camera and its target move by the shift of
     * its point `at` (its frame; its origin), its turn about the vertical
     * (`turn`) and its rise (`rise`). A base ride: the latest applies while
     * the current body has no ride of its own; while the camera is held,
     * none moves it. @returns {() => void} off
     */
    ride(id, opts) {
      // from where it's drawn now: a view set from it this frame is followed from this frame
      const off = rides.add(id, opts, worldOf(id));
      invalidate();
      return off;
    },
    /** The current body's ride ({ id, at?, turn?, rise? }), the only one that applies while set; null: none. */
    bodyRide(spec) {
      rides.body(spec ?? null, spec?.id != null ? worldOf(spec.id) : null);
      invalidate();
    },
    /** One frame of the ride that applies (the frame loop's, after the loops), then the orbit's. @returns {boolean} whether the camera moved */
    step() {
      const out = rides.step({ worldOf, held: holds > 0, position: camera.position.toArray(), target: controls.target.toArray() });
      // a ride that tilts carries the camera's up with its object; otherwise up is the world's
      if (out?.up) setUp(out.up);
      else if (!rides.tilts()) setUp([0, 1, 0]);
      if (out) {
        camera.position.fromArray(out.position);
        controls.target.fromArray(out.target);
        invalidate();
      }
      // while held, the orbit neither moves the camera nor re-aims it
      return holds > 0 ? false : controls.update();
    },
    /** Has the person orbited, panned or zoomed since this rig was made? */
    touched: () => touched,
    dispose() {
      controls.dispose();
    },
  };
}
