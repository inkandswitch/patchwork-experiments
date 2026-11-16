// Shelter (WATER.md, "Shelter"): the shader's sums for a spot's exposure, at every exposure in hundredths and every
// sea height in tenths of a metre to 4 m (finite).
import { describe, it, expect } from "vitest";
import { EXPOSURE, tiltFor, shelteredCalm, calmFor } from "./material.js";

describe("shelter", () => {
  it("keeps the whole tilt on the open sea and a quarter of it in the most sheltered water, rising with exposure", () => {
    expect(tiltFor(1)).toBe(1);
    expect(tiltFor(0)).toBe(EXPOSURE.floor);
    let last = 0;
    for (let e = 0; e <= 100; e++) {
      const t = tiltFor(e / 100);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
  it("raises the reflection's calm to 0.85 in sheltered water and leaves the open sea's alone (every hs, every exposure)", () => {
    for (let h = 0; h <= 40; h++) for (let e = 0; e <= 100; e++) {
      const hs = h / 10, x = e / 100, c = shelteredCalm(hs, x);
      expect(c).toBeGreaterThanOrEqual(calmFor(hs) - 1e-12);
      if (x <= EXPOSURE.calmUnder[0]) expect(c).toBeCloseTo(Math.max(calmFor(hs), EXPOSURE.calm), 12);
      if (x >= EXPOSURE.calmUnder[1]) expect(c).toBeCloseTo(calmFor(hs), 12);
    }
  });
});
