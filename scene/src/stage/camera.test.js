// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { Box3, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { createCamera, reseatTarget } from "./camera.js";
import { createRides } from "./ride.js";

const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);

/** A rig on a fresh camera; `objects`: id → world matrix, what rides follow. */
function rig(objects = {}) {
  const camera = new PerspectiveCamera(45, 2, 0.01, 1000);
  const ended = vi.fn();
  const r = createCamera({ camera, dom: document.createElement("div"), rides: createRides(), worldOf: (id) => objects[id] ?? null, invalidate: () => {}, ended });
  return { camera, r, ended };
}

describe("re-seating the orbit", () => {
  it("puts the target straight ahead at the old distance (1 m when that's unknown)", () => {
    expect(reseatTarget([1, 2, 3], [0, 0, -2], 4)).toEqual([1, 2, -1]);
    expect(reseatTarget([0, 0, 0], [1, 0, 0], 0)).toEqual([1, 0, 0]);
    expect(reseatTarget([0, 0, 0], [1, 0, 0], NaN)).toEqual([1, 0, 0]);
  });
});

describe("the camera rig", () => {
  it("holds: the orbit is off; the last release re-seats the target ahead at the old distance", () => {
    const { camera, r } = rig();
    r.set({ position: [0, 0, 10], target: [0, 0, 0] });
    const a = r.hold();
    const b = r.hold();
    expect(r.controls.enabled).toBe(false);
    expect(r.held).toBe(true);
    // the holder turns the camera to look down −x from elsewhere
    r.set({ position: [5, 1, 0], quaternion: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] });
    expect(r6(r.get().target)).toEqual([-5, 1, 0]);
    a();
    a(); // twice is once
    expect(r.held).toBe(true);
    b();
    expect(r.held).toBe(false);
    expect(r.controls.enabled).toBe(true);
    expect(r6(r.controls.target.toArray())).toEqual([-5, 1, 0]);
    expect(r6(camera.position.toArray())).toEqual([5, 1, 0]);
  });

  it("while held, a target sets the distance the release uses, and near / far are the holder's", () => {
    const { r } = rig();
    r.set({ position: [0, 0, 10], target: [0, 0, 0] });
    const release = r.hold();
    r.set({ position: [0, 0, 3], target: [0, 0, 1], near: 0.05, far: 80 });
    expect(r.heldDepth).toEqual({ near: 0.05, far: 80 });
    expect(r.focusDistance()).toBeCloseTo(2);
    expect(r.focusPoint()).toEqual([0, 0, 3]);
    release();
    expect(r.heldDepth).toBe(null);
    expect(r6(r.controls.target.toArray())).toEqual([0, 0, 1]);
    expect(r.focusPoint()).toEqual(r.controls.target.toArray());
    // not held: near / far aren't the caller's
    r.set({ near: 1 });
    expect(r.heldDepth).toBe(null);
  });

  it("sets position, target, quaternion and fov; fov changes are watched", () => {
    const { camera, r } = rig();
    const watch = vi.fn();
    const off = r.watch(watch);
    r.set({ position: [0, 5, 0.0001], target: [0, 0, 0] });
    expect(r6(r.get().target)).toEqual([0, 0, 0]);
    expect(watch).not.toHaveBeenCalled();
    r.set({ fov: 60 });
    expect(camera.fov).toBe(60);
    expect(watch).toHaveBeenCalledOnce();
    expect(watch.mock.calls[0][0].fov).toBe(60);
    off();
    r.set({ fov: 30 });
    expect(watch).toHaveBeenCalledOnce();
    // a quaternion alone, orbiting: the target moves in front, as far as it was
    r.set({ position: [0, 0, 4], target: [0, 0, 0] });
    r.set({ quaternion: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] });
    expect(r6(r.controls.target.toArray())).toEqual([-4, 0, 4]);
  });

  it("frames a box from the current direction, with arrays or a Box3, held or not", () => {
    const { camera, r } = rig();
    r.set({ position: [0, 0, 10], target: [0, 0, 0] });
    r.frame({ min: [9, -1, -1], max: [11, 1, 1] });
    expect(r6(r.controls.target.toArray())).toEqual([10, 0, 0]);
    expect(camera.position.x).toBeCloseTo(10);
    expect(camera.position.z).toBeGreaterThan(1);
    // while held it frames too, and the release orbits about the box
    const release = r.hold();
    r.frame(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)));
    release();
    expect(r6(r.controls.target.toArray())).toEqual([0, 0, 0]);
  });

  it("tells the end of an orbit and of a Frame, and whether anyone touched it", () => {
    const { r, ended } = rig();
    expect(r.touched()).toBe(false);
    r.controls.dispatchEvent({ type: "start" });
    r.controls.dispatchEvent({ type: "end" });
    expect(r.touched()).toBe(true);
    r.frame({ min: [-1, 0, -1], max: [1, 1, 1] });
    expect(ended.mock.calls).toEqual([["orbit"], ["frame"]]);
  });

  it("riding carries the orbit camera and its target with the object, and stops when let go", () => {
    const objects = { hull: new Matrix4().toArray() };
    const { camera, r } = rig(objects);
    r.set({ position: [0, 3, 10], target: [0, 0, 0] });
    const off = r.ride("hull");
    r.step(); // the baseline
    objects.hull = new Matrix4().makeTranslation(2, 0, 0).toArray();
    r.step();
    expect(r6(camera.position.toArray())).toEqual([2, 3, 10]);
    expect(r6(r.controls.target.toArray())).toEqual([2, 0, 0]);
    const before = camera.position.toArray();
    off();
    objects.hull = new Matrix4().makeTranslation(9, 0, 0).toArray();
    r.step();
    expect(r6(camera.position.toArray())).toEqual(r6(before));
  });
});
