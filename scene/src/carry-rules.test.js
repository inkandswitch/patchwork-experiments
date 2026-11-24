import { describe, it, expect } from "vitest";
import { accepts, nearestSnap, restHeight, yawDelta } from "./carry-rules.js";

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
  it("picks the nearest within its radius; null off the edge", () => {
    expect(nearestSnap(cands, 0.04, 0.001).id).toBe("b");
    expect(nearestSnap(cands, 0.01, 0).id).toBe("a");
    expect(nearestSnap(cands, -0.05, 0)).toBeNull();
    expect(nearestSnap(cands, 0, 0.04)).toBeNull();
  });
});

describe("restHeight", () => {
  it("rests on the highest hit, never below the ground", () => {
    expect(restHeight([null, 0.03, 0.07, null, 0.01])).toBe(0.07);
    expect(restHeight([null, null])).toBe(0);
    expect(restHeight([-1], 0)).toBe(0);
  });
});
