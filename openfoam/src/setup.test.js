import { describe, it, expect } from "vitest";
import { waterProperties, normalizeSetup, defaultSetup, ittc57, froude, domainFor, KNOT, DEFAULT_ITERATIONS, isHalfModel, metresPerSecond, speedIn, parseSpeed, formatSpeed, formatSpeedBoth, setupProblems, patchSetup, writeSetup, SPEED_UNITS } from "./setup.js";

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
    const s = normalizeSetup({ mode: "nope", speed: { value: -3, unit: "m/s" }, temperature: 99, attitude: { trim: 50 }, iterations: 3.7 });
    expect(s.mode).toBe("double-body");
    expect(s.speed).toEqual({ value: 0.05, unit: "m/s" });
    expect(s.temperature).toBe(30);
    expect(s.attitude).toEqual({ sinkage: 0, trim: 10, heel: 0 });
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

describe("a speed is one value with its unit", () => {
  it("is in m/s only when asked: 8 kn is 8 kn, and 4.115556 m/s", () => {
    const s = normalizeSetup({ speed: { value: 8, unit: "kn" } });
    expect(s.speed).toEqual({ value: 8, unit: "kn" });
    expect(metresPerSecond(s.speed)).toBeCloseTo(8 * KNOT, 12);
    expect(metresPerSecond({ value: 8, unit: "m/s" })).toBe(8);
    expect(formatSpeed(s.speed)).toBe("8 kn");
    expect(formatSpeedBoth(s.speed)).toBe("8 kn (4.116 m/s)");
  });
  it("never reads a bare number as a speed, in either unit", () => {
    // the bug this replaces: 8 was stored and shown as 15.55 kn
    expect(normalizeSetup({ speed: 8 }).speed).toEqual(defaultSetup().speed);
    expect(setupProblems({ speed: 8 })).toEqual([expect.stringMatching(/^setup\.speed is 8, which isn't a speed with a unit; it reads as 6 kn/)]);
    expect(() => metresPerSecond(8)).toThrow(/not a speed/);
    expect(() => parseSpeed(8)).toThrow(/a bare number has no unit/);
    expect(() => parseSpeed("8")).toThrow(/give a number and its unit/);
  });
  it("parses every unit word it knows, and nothing else", () => {
    for (const [text, want] of [
      ["8 kn", { value: 8, unit: "kn" }],
      ["8kn", { value: 8, unit: "kn" }],
      ["7.5 knots", { value: 7.5, unit: "kn" }],
      ["6 kt", { value: 6, unit: "kn" }],
      ["4.1 m/s", { value: 4.1, unit: "m/s" }],
      [" .5 M/S ", { value: 0.5, unit: "m/s" }],
    ])
      expect(parseSpeed(text)).toEqual(want);
    expect(parseSpeed({ value: 8, unit: "knots" })).toEqual({ value: 8, unit: "kn" });
    expect(() => parseSpeed("8 mph")).toThrow(/give a number and its unit/);
    expect(() => parseSpeed({ value: 8, unit: "km/h" })).toThrow(/unit must be kn or m\/s/);
    expect(() => parseSpeed({ value: "fast", unit: "kn" })).toThrow(/isn't a number/);
  });
  it("refuses speeds outside what a run can take, in the unit given", () => {
    expect(() => parseSpeed("0 kn")).toThrow(/0 kn is outside 0.097–77.754 kn/);
    expect(() => parseSpeed("41 m/s")).toThrow(/outside 0.05–40 m\/s/);
    expect(parseSpeed("40 m/s")).toEqual({ value: 40, unit: "m/s" });
  });
  it("converts between units without drifting: kn → m/s → kn is the same speed", () => {
    for (const unit of Object.keys(SPEED_UNITS))
      for (const value of [0.1, 1, 4.5, 6, 8, 12.3, 25]) {
        const there = speedIn({ value, unit }, unit === "kn" ? "m/s" : "kn");
        expect(speedIn(there, unit).value).toBeCloseTo(value, 5);
        expect(metresPerSecond(there)).toBeCloseTo(metresPerSecond({ value, unit }), 5);
      }
    expect(() => speedIn({ value: 1, unit: "kn" }, "mph")).toThrow(/unknown speed unit/);
  });
  it("clamps in the unit it was given", () => {
    expect(normalizeSetup({ speed: { value: 100, unit: "kn" } }).speed).toEqual({ value: +(40 / KNOT).toFixed(6), unit: "kn" });
  });
});

describe("setup problems", () => {
  it("are none for a default setup, or a missing one", () => {
    expect(setupProblems(defaultSetup())).toEqual([]);
    expect(setupProblems(undefined)).toEqual([]);
    expect(setupProblems({})).toEqual([]);
  });
  it("name every field that doesn't read as written, and fields a setup doesn't have", () => {
    const p = setupProblems({ speedUnit: "kn", mode: "waves", attitude: { trim: 20, roll: 3 }, iterations: 10 });
    expect(p).toEqual([
      "setup.speedUnit isn't part of a setup (ignored)",
      'setup.mode is "waves"; it reads as "double-body"',
      "setup.attitude.trim is 20; it reads as 10",
      "setup.attitude.roll isn't part of an attitude (ignored)",
      "setup.iterations is 10; it reads as 50",
    ]);
    expect(setupProblems(7)).toEqual(["the setup is 7, not an object"]);
  });
});

describe("changing a setup", () => {
  const base = normalizeSetup({ speed: { value: 6, unit: "kn" } });
  it("merges an attitude field by field", () => {
    const { setup, problems } = patchSetup({ ...base, attitude: { sinkage: 0.2, trim: 1, heel: 0 } }, { attitude: { trim: 1.5 } });
    expect(setup.attitude).toEqual({ sinkage: 0.2, trim: 1.5, heel: 0 });
    expect(problems).toEqual([]);
  });
  it("gives a new analysis its own iterations, unless they're given", () => {
    expect(patchSetup(base, { mode: "free-surface" }).setup.iterations).toBe(DEFAULT_ITERATIONS["free-surface"].coarse);
    expect(patchSetup(base, { mode: "free-surface", iterations: 1234 }).setup.iterations).toBe(1234);
  });
  it("gives a new mesh its default iterations only if the count was a default", () => {
    expect(patchSetup(base, { mesh: "medium" }).setup.iterations).toBe(DEFAULT_ITERATIONS["double-body"].medium);
    expect(patchSetup({ ...base, iterations: 777 }, { mesh: "medium" }).setup.iterations).toBe(777);
  });
  it("reports what in the patch doesn't read as written, and only that", () => {
    const { setup, problems } = patchSetup({ ...base, mode: "nope" }, { speed: 8, temperature: 40 });
    expect(setup.speed).toEqual(defaultSetup().speed);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^setup\.speed is 8/);
    expect(problems[1]).toMatch(/^setup\.temperature is 40; it reads as 30/);
  });
  it("writes only the fields that differ, and drops fields a setup doesn't have", () => {
    const doc = { setup: { ...base, speedUnit: "kn", attitude: { ...base.attitude } } };
    const attitude = doc.setup.attitude;
    writeSetup(doc, patchSetup(doc.setup, { attitude: { trim: 2 } }).setup);
    expect(doc.setup.attitude).toBe(attitude); // the same object, changed in place
    expect(doc.setup.attitude.trim).toBe(2);
    expect("speedUnit" in doc.setup).toBe(false);
    expect(doc.setup).toEqual({ ...base, attitude: { sinkage: 0, trim: 2, heel: 0 } });
    const empty = {};
    writeSetup(empty, base);
    expect(empty.setup).toEqual(base);
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
          const s = normalizeSetup({ mode, mesh, speed: { value: 6, unit: "kn" } });
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

describe("heel and the half model", () => {
  it("never halves a heeled hull, whatever's asked", () => {
    for (const domain of ["auto", "half", "full"]) expect(isHalfModel({ domain, attitude: { heel: 10 } }, { symmetric: true })).toBe(false);
    expect(isHalfModel({ domain: "auto", attitude: { heel: 0 } }, { symmetric: true })).toBe(true);
  });
  it("clamps the heel", () => {
    expect(normalizeSetup({ attitude: { heel: 99 } }).attitude.heel).toBe(60);
    expect(normalizeSetup({}).attitude.heel).toBe(0);
  });
});
