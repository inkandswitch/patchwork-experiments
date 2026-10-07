import { describe, it, expect } from "vitest";
import { toGltf, toGltfInPlace, boxToGltf } from "./coords.js";

const cross = (a, b) =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map((v) => v + 0);

describe("doc (x east, y north, z up) → glTF (Y up)", () => {
  it("keeps east, puts up on +Y and north on −Z", () => {
    expect(toGltf([1, 0, 0])).toEqual([1, 0, 0]);
    expect(toGltf([0, 0, 1])).toEqual([0, 1, 0]);
    expect(toGltf([0, 1, 0])).toEqual([0, 0, -1]);
  });

  it("is a proper rotation: right-handed stays right-handed", () => {
    const X = toGltf([1, 0, 0]);
    const Y = toGltf([0, 1, 0]);
    const Z = toGltf([0, 0, 1]);
    // image of x × y must be the image of z
    expect(cross(X, Y)).toEqual(Z);
    expect(cross(Y, Z)).toEqual(X);
  });

  it("preserves lengths and converts flat arrays in place", () => {
    const a = new Float32Array([3, 4, 12, -1, 2, -3]);
    toGltfInPlace(a);
    expect(Array.from(a)).toEqual([3, 12, -4, -1, -3, -2]);
    expect(Math.hypot(a[0], a[1], a[2])).toBe(13);
  });

  it("boxes stay ordered", () => {
    expect(boxToGltf({ min: [-6, -6, -4], max: [16, 6, 2] })).toEqual({ min: [-6, -4, -6], max: [16, 2, 6] });
  });
});
