import { describe, it, expect } from "vitest";
import { sampleColormap, robustRange, resolveRange, bakeColors, symmetricRange, toLinear } from "./colormap.js";

describe("colormaps", () => {
  it("viridis runs dark purple → yellow", () => {
    const a = sampleColormap("viridis", 0);
    const b = sampleColormap("viridis", 1);
    expect(a[2]).toBeGreaterThan(a[1]); // purple
    expect(b[0] + b[1]).toBeGreaterThan(1.5); // yellow
    expect(sampleColormap("viridis", -3)).toEqual(a);
    expect(sampleColormap("viridis", NaN)).toEqual(a);
  });

  it("cool-warm is blue → grey → red", () => {
    const [lo, mid, hi] = [0, 0.5, 1].map((t) => sampleColormap("coolwarm", t));
    expect(lo[2]).toBeGreaterThan(lo[0]);
    expect(hi[0]).toBeGreaterThan(hi[2]);
    expect(Math.abs(mid[0] - mid[2])).toBeLessThan(0.05);
  });

  it("turbo stays in gamut", () => {
    for (let t = 0; t <= 1; t += 0.05) for (const c of sampleColormap("turbo", t)) expect(c).toBeGreaterThanOrEqual(0);
  });

  it("robust ranges ignore outliers and never collapse", () => {
    const v = Array.from({ length: 100 }, (_, i) => i / 100);
    v.push(1e6, -1e6, NaN);
    const [a, b] = robustRange(v);
    expect(a).toBeGreaterThan(-0.1);
    expect(b).toBeLessThan(1.1);
    const [c, d] = robustRange([2, 2, 2]);
    expect(d).toBeGreaterThan(c);
    expect(robustRange([])).toEqual([0, 1]);
  });

  it("explicit ranges win when auto is off", () => {
    expect(resolveRange([0, 10], { autoRange: false, colorMin: 3, colorMax: 1 })).toEqual([1, 3]);
    expect(resolveRange([0, 10], { autoRange: false, colorMin: 3, colorMax: 3 })).not.toEqual([3, 3]);
    expect(symmetricRange([-0.2, 0.5])).toEqual([-0.5, 0.5]);
  });

  it("bakes linear colours, clamped", () => {
    const c = bakeColors([0, 1, 5], [0, 1], "viridis");
    expect(c).toHaveLength(9);
    expect(Array.from(c.slice(6))).toEqual(Array.from(c.slice(3, 6)));
    const lin = toLinear(sampleColormap("viridis", 0));
    expect(c[0]).toBeCloseTo(lin[0], 6);
    expect(lin[0]).toBeLessThan(sampleColormap("viridis", 0)[0]); // linear is darker than sRGB
  });
});
