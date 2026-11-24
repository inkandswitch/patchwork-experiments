import { describe, it, expect } from "vitest";
import { distanceToPrimitives, pointTriangleDist2, pointSegmentDist2, onSurfaceTolerance } from "./surface.js";

describe("distance to an object's geometry", () => {
  const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  it("measures to a triangle's face, edges and corners", () => {
    expect(Math.sqrt(pointTriangleDist2([0.2, 0.2, 0.5], [0, 0, 0], [1, 0, 0], [0, 1, 0]))).toBeCloseTo(0.5);
    expect(Math.sqrt(pointTriangleDist2([0.5, -1, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]))).toBeCloseTo(1);
    expect(Math.sqrt(pointTriangleDist2([2, 2, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]))).toBeCloseTo(Math.hypot(1.5, 1.5));
    expect(Math.sqrt(pointTriangleDist2([-1, -1, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]))).toBeCloseTo(Math.SQRT2);
    expect(Math.sqrt(pointSegmentDist2([0.5, 1, 0], [0, 0, 0], [1, 0, 0]))).toBeCloseTo(1);
  });
  it("takes the nearest over triangles, indexed or not, and lines", () => {
    const prims = [
      { positions: Float32Array.from(tri), index: null, mode: 4 },
      { positions: Float32Array.from([5, 0, 0, 5, 1, 0]), index: null, mode: 1 },
    ];
    expect(distanceToPrimitives(prims, [0.25, 0.25, 0])).toBe(0);
    expect(distanceToPrimitives(prims, [4.5, 0.5, 0])).toBeCloseTo(0.5);
    expect(distanceToPrimitives([{ positions: Float32Array.from(tri), index: Uint16Array.from([0, 1, 2]), mode: 4 }], [0, 0, 2])).toBeCloseTo(2);
    expect(distanceToPrimitives([], [0, 0, 0])).toBe(Infinity);
  });
  it("an anchor on a hull's old stem is off the longer hull's surface", () => {
    // a box 5 m long, and the same box 5.5 m long: the old bow corner is 0.5 m inside... of the new end face
    const box = (L) => {
      const v = [[0, 0, 0], [L, 0, 0], [L, 1, 0], [0, 1, 0], [0, 0, 1], [L, 0, 1], [L, 1, 1], [0, 1, 1]];
      const f = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
      return [{ positions: Float32Array.from(v.flat()), index: Uint16Array.from(f), mode: 4 }];
    };
    const stemTip = [5, 0.5, 0.5]; // on the old end face
    expect(distanceToPrimitives(box(5), stemTip)).toBeLessThan(onSurfaceTolerance(5.2));
    expect(distanceToPrimitives(box(5.5), stemTip)).toBeCloseTo(0.5);
    expect(onSurfaceTolerance(5)).toBeCloseTo(0.001);
    expect(onSurfaceTolerance(100)).toBeCloseTo(0.02);
  });
});
