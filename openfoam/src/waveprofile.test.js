import { describe, it, expect } from "vitest";
import { waveProfile } from "./waveprofile.js";

/**
 * A water surface on a grid over x ∈ [−5, 15], y ∈ [−5, 5], with a hole
 * where the hull is (x ∈ [0, 10], |y| < 1): the height is z(x, y), so along
 * the hole's edge it is the profile.
 */
function surfaceAround(z, { half = false } = {}) {
  const xs = Array.from({ length: 81 }, (_, i) => -5 + i * 0.25);
  const ys = Array.from({ length: 41 }, (_, j) => -5 + j * 0.25).filter((y) => !half || y <= 0);
  const pos = [];
  const id = (i, j) => i * ys.length + j;
  for (const x of xs) for (const y of ys) pos.push(x, y, z(x, y));
  const idx = [];
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (cx > 0 && cx < 10 && Math.abs(cy) < 1) continue; // the hull
      idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), half };
}

describe("the wave profile along the hull", () => {
  const hull = { xMin: 0, xMax: 10 };
  it("follows the water's height where it meets the hull, side by side", () => {
    // a bow wave and a trough, higher on starboard (y < 0)
    const z = (x, y) => 0.3 * Math.exp(-((x - 9) ** 2)) - 0.1 * Math.exp(-((x - 5) ** 2)) + (y < 0 ? 0.05 : 0);
    const prof = waveProfile(surfaceAround(z), hull, { stations: 40 });
    expect(prof.map((p) => p.side)).toEqual(["starboard", "port"]);
    for (const p of prof) {
      const off = p.side === "starboard" ? 0.05 : 0;
      // within the hull's length, stern to bow
      expect(p.points[0][0]).toBeGreaterThanOrEqual(-0.06);
      expect(p.points.at(-1)[0]).toBeLessThanOrEqual(10.06);
      for (let i = 1; i < p.points.length; i++) expect(p.points[i][0]).toBeGreaterThan(p.points[i - 1][0]);
      // the bow wave's crest and the trough, at their heights
      const crest = p.points.reduce((a, b) => (b[1] > a[1] ? b : a));
      expect(crest[0]).toBeGreaterThan(8.5);
      expect(crest[1]).toBeCloseTo(0.3 + off, 1);
      const trough = p.points.filter((q) => q[0] > 3 && q[0] < 7).reduce((a, b) => (b[1] < a[1] ? b : a));
      expect(trough[1]).toBeCloseTo(-0.1 + off, 1);
    }
  });
  it("ignores the domain's own edges", () => {
    // a flat surface: the profile is flat at 0, and nothing from the outer boundary (|y| = 5) gets in
    const prof = waveProfile(surfaceAround(() => 0), hull);
    for (const p of prof) for (const [, z] of p.points) expect(z).toBe(0);
  });
  it("gives one profile, for both sides, on a half model", () => {
    const prof = waveProfile(surfaceAround((x) => 0.1 * Math.sin(x), { half: true }), hull);
    expect(prof).toHaveLength(1);
    expect(prof[0].side).toBe("both");
  });
});
