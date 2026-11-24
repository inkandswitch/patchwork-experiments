import { describe, it, expect } from "vitest";
import { accepts, footprintSamples, liftFor, nearestSnap, restHeight, yawDelta } from "./carry-rules.js";

describe("what a connector takes, and turning to it", () => {
  it("an untagged connector takes anything; a tagged one only objects sharing a tag", () => {
    expect(accepts([], undefined)).toBe(true);
    expect(accepts(["Card"], ["Card", "Red"])).toBe(true);
    expect(accepts(["Card"], ["Meeple"])).toBe(false);
    expect(accepts(["Card"], undefined)).toBe(false);
  });
  it("turns the short way round", () => {
    expect(yawDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(yawDelta(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2);
    expect(yawDelta(Math.PI, -Math.PI)).toBe(0);
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
