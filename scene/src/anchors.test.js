import { describe, it, expect } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { composeMatrix, detachAnchor, distance, localToWorld, makeAnchor, normalizeTransform, resolveAnchor, worldToLocal } from "./anchors.js";

const T = { position: [1, 2, 3], rotation: [0.3, -1.1, 2.0], scale: 2.5 };

describe("transforms", () => {
  it("matches three's Matrix4.compose with Euler XYZ", () => {
    const q = new Quaternion().setFromEuler(new Euler(...T.rotation, "XYZ"));
    const m = new Matrix4().compose(new Vector3(...T.position), q, new Vector3(T.scale, T.scale, T.scale));
    const ours = composeMatrix(T);
    m.elements.forEach((v, i) => expect(ours[i]).toBeCloseTo(v, 10));
  });
  it("round-trips local ↔ world", () => {
    const local = [0.5, -4, 7];
    const w = localToWorld(T, local);
    const three = new Vector3(...local).applyMatrix4(new Matrix4().fromArray(composeMatrix(T)));
    expect(w[0]).toBeCloseTo(three.x);
    worldToLocal(T, w).forEach((v, i) => expect(v).toBeCloseTo(local[i], 10));
  });
  it("normalises garbage", () => {
    expect(normalizeTransform({ position: [1, "x"], scale: 0 })).toEqual({ position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 });
  });
});

describe("anchors", () => {
  const objects = { a: { transform: T } };
  it("follows the object when attached", () => {
    const anchor = makeAnchor([3, 3, 3], "a", T);
    expect(resolveAnchor(anchor, objects).world.map((v) => +v.toFixed(9))).toEqual([3, 3, 3]);
    const moved = { a: { transform: { ...T, position: [11, 2, 3] } } };
    const r = resolveAnchor(anchor, moved);
    expect(r.attached).toBe(true);
    expect(r.world[0]).toBeCloseTo(13);
  });
  it("falls back to world when the object is gone", () => {
    const anchor = { objectId: "gone", local: [0, 0, 0], world: [9, 8, 7] };
    expect(resolveAnchor(anchor, objects)).toEqual({ world: [9, 8, 7], attached: false });
    expect(resolveAnchor(makeAnchor([1, 1, 1]), objects).attached).toBe(false);
  });
  it("detaches at the current position", () => {
    const anchor = makeAnchor([3, 3, 3], "a", T);
    const d = detachAnchor(anchor, { a: { transform: { ...T, position: [2, 2, 3] } } });
    expect(d.objectId).toBeNull();
    expect(d.world[0]).toBeCloseTo(4);
  });
  it("measures", () => {
    expect(distance([0, 0, 0], [3, 4, 0])).toBe(5);
  });
});
