import { describe, it, expect } from "vitest";
import { mooredBoats, boatMesh, BOATS } from "./boats.js";

describe("boats on the floats (dressing)", () => {
  const floats = [
    { id: "way/1", kind: "pier", floating: true, area: false, width: null, points: [[0, 0], [120, 0], [120, 60]] },
    { id: "way/2", kind: "pier", floating: false, area: false, width: null, points: [[0, 50], [100, 50]] },
    { id: "way/3", kind: "breakwater", floating: false, area: true, width: null, points: [[0, 90], [10, 90], [10, 95]] },
  ];
  const boats = mooredBoats(floats);
  it("moors boats only along floats, beside them (half the float, half the boat and 0.4 m off its line), at the middle of 12 m slips", () => {
    expect(boats.length).toBeGreaterThan(0);
    for (const b of boats) {
      expect(b.id.startsWith("way/1#")).toBe(true);
      const B = BOATS[b.type];
      expect(b.length).toBeGreaterThanOrEqual(B.length[0]);
      expect(b.length).toBeLessThanOrEqual(B.length[1] + 1e-9);
      const off = 1.2 + b.beam / 2 + 0.4;
      const onFirst = Math.abs(Math.abs(b.z) - off) < 0.02 && b.x > 0 && b.x < 120;
      const onSecond = Math.abs(Math.abs(b.x - 120) - off) < 0.02 && b.z > 0 && b.z < 60;
      expect(onFirst || onSecond).toBe(true);
      if (onFirst) expect(((b.x - 6) / 12) % 1).toBeCloseTo(0, 6);
    }
  });
  it("fills each slip by its own hash: the same boats every time, and the same whatever other floats there are", () => {
    expect(mooredBoats(structuredClone(floats))).toEqual(boats);
    expect(mooredBoats([floats[0]])).toEqual(boats);
  });
  it("draws them as a soup, a few dozen triangles a boat", () => {
    const m = boatMesh(boats);
    expect(m.positions.length / 9 / boats.length).toBeGreaterThan(20);
    expect(m.positions.length / 9 / boats.length).toBeLessThan(80);
  });
});
