import { describe, it, expect } from "vitest";
import { formatLength, fromUnits, gridFor, niceStep, roundForDisplay, toUnits } from "./units.js";

describe("units", () => {
  it("converts both ways", () => {
    expect(toUnits(1, "mm")).toBeCloseTo(1000);
    expect(toUnits(0.0254, "in")).toBeCloseTo(1);
    expect(fromUnits(3, "ft")).toBeCloseTo(0.9144);
    expect(toUnits(2, "nonsense")).toBe(2);
  });
  it("formats", () => {
    expect(formatLength(0.0125, "mm")).toBe("12.5 mm");
    expect(formatLength(1.23456789, "m")).toBe("1.235 m");
    expect(formatLength(0.3048, "ft")).toBe("1 ft");
    expect(roundForDisplay(0)).toBe(0);
  });
  it("picks 1-2-5 steps", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBeCloseTo(0.05);
  });
  it("grids in round display units", () => {
    const g = gridFor(0.05, "mm"); // 50 mm half-extent
    expect(g.stepInUnits).toBe(10);
    expect(g.step).toBeCloseTo(0.01);
    expect(g.size / 2).toBeGreaterThanOrEqual(0.05);
    const h = gridFor(12, "m");
    expect(h.stepInUnits).toBe(5);
    expect(Number.isInteger(h.divisions)).toBe(true);
    expect(gridFor(0, "m").step).toBeGreaterThan(0);
  });
});
