import { describe, it, expect } from "vitest";
import { waterProperties, normalizeSetup, defaultSetup, ittc57, froude, domainFor, KNOT, DEFAULT_ITERATIONS, isHalfModel } from "./setup.js";

describe("water", () => {
  // ITTC 7.5-02-01-03 tabulates, at 15 °C: fresh 999.10 kg/m³, 1.1386e-6 m²/s; seawater 1026.0, 1.1883e-6
  it("matches the ITTC tables at 15 °C", () => {
    const f = waterProperties("fresh", 15);
    const s = waterProperties("salt", 15);
    expect(f.rho).toBeCloseTo(999.1, 1);
    expect(Math.abs(f.nu / 1.1386e-6 - 1)).toBeLessThan(0.005);
    expect(Math.abs(s.rho - 1026.0)).toBeLessThan(0.2);
    expect(Math.abs(s.nu / 1.1883e-6 - 1)).toBeLessThan(0.005);
  });
  it("is within 2.5% of the fresh-water table at its ends", () => {
    // 0 °C: 1.7918e-6, 30 °C: 0.8012e-6
    expect(Math.abs(waterProperties("fresh", 0).nu / 1.7918e-6 - 1)).toBeLessThan(0.025);
    expect(Math.abs(waterProperties("fresh", 30).nu / 0.8012e-6 - 1)).toBeLessThan(0.025);
  });
});

describe("setup", () => {
  it("fills and clamps", () => {
    const s = normalizeSetup({ mode: "nope", speed: -3, temperature: 99, attitude: { trim: 50 }, iterations: 3.7 });
    expect(s.mode).toBe("double-body");
    expect(s.speed).toBe(0.05);
    expect(s.temperature).toBe(30);
    expect(s.attitude).toEqual({ sinkage: 0, trim: 10 });
    expect(s.iterations).toBe(50);
    expect(normalizeSetup(undefined)).toEqual(defaultSetup());
  });
  it("defaults the iterations by mode and mesh", () => {
    expect(normalizeSetup({ mode: "free-surface", mesh: "medium" }).iterations).toBe(DEFAULT_ITERATIONS["free-surface"].medium);
  });
  it("is a half model only for a symmetric hull, unless told", () => {
    expect(isHalfModel({ domain: "auto" }, { symmetric: true })).toBe(true);
    expect(isHalfModel({ domain: "auto" }, { symmetric: false })).toBe(false);
    expect(isHalfModel({ domain: "half" }, { symmetric: false })).toBe(true);
    expect(isHalfModel({ domain: "full" }, { symmetric: true })).toBe(false);
  });
});

describe("numbers", () => {
  it("ITTC-57 at Re = 1e7 is 0.075/25", () => expect(ittc57(1e7)).toBeCloseTo(0.003, 12));
  it("Froude", () => expect(froude(Math.sqrt(9.80665 * 4), 4)).toBeCloseTo(1, 12));
});

describe("domain", () => {
  const hull = { xMin: 0, xMax: 10, yMax: 1.5, zMin: -1, zMax: 1 };
  for (const mode of ["double-body", "free-surface"])
    for (const mesh of ["coarse", "medium", "fine"])
      for (const half of [true, false])
        it(`${mode} ${mesh} ${half ? "half" : "full"}: the hull, every box and the seed point are inside it`, () => {
          const s = normalizeSetup({ mode, mesh, speed: 6 * KNOT });
          const d = domainFor(s, hull, { half });
          const inBox = (p, b) => p.every((v, k) => v >= b.min[k] - 1e-9 && v <= b.max[k] + 1e-9);
          const dom = { min: d.min, max: d.max };
          // the hull's wetted part
          expect(inBox([hull.xMin, half ? 0 : -hull.yMax, hull.zMin], dom)).toBe(true);
          expect(inBox([hull.xMax, half ? 0 : hull.yMax, 0], dom)).toBe(true);
          expect(d.max[1]).toBe(half ? 0 : 1.5 * 10);
          expect(d.max[2]).toBe(mode === "double-body" ? 0 : d.max[2]);
          if (mode === "free-surface") expect(d.max[2]).toBeGreaterThan(hull.zMax);
          for (const b of [...d.boxes.map((b) => b), ...(d.freeSurface ? [d.freeSurface.box, d.freeSurface.far.box] : [])]) {
            expect(inBox(b.min, dom)).toBe(true);
            expect(inBox(b.max, dom)).toBe(true);
          }
          // a grid plane lies exactly on the waterline (z = 0 is a whole number of cells up)
          const dz = (d.max[2] - d.min[2]) / d.cells[2];
          expect(Math.abs(-d.min[2] / dz - Math.round(-d.min[2] / dz))).toBeLessThan(1e-9);
          // the seed point is in the fluid: inside the domain, outside the hull's box
          expect(inBox(d.inside, dom)).toBe(true);
          expect(inBox(d.inside, { min: [hull.xMin, -hull.yMax, hull.zMin], max: [hull.xMax, hull.yMax, hull.zMax] })).toBe(false);
          // boxes nest: each finer one inside the coarser
          expect(d.boxes[1].level).toBeGreaterThan(d.boxes[0].level);
          expect(inBox(d.boxes[1].min, d.boxes[0])).toBe(true);
          expect(inBox(d.boxes[1].max, d.boxes[0])).toBe(true);
          if (d.freeSurface) {
            // the interface is refined across the whole domain, one level under the band at the hull
            const far = d.freeSurface.far;
            expect(far.box.min[0]).toBe(d.min[0]);
            expect(far.box.max[0]).toBe(d.max[0]);
            expect(far.box.min[1]).toBe(d.min[1]);
            expect(far.box.max[1]).toBe(d.max[1]);
            expect(far.box.min[2]).toBeLessThan(0);
            expect(far.box.max[2]).toBeGreaterThan(0);
            expect(far.level).toBe(Math.max(1, d.freeSurface.level - 1));
          }
        });
});
