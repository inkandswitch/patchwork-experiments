import { describe, it, expect } from "vitest";
import { parseQuantity, formatQuantity, FT, LB } from "./units.js";

const ok = (text, dim, system) => {
  const r = parseQuantity(text, dim, system);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("parseQuantity", () => {
  it("'41 ft' stores 12.4968 m", () => {
    expect(ok("41 ft", "length")).toBeCloseTo(12.4968, 12);
    expect(ok("41ft", "length")).toBeCloseTo(12.4968, 12);
    expect(ok("41'", "length")).toBeCloseTo(12.4968, 12);
  });
  it("reads feet and inches", () => {
    expect(ok("35' 6\"", "length")).toBeCloseTo(35.5 * FT, 12);
    expect(ok("35'6", "length")).toBeCloseTo(35.5 * FT, 12);
    expect(ok("35 ft 6 in", "length")).toBeCloseTo(35.5 * FT, 12);
  });
  it("reads areas, masses, angles and percentages", () => {
    expect(ok("7.06 m²", "area")).toBeCloseTo(7.06, 12);
    expect(ok("7.06 m2", "area")).toBeCloseTo(7.06, 12);
    expect(ok("76 sq ft", "area")).toBeCloseTo(76 * FT * FT, 12);
    expect(ok("10,200 lb", "mass")).toBeCloseTo(10200 * LB, 9);
    expect(ok("4.2 t", "mass")).toBe(4200);
    expect(ok("5°", "angle")).toBe(5);
    expect(ok("12%", "percent")).toBeCloseTo(0.12, 12);
  });
  it("reads a bare number in the unit the field shows", () => {
    expect(ok("12.5", "length", "metric")).toBe(12.5);
    expect(ok("41", "length", "imperial")).toBeCloseTo(12.4968, 12);
    expect(ok("12", "percent")).toBeCloseTo(0.12, 12);
  });
  it("refuses the wrong dimension and nonsense, saying why", () => {
    const r = parseQuantity("41 ft", "area");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/length/);
    expect(parseQuantity("abc", "length").ok).toBe(false);
    expect(parseQuantity("", "length").ok).toBe(false);
    expect(parseQuantity("3 furlongs", "length").error).toMatch(/not a unit/);
  });
});

describe("formatQuantity", () => {
  it("shows SI in either system", () => {
    expect(formatQuantity(12.4968, "length", "imperial")).toBe("41.00 ft");
    expect(formatQuantity(12.5, "length", "metric")).toBe("12.50 m");
    expect(formatQuantity(10200 * LB, "mass", "imperial")).toBe("10,200 lb");
    expect(formatQuantity(0.412, "percent")).toBe("41.2%");
    expect(formatQuantity(NaN, "length")).toBe("—");
  });
  it("round-trips through its own text", () => {
    for (const sys of ["metric", "imperial"]) {
      const v = 12.4968;
      expect(ok(formatQuantity(v, "length", sys), "length", sys)).toBeCloseTo(v, 2);
    }
  });
});
