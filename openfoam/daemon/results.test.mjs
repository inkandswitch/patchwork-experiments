// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { summarize, readLayers, stats, latestTimeDir } from "./results.mjs";
import { caseGeometry } from "./case.mjs";
import { prepareHull } from "../src/hull/prepare.js";
import { boxTriangles } from "../src/test/box.js";
import { normalizeSetup, KNOT, ittc57 } from "../src/setup.js";
import { decodeLayer } from "../src/protocol.js";

const fx = (n) => fileURLToPath(new URL(`./test/fixtures/${n}`, import.meta.url));

describe("stats", () => {
  it("mean, std, drift", () => expect(stats([1, 2, 3, NaN])).toEqual({ mean: 2, std: Math.sqrt(2 / 3), drift: 2, n: 3 }));
});

describe("a finished case", () => {
  const dir = mkdtempSync(join(tmpdir(), "foam-results-"));
  mkdirSync(join(dir, "postProcessing/forces/0"), { recursive: true });
  mkdirSync(join(dir, "postProcessing/yPlus/0"), { recursive: true });
  mkdirSync(join(dir, "postProcessing/surfaces/100"), { recursive: true });
  mkdirSync(join(dir, "postProcessing/surfaces/264"), { recursive: true });
  copyFileSync(fx("force.dat"), join(dir, "postProcessing/forces/0/force.dat"));
  copyFileSync(fx("moment.dat"), join(dir, "postProcessing/forces/0/moment.dat"));
  copyFileSync(fx("yPlus.dat"), join(dir, "postProcessing/yPlus/0/yPlus.dat"));
  copyFileSync(fx("wake.vtk"), join(dir, "postProcessing/surfaces/264/wake.vtk"));
  writeFileSync(join(dir, "postProcessing/surfaces/100/wake.vtk"), "not this one");
  const info = prepareHull(boxTriangles()).info;
  const g = caseGeometry(normalizeSetup({ speed: 6 * KNOT }), info);

  it("reads the newest time", () => expect(latestTimeDir(join(dir, "postProcessing/surfaces"))).toMatch(/264$/));
  it("sums the figures", () => {
    const s = summarize(dir, g, info, { cells: 1 });
    expect(s.Rt).toBeGreaterThan(0);
    expect(s.Rt).toBeCloseTo(s.Rp + s.Rv, 6);
    expect(s.Ct).toBeCloseTo(s.Rt / (0.5 * g.water.rho * g.V ** 2 * info.wettedArea), 12);
    expect(s.Cf0).toBe(ittc57(s.Re));
    expect(s.formFactor).toBeCloseTo(s.Ct / s.Cf0, 12);
    expect(s.Cr).toBe(null);
    expect(s.power).toBeCloseTo(s.Rt * g.V, 9);
    expect(s.window).toBeGreaterThanOrEqual(20);
    expect(s.yPlus.average).toBeGreaterThan(0);
    // the moment, doubled for the half model (the fixture's last row: −1.924e4 N·m)
    expect(s.My).toBeLessThan(0);
    expect(Math.abs(s.My + 2 * 1.92442281e4)).toBeLessThan(0.02 * 2 * 1.92442281e4);
    expect(s.cofrX).toBe(g.cofr[0]);
  });
  it("keeps the wake as a layer of u/V, and notes what's missing", () => {
    const { layers, notes } = readLayers(dir, g);
    expect(layers.map((l) => l.name)).toEqual(["wake"]);
    const w = decodeLayer(layers[0]);
    expect(Object.keys(w.fields).sort()).toEqual(["Cp", "speed", "ux"]);
    // far from the hull the stream is undisturbed: u/V ≈ 1 somewhere on the plane
    expect(w.ranges.ux[1]).toBeGreaterThan(0.95);
    expect(w.ranges.ux[1]).toBeLessThan(1.1);
    expect(notes.join()).toMatch(/no hull surface/);
    expect(notes.join()).toMatch(/no streamlines/);
  });
});
