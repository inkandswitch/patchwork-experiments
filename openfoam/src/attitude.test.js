import { describe, it, expect } from "vitest";
import { runningAttitude } from "./attitude.js";
import { prepareHull } from "./hull/prepare.js";
import { boxTriangles } from "./test/box.js";
import { waterProperties, G } from "./setup.js";

const info = prepareHull(boxTriangles()).info; // Awp 4, LCF 2, I_L 16/3, pivotX 2
const setup = { water: "salt", temperature: 15 };
const k = waterProperties("salt", 15).rho * G;

describe("running attitude from a double body", () => {
  it("sinks by the suction over the waterplane's stiffness", () => {
    const a = runningAttitude({ mode: "double-body", Fz: -k * 4 * 0.05, My: 0, cofrX: 2 }, info, setup);
    expect(a.sinkage).toBeCloseTo(0.05, 12);
    expect(a.trimDeg).toBeCloseTo(0, 12);
    expect(a.attitude).toEqual({ sinkage: a.sinkage, trim: 0 });
  });
  it("trims bow down for a bow-down moment about the LCF", () => {
    const My = k * (16 / 3) * 0.01; // 0.01 rad
    const a = runningAttitude({ mode: "double-body", Fz: 0, My, cofrX: 2 }, info, setup);
    expect(a.trimDeg).toBeCloseTo((0.01 * 180) / Math.PI, 9);
    // trimmed about the pivot, which is the LCF here: no sinkage to make up
    expect(a.attitude.sinkage).toBeCloseTo(0, 12);
  });
  it("moves the moment from the CofR to the LCF", () => {
    // a down force at the LCF reported about a point 1 m aft is a moment there, and none at the LCF
    // M_LCF = M_C − (x_C − x_LCF) F_z = M_C − (1 − 2)(−1000) = M_C − 1000, so M_C = 1000 is none at the LCF
    const b = runningAttitude({ mode: "double-body", Fz: -1000, My: 1000, cofrX: 1 }, info, setup);
    expect(b.trimDeg).toBeCloseTo(0, 12);
  });
  it("puts the LCF where it says, through prepareHull's own attitude", () => {
    const a = runningAttitude({ mode: "double-body", Fz: -k * 4 * 0.04, My: k * (16 / 3) * 0.02, cofrX: 2 }, info, setup);
    const placed = prepareHull(boxTriangles(), a.attitude).info;
    // displaced volume grows by A_WP·s to first order
    expect(placed.volume - info.volume).toBeCloseTo(4 * a.sinkage, 2);
  });
  it("says nothing for a free-surface run or a hull with no waterplane", () => {
    expect(runningAttitude({ mode: "free-surface", Fz: 1 }, info, setup)).toBe(null);
    expect(runningAttitude({ mode: "double-body", Fz: 1 }, { awp: 0 }, setup)).toBe(null);
  });
});
