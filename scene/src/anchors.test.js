import { describe, it, expect } from "vitest";
import { Matrix4, Vector3 } from "three";
import { composeMatrix, detachAnchor, distance, localToWorld, makeAnchor, normalizeTransform, resolveAnchor, worldToLocal } from "./anchors.js";

const T = { position: [1, 2, 3], rotation: [0.3, -1.1, 2.0], scale: 2.5 };

describe("transforms", () => {
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
