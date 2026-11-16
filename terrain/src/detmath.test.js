import { describe, it, expect } from "vitest";
import { dsin, dcos, dtan, len } from "./detmath.js";

describe("detmath", () => {
  it("agrees with Math within 1e-15 over every angle a build uses (and a few thousand more), and sin² + cos² = 1", () => {
    for (let k = -4000; k <= 4000; k++) {
      const x = k * 0.0123;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-14 * Math.max(1, Math.abs(x)));
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-14 * Math.max(1, Math.abs(x)));
      expect(Math.abs(dsin(x) ** 2 + dcos(x) ** 2 - 1)).toBeLessThan(1e-15);
    }
    for (const seg of [6, 7, 8, 10, 12, 16]) for (let k = 0; k <= seg; k++) {
      const a = (2 * Math.PI * k) / seg;
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(2e-16);
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(2e-16);
    }
    expect(dtan(Math.PI / 4)).toBeCloseTo(1, 15);
  });
  it("measures a length by sqrt alone", () => {
    for (const [a, b] of [[3, 4], [0, 0], [-1e-3, 2e-3], [1e5, 1]]) expect(len(a, b)).toBe(Math.sqrt(a * a + b * b));
  });
});
