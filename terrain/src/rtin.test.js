import { describe, it, expect } from "vitest";
import { rtinErrors, rtinMesh, checkMesh } from "./rtin.js";
import { toleranceAt, DEFAULTS } from "./build.js";

const n = 65;
const field = (fn) => {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = fn(i, j);
  return h;
};
const constTol = (t) => new Float32Array(n * n).fill(t);

// deterministic surfaces with everything an RTIN finds hard: curvature, ridges, cliffs, a shoreline
const SURFACES = {
  plane: (i, j) => 0.3 * i - 0.2 * j + 5,
  cone: (i, j) => 30 - Math.hypot(i - 31.3, j - 29.7),
  ripples: (i, j) => 2 * Math.sin(i * 0.7) * Math.cos(j * 0.45) + 0.05 * i,
  cliff: (i, j) => (i + 0.3 * j > 30 ? 25 : -8) + 0.1 * j,
  island: (i, j) => 12 - 0.02 * ((i - 32) ** 2 + (j - 30) ** 2) + 0.4 * Math.sin(i + j),
};

describe("RTIN: every node within its tolerance of the mesh", () => {
  it.each(Object.keys(SURFACES))("%s, tolerance 0.25 m everywhere", (name) => {
    const h = field(SURFACES[name]);
    const tol = constTol(0.25);
    const mesh = rtinMesh(n, rtinErrors(n, h, tol));
    const c = checkMesh(n, h, tol, mesh);
    expect(c).toMatchObject({ uncovered: 0, out: 0, area: 64 * 64 });
    expect(c.worst).toBeLessThanOrEqual(1 + 1e-6);
  });

  it.each(Object.keys(SURFACES))("%s, the terrain's own tolerances (by height), and every node keeps its side of y = 0", (name) => {
    const h = field(SURFACES[name]);
    // never exactly 0 (a burned grid has none)
    for (let k = 0; k < h.length; k++) if (h[k] === 0) h[k] = 0.02;
    const tol = h.map((v) => toleranceAt(v, DEFAULTS));
    const mesh = rtinMesh(n, rtinErrors(n, h, tol));
    const c = checkMesh(n, h, tol, mesh);
    expect(c.ok).toBe(true);
    expect(c.flipped).toBe(0);
  });

  it("a plane is two triangles; a cone is many fewer than the grid's", () => {
    const flat = field(SURFACES.plane);
    expect(rtinMesh(n, rtinErrors(n, flat, constTol(0.01))).triangles.length / 3).toBe(2);
    const cone = field(SURFACES.cone);
    const t = rtinMesh(n, rtinErrors(n, cone, constTol(0.25))).triangles.length / 3;
    expect(t).toBeLessThan(2 * 64 * 64 * 0.5);
    expect(t).toBeGreaterThan(8);
  });

  it("winds every triangle to face up (+Y), with x east and rows south", () => {
    const h = field(SURFACES.ripples);
    const { nodes, triangles } = rtinMesh(n, rtinErrors(n, h, constTol(0.1)));
    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((e) => [nodes[triangles[t + e]] % n, Math.floor(nodes[triangles[t + e]] / n)]);
      // normal y of (b − a) × (c − a) with x = i, z = j
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it("refuses a grid that isn't 2^k + 1", () => {
    expect(() => rtinErrors(64, new Float32Array(64 * 64), constTol(1))).toThrow(/2\^k/);
  });

  it("checkMesh catches a mesh that doesn't fit (it isn't checking itself)", () => {
    const h = field(SURFACES.cone);
    const coarse = rtinMesh(n, rtinErrors(n, h, constTol(5)));
    const c = checkMesh(n, h, constTol(0.25), coarse);
    expect(c.ok).toBe(false);
    expect(c.out).toBeGreaterThan(0);
  });
});
