import { describe, it, expect } from "vitest";
import { harmonicFill } from "./fill.js";

describe("harmonicFill", () => {
  const n = 9;
  const plane = (i, j) => 2 + 0.5 * i - 0.25 * j;
  it("brings back a plane from its edge, at every node inside", () => {
    const values = new Float32Array(n * n).fill(NaN), want = new Uint8Array(n * n), label = new Int8Array(n * n).fill(-1);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) values[k] = plane(i, j);
      else want[k] = 1;
    }
    const out = harmonicFill(n, values, want, label, { shore: -1, tol: 1e-7 });
    expect(out.filled).toBe((n - 2) ** 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) expect(Math.abs(out.values[j * n + i] - plane(i, j))).toBeLessThan(1e-4);
  });
  it("gives a hole ringed by land the shore's height, and leaves every other node as it was", () => {
    const values = Float32Array.from({ length: n * n }, (_, k) => k), want = new Uint8Array(n * n), label = new Int8Array(n * n).fill(1);
    for (const k of [40, 41, 49]) (want[k] = 1), (values[k] = NaN), (label[k] = -1);
    const out = harmonicFill(n, values, want, label, { shore: -0.57, tol: 1e-9 });
    for (let k = 0; k < n * n; k++) want[k] ? expect(out.values[k]).toBeCloseTo(-0.57, 5) : expect(out.values[k]).toBe(k);
  });
  it("is the same every time", () => {
    const values = new Float32Array(n * n).fill(NaN), want = new Uint8Array(n * n).fill(1), label = new Int8Array(n * n).fill(-1);
    values[0] = -10;
    want[0] = 0;
    const a = harmonicFill(n, values, want, label, { shore: -1 }), b = harmonicFill(n, values, want, label, { shore: -1 });
    expect([...a.values]).toEqual([...b.values]);
  });
});
