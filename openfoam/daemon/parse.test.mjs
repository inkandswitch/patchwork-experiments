// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseVTK, triangulate, parseDat, datTail, forceRow, residualColumns, parseCheckMesh, parseLayers, parseYPlus } from "./parse.mjs";

const fx = (n) => readFileSync(new URL(`./test/fixtures/${n}`, import.meta.url), "utf8");

// fixtures: real output of OpenFOAM v2606, simpleFoam on camber's narrow-transom
// hull, 6 kn, coarse mesh, half model (2026-11-14)

describe("legacy VTK", () => {
  it("reads a cutting plane's points, polygons and point fields", () => {
    const v = parseVTK(fx("wake.vtk"));
    const n = v.points.length / 3;
    expect(n).toBeGreaterThan(100);
    expect(v.polygons.length).toBeGreaterThan(50);
    for (const p of v.polygons) for (const i of p) expect(i).toBeLessThan(n);
    expect(Object.keys(v.pointData).sort()).toEqual(["U", "p", "wallShearStress"]);
    expect(v.pointData.U.comps).toBe(3);
    expect(v.pointData.U.values.length).toBe(3 * n);
    // a cutting plane normal to x: every point at one x
    const xs = new Set(); for (let i = 0; i < n; i++) xs.add(v.points[i * 3].toFixed(4));
    expect(xs.size).toBe(1);
  });
  it("fans polygons into triangles", () => {
    expect(triangulate([[0, 1, 2, 3], [4, 5, 6]])).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  });
  it("reads lines", () => {
    const v = parseVTK("# vtk\nASCII\nDATASET POLYDATA\nPOINTS 3 float\n0 0 0 1 0 0 2 0 0\nLINES 1 4\n3 0 1 2\nPOINT_DATA 3\nFIELD f 1\np 1 3 float\n1 2 3\n");
    expect(v.lines).toEqual([[0, 1, 2]]);
    expect(Array.from(v.pointData.p.values)).toEqual([1, 2, 3]);
  });
});

describe("dat tables", () => {
  it("reads force.dat as resistance on the whole hull", () => {
    const { cols, rows } = parseDat(fx("force.dat"));
    expect(cols.slice(0, 4)).toEqual(["Time", "total_x", "total_y", "total_z"]);
    const last = rows[rows.length - 1];
    const r = forceRow(cols, last, { half: true });
    expect(r.Rt).toBeCloseTo(-2 * last[1], 9);
    expect(r.Rt).toBeCloseTo(r.Rp + r.Rv, 4); // the file keeps 9 significant figures
    expect(r.Rt).toBeGreaterThan(0);
    expect(forceRow(cols, last, { half: false }).Rt).toBeCloseTo(r.Rt / 2, 9);
  });
  it("reads solverInfo's initial residuals, words as NaN", () => {
    const { cols, rows } = parseDat(fx("solverInfo.dat"));
    expect(residualColumns(cols)).toEqual(["Ux_initial", "Uy_initial", "Uz_initial", "k_initial", "omega_initial", "p_initial"]);
    expect(rows[0][cols.indexOf("Ux_initial")]).toBeGreaterThan(0);
    expect(Number.isNaN(rows[0][cols.indexOf("U_solver")])).toBe(true);
  });
  it("tails a growing file across partial lines", () => {
    const text = fx("force.dat");
    const whole = parseDat(text).rows;
    const t = datTail();
    const got = [];
    for (let i = 0; i < text.length; i += 997) got.push(...t.push(text.slice(i, i + 997)));
    // the last line has a newline, so nothing is left behind
    expect(got).toEqual(whole);
    expect(t.cols).toEqual(parseDat(text).cols);
  });
});

describe("logs", () => {
  it("reads checkMesh", () => {
    const c = parseCheckMesh(fx("log.checkMesh"));
    expect(c.cells).toBe(122840);
    expect(c.ok).toBe(true);
    expect(c.failed).toBe(0);
  });
  it("reads snappy's layer table", () => {
    expect(parseLayers(fx("log.snappy-layers"))).toEqual({ faces: 7287, target: 3, achieved: 2.99, thickness: 0.0513, percent: 97.8 });
  });
  it("reads y+", () => {
    const y = parseYPlus(fx("yPlus.dat"));
    expect(y.min).toBeGreaterThan(0);
    expect(y.max).toBeGreaterThan(y.average);
  });
});
