import { describe, it, expect } from "vitest";
import { settled, settledAt } from "./convergence.js";

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

describe("settled", () => {
  it("is not settled before the minimum, however flat", () => {
    expect(settled(range(499, () => 100)).settled).toBe(false);
    expect(settled(range(500, () => 100)).settled).toBe(true);
  });
  it("is settled on a constant", () => {
    const r = settled(range(1000, () => 100));
    expect(r).toMatchObject({ settled: true, window: 100, change: 0, scatter: 0 });
  });
  it("is not settled on a steady drift of 1% a window or more", () => {
    // drops 1.5 per 100 iterations at a mean near 50: 3% a window
    expect(settled(range(1000, (i) => 65 - 0.015 * i)).settled).toBe(false);
    expect(settled(range(1000, (i) => 65 - 0.015 * i)).why).toMatch(/still moving/);
  });
  it("is not settled while oscillating by more than the tolerance", () => {
    const r = settled(range(1000, (i) => 100 + 5 * Math.sin(i / 3)));
    expect(r.change).toBeLessThan(0.01);
    expect(r.settled).toBe(false);
    expect(r.why).toMatch(/scattering/);
  });
  it("grows its window with the run: a tenth of it", () => {
    expect(settled(range(3000, () => 1)).window).toBe(300);
  });
  it("finds when a decaying transient settles", () => {
    // 100 + 50·e^(−i/200): within 1% of itself between windows once the decay is small
    const at = settledAt(range(4000, (i) => 100 + 50 * Math.exp(-i / 200)));
    expect(at).toBeGreaterThan(500);
    expect(at).toBeLessThan(2000);
    // and it really is settled there, and not 10 iterations before
    const v = range(at, (i) => 100 + 50 * Math.exp(-i / 200));
    expect(settled(v).settled).toBe(true);
    expect(settled(v.slice(0, at - 10)).settled).toBe(false);
  });
});
