import { describe, it, expect } from "vitest";
import { mooredBoats, boatMesh, BOATS } from "./boats.js";
import { floatPiles, structureMesh, KINDS } from "./structures.js";
import { soup } from "./shapes.js";

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
    expect(m.positions.length / 9 / boats.length).toBeLessThan(120);
  });
  it("draws every kind: a troller's poles about 1.5 times her length, a sailboat's mast about 1.3, each above her (every kind, both headings)", () => {
    for (const type of Object.keys(BOATS)) for (const heading of [0, 2]) {
      const b = { id: `t-${type}`, type, x: 0, z: 0, heading, length: 10, beam: BOATS[type].beam * 10, trim: BOATS[type].trim[0] };
      const m = boatMesh([b]);
      let top = -Infinity, bottom = Infinity;
      for (let v = 1; v < m.positions.length; v += 3) (top = Math.max(top, m.positions[v])), (bottom = Math.min(bottom, m.positions[v]));
      expect(bottom).toBeCloseTo(-0.6, 6);
      const want = BOATS[type].poles ? 1.5 * 10 * 0.94 : BOATS[type].mast ? BOATS[type].mast * 10 : 0;
      if (want) expect(top).toBeGreaterThan(want);
      else expect(top).toBeLessThan(5);
    }
  });
  it("stands a float among its guide piles: at its edges, alternating sides, at most `every` apart, 5 to 7 m tall, from 6 m under (every pile)", () => {
    const sp = soup();
    floatPiles(sp, floats[0], 2.4, KINDS.float.piles);
    const m = sp.done();
    // each pile a six-sided cylinder: 6 sides of two triangles and two caps of six
    const per = 6 * 4 * 9;
    expect(m.positions.length % per).toBe(0);
    const piles = m.positions.length / per;
    expect(piles).toBe(9 + 4);
    for (let q = 0; q < piles; q++) {
      const P = m.positions.subarray(q * per, (q + 1) * per);
      let cx = 0, cz = 0, lo = Infinity, hi = -Infinity;
      for (let v = 0; v < P.length; v += 3) (cx += P[v] / (P.length / 3)), (cz += P[v + 2] / (P.length / 3)), (lo = Math.min(lo, P[v + 1])), (hi = Math.max(hi, P[v + 1]));
      expect(lo).toBeCloseTo(-6, 6);
      expect(hi).toBeGreaterThanOrEqual(5);
      expect(hi).toBeLessThanOrEqual(7);
      // 1.1 m off the float's line, on one leg or the other
      const onFirst = Math.abs(Math.abs(cz) - 1.1) < 0.05 && cx > -0.1 && cx < 120.1;
      const onSecond = Math.abs(Math.abs(cx - 120) - 1.1) < 0.05 && cz > -0.1 && cz < 60.1;
      expect(onFirst || onSecond).toBe(true);
    }
    // a fixed pier gets none
    expect(structureMesh([floats[1]]).positions.length).toBe(structureMesh([{ ...floats[1], id: "x" }]).positions.length);
  });
});
