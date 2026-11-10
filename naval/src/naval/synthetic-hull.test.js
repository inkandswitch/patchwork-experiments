// The synthetic hull from principal dimensions: its pieces against closed
// forms, and the floated mesh against the dimensions it was built from.
// Each boat prints its deltas.
//
// The boats here are shape inputs for the generator, not validation
// fixtures (those, with their sources and tolerances, are the validation
// step's). Where a figure is published it is cited; the rest is estimated.
import { describe, it, expect } from "vitest";
import { exponentForCm, fitSAC, fitSynthetic, gamma, sectionCoefficient, syntheticHull, SYNTH_DEFAULTS } from "./synthetic-hull.js";
import { immerse, prepareMesh, uprightHydrostatics } from "./mesh-hydro.js";
import { FT, LB, RHO_SEA } from "./units.js";

const report = (name, rows) =>
  console.log(`\n${name}\n${rows.map(([k, got, want, tol]) => `  ${k.padEnd(10)} mesh ${got.toFixed(4).padStart(9)}  built to ${want.toFixed(4).padStart(9)}  Δ ${(got - want).toFixed(4).padStart(8)}  (±${tol})`).join("\n")}`);

describe("pieces", () => {
  it("Γ, and the super-ellipse section coefficient Γ(1+1/n)²/Γ(1+2/n)", () => {
    expect(gamma(5)).toBeCloseTo(24, 10);
    expect(gamma(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 10);
    expect(sectionCoefficient(2)).toBeCloseTo(Math.PI / 4, 12); // a half ellipse
    expect(sectionCoefficient(1)).toBeCloseTo(0.5, 12); // a V
    expect(sectionCoefficient(200)).toBeGreaterThan(0.99); // nearly a box
    for (const cm of [0.6, 0.72, 0.85]) expect(sectionCoefficient(exponentForCm(cm))).toBeCloseTo(cm, 9);
  });

  it("the sectional-area curve's halves carry Cp and put the centroid at LCB", () => {
    // f = 1 − |u|^p has mean p/(p+1) over a half; area-weighted, Cp = (a_f + a_a)/2
    for (const [cp, lcb] of [
      [0.56, -0.03],
      [0.52, 0],
      [0.6, 0.02],
    ]) {
      const { pFwd, pAft, lcbFrac } = fitSAC(cp, lcb);
      const a = (p) => p / (p + 1);
      expect((a(pFwd) + a(pAft)) / 2).toBeCloseTo(cp, 10);
      expect(lcbFrac).toBeCloseTo(lcb, 10);
      // check the centroid by direct quadrature of f over u in [−1, 1]
      let A = 0, M = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const u = -1 + (2 * (i + 0.5)) / N;
        const f = u >= 0 ? 1 - u ** pFwd : 1 - (-u) ** pAft;
        A += f;
        M += f * u;
      }
      expect(M / A / 2).toBeCloseTo(lcb, 4);
    }
  });

  it("given coefficients are kept, estimated ones move first, the depth last", () => {
    const dims = { loa: 12, lwl: 10, beam: 3.6, bwl: 3, tc: 0.6, freeboard: 1.2, displacementKg: 0.5 * 0.72 * 10 * 3 * 0.6 * RHO_SEA };
    // Tc given, coefficients estimated: Cb = 0.36 splits as Cm 0.72 × Cp 0.5
    const a = fitSynthetic(dims);
    expect(a.T).toBeCloseTo(0.6, 9);
    expect(a.cp * a.cm).toBeCloseTo(0.36, 9);
    expect(a.made).toEqual(expect.arrayContaining(["cp", "cm", "lcbFrac"]));
    expect(a.warnings).toEqual([]);
    // both coefficients given and inconsistent with Tc: the depth moves, and it says so
    const b = fitSynthetic({ ...dims, cp: 0.6, cm: 0.8 });
    expect(b.T).toBeCloseTo((dims.displacementKg / RHO_SEA) / (0.6 * 0.8 * 10 * 3), 9);
    expect(b.warnings.join(" ")).toMatch(/don't agree.*floats \d+% (shallower|deeper)/);
    // Tc estimated: the defaults stand and Tc follows from them
    const c = fitSynthetic(dims, { estimated: ["tc"] });
    expect([c.cp, c.cm]).toEqual([SYNTH_DEFAULTS.cp, SYNTH_DEFAULTS.cm]);
    expect(c.T).toBeCloseTo((dims.displacementKg / RHO_SEA) / (SYNTH_DEFAULTS.cp * SYNTH_DEFAULTS.cm * 30), 9);
  });
});

describe("floated synthetic hulls return what they were built to", () => {
  // tolerances (the plan's): Δ ±1%, LWL ±1%, BWL ±2%, Cp ±0.02, LCB ±0.5% LWL
  const boats = [
    {
      name: "stock 12 m sloop",
      // sailing/src/hull-model.js SLOOP, copied (LOA 12, beam 3.8, freeboard 1.2, 8000 kg); LWL, BWL, Tc estimated (rig doc.js)
      dims: { loa: 12, lwl: 10.5, beam: 3.8, bwl: 3.04, tc: 0.6, freeboard: 1.2, displacementKg: 8000 },
      estimated: ["lwl", "bwl", "tc"],
    },
    {
      name: "Catalina 30 (shape test)",
      // LOA 29.92 ft, LWL 25 ft, beam 10.83 ft, 10,200 lb: Good Old Boat sail data,
      // https://goodoldboat.com/saildata/boat/catalina-30-standard/ (retrieved 2026-11-06).
      // BWL 0.88·beam, Tc 0.5 m and freeboard 1.1 m are estimates for this shape test.
      dims: { loa: 29.92 * FT, lwl: 25 * FT, beam: 10.83 * FT, bwl: 0.88 * 10.83 * FT, tc: 0.5, freeboard: 1.1, displacementKg: 10200 * LB },
      estimated: ["bwl", "tc", "freeboard"],
    },
    {
      name: "Laser / ILCA 7 (shape test)",
      // LOA 4.23 m, LWL 3.81 m, beam 1.37 m, hull 59 kg: commonly quoted class figures, not
      // checked against the ILCA rules here (the validation step cites them). Sailing weight
      // 59 + 80 kg sailor + ~15 kg rig and foils, BWL, Tc and freeboard are estimates.
      dims: { loa: 4.23, lwl: 3.81, beam: 1.37, bwl: 1.15, tc: 0.12, freeboard: 0.33, displacementKg: 154 },
      estimated: ["bwl", "tc", "freeboard", "displacementKg"],
    },
  ];
  for (const b of boats)
    it(b.name, () => {
      const s = syntheticHull(b.dims, { estimated: b.estimated });
      expect(s.ok).toBe(true);
      const mesh = prepareMesh(s.triangles);
      expect(mesh.closed).toBe(true);
      expect(mesh.flipped).toBe(false);
      const V = b.dims.displacementKg / RHO_SEA;
      const h = immerse(mesh, V);
      const u = uprightHydrostatics(mesh, h);
      const lcbFrac = (u.lcb - (u.xAft + u.xFwd) / 2) / u.lwl;
      const rows = [
        ["Δ kg", u.volumeM3 * RHO_SEA, b.dims.displacementKg, "1%"],
        ["LWL", u.lwl, b.dims.lwl, "1%"],
        ["BWL", u.bwl, b.dims.bwl, "2%"],
        ["Cp", u.cp, s.fit.cp, "0.02"],
        ["Cm", u.cm, s.fit.cm, "0.02"],
        ["LCB/LWL", lcbFrac, s.fit.lcbFrac, "0.005"],
        ["Tc", u.tc, s.fit.T, "1%"],
        ["LOA", mesh.bounds.max[0] - mesh.bounds.min[0], Math.max(b.dims.loa, b.dims.lwl), "1e-9"],
      ];
      report(b.name, rows);
      expect(Math.abs(h)).toBeLessThan(1e-6 * b.dims.lwl); // built to float at its DWL, z = 0
      expect(Math.abs(rows[0][1] / rows[0][2] - 1)).toBeLessThan(0.01);
      expect(Math.abs(u.lwl / b.dims.lwl - 1)).toBeLessThan(0.01);
      expect(Math.abs(u.bwl / b.dims.bwl - 1)).toBeLessThan(0.02);
      expect(Math.abs(u.cp - s.fit.cp)).toBeLessThan(0.02);
      expect(Math.abs(u.cm - s.fit.cm)).toBeLessThan(0.02);
      expect(Math.abs(lcbFrac - s.fit.lcbFrac)).toBeLessThan(0.005);
      expect(Math.abs(u.tc / s.fit.T - 1)).toBeLessThan(0.01);
      expect(rows[7][1]).toBeCloseTo(rows[7][2], 9);
    });
});
