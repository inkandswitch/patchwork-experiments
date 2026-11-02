import { describe, it, expect } from "vitest";
import { defaultSnapRadius, footprintSamples, liftFor, nearestSnap, restHeight, sanitizeSnapPoints, yawDelta } from "./hand.js";

describe("sanitizeSnapPoints", () => {
  it("keeps finite [x, y, z] and { position, yaw } points, drops the rest", () => {
    expect(sanitizeSnapPoints([[1, 2, 3], { position: [4, 5, 6], yaw: Math.PI }, { position: [7, 8, 9], yaw: "x" }, [1, 2], ["a", 0, 0], null, [0, 0, Infinity]])).toEqual([
      { position: [1, 2, 3], yaw: null },
      { position: [4, 5, 6], yaw: Math.PI },
      { position: [7, 8, 9], yaw: null },
    ]);
    expect(sanitizeSnapPoints("nope")).toEqual([]);
  });
  it("turns the short way round", () => {
    expect(yawDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(yawDelta(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2);
    expect(yawDelta(Math.PI, -Math.PI)).toBe(0);
  });
});

describe("defaultSnapRadius", () => {
  it("covers a square grid's cells corner to corner", () => {
    const grid = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) grid.push({ position: [i * 0.06, 0.04, j * 0.06], yaw: null });
    const r = defaultSnapRadius(grid);
    expect(r).toBeCloseTo(0.0424, 4);
    // a cell's corner is still within reach of its point
    expect(Math.hypot(0.03, 0.03)).toBeLessThanOrEqual(r + 1e-9);
  });
  it("ignores height and coincident points", () => {
    expect(defaultSnapRadius([[0, 0, 0], [0, 1, 0], [0.1, 0, 0]])).toBeCloseTo(0.0707, 4);
  });
  it("has nothing to say about a single point", () => {
    expect(defaultSnapRadius([[0, 0, 0]])).toBeNull();
    expect(defaultSnapRadius([])).toBeNull();
  });
});

describe("nearestSnap", () => {
  const cands = [
    { world: [0, 0, 0], radius: 0.03, id: "a" },
    { world: [0.06, 0, 0], radius: 0.03, id: "b" },
  ];
  it("picks the nearest within its radius", () => {
    expect(nearestSnap(cands, 0.04, 0.001).id).toBe("b");
    expect(nearestSnap(cands, 0.01, 0).id).toBe("a");
  });
  it("is null off the edge", () => {
    expect(nearestSnap(cands, -0.05, 0)).toBeNull();
    expect(nearestSnap(cands, 0, 0.04)).toBeNull();
  });
});

describe("footprintSamples / restHeight", () => {
  it("samples the centre and inset corners", () => {
    const s = footprintSamples([-1, 0, -2], [1, 5, 2], 0.5);
    expect(s[0]).toEqual([0, 0]);
    expect(s).toContainEqual([-0.5, -1]);
    expect(s).toContainEqual([0.5, 1]);
    expect(s).toHaveLength(5);
  });
  it("rests on the highest hit, never below the ground", () => {
    expect(restHeight([null, 0.03, 0.07, null, 0.01])).toBe(0.07);
    expect(restHeight([null, null])).toBe(0);
    expect(restHeight([-1], 0)).toBe(0);
  });
  it("lifts a carried piece a little, within limits", () => {
    expect(liftFor(0.03)).toBeCloseTo(0.015);
    expect(liftFor(0)).toBe(0.004);
    expect(liftFor(10)).toBe(0.05);
  });
});
