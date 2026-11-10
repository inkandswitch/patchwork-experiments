// Ratio arithmetic on published boats, with the sources the figures came from.
// Each case prints its deltas against the source, pass or fail.

import { describe, it, expect } from "vitest";
import { saD, dL, ballastRatio, displacedVolume, hullSpeed, computeRatios, bandOf } from "./ratios.js";
import { buildSailPlan } from "./sailplan.js";
import { FT, LB, KNOT } from "./units.js";

const report = (name, rows) => {
  // one line per figure: ours, the source's, the delta and the tolerance
  console.log(
    `\n${name}\n` +
      rows
        .map(([what, ours, theirs, tol]) => `  ${what.padEnd(28)} ours ${ours.toFixed(3).padStart(9)}  source ${theirs.toFixed(3).padStart(9)}  Δ ${(ours - theirs).toFixed(3).padStart(7)}  (±${tol})`)
        .join("\n"),
  );
};

describe("SA/D", () => {
  it("is SA/∇^(2/3) and equals the ft form SA ft² / (Δ lb / 64)^(2/3)", () => {
    // 64 lb/ft³ is 1025.18 kg/m³; we use 1025, so the two agree to ~1e-4
    const sa = 40;
    const kg = 5000;
    const si = saD(sa, displacedVolume(kg));
    const ftForm = (sa / FT ** 2) / Math.pow(kg / LB / 64, 2 / 3);
    expect(Math.abs(si - ftForm) / si).toBeLessThan(2e-4);
  });

  it("stock 12 m sloop: 55 m² on 8000 kg (7.80 m³) is 13.98 ± 0.05", () => {
    // source: sailing/src/hull-model.js SLOOP (sail.area 55, mass 8000), copied.
    // 8000/1025 = 7.80488 m³; ^(2/3) = 3.93430; 55/3.93430 = 13.980
    const v = saD(55, displacedVolume(8000));
    report("Stock 12 m sloop (sailing SLOOP)", [["SA/D", v, 13.98, 0.05]]);
    expect(v).toBeCloseTo(13.98, 1);
    expect(Math.abs(v - 13.98)).toBeLessThan(0.05);
  });
});

describe("Catalina 30, standard rig", () => {
  // Sources (retrieved 2026-11-06):
  //  [GOB] Good Old Boat sail data, "Catalina 30 Standard",
  //        https://goodoldboat.com/saildata/boat/catalina-30-standard/ :
  //        LOA 29.92 ft, LWL 25.00 ft, beam 10.83 ft, draft 5.25 ft,
  //        displacement 10,200 lb, ballast 4,200 lb, I 41, J 11.50, P 35, E 11.50 ft.
  //  [SBO] Catalina 30 Mark II specification sheet,
  //        https://sbo.sailboatowners.com/downloads/Catalina_30_28999654.pdf :
  //        gives P 35'6" for the standard rig. NOT fetched here (TLS error on
  //        retrieval); the 35'6" figure is as quoted by a search summary, so it is
  //        recorded as a source disagreement to settle, not verified.
  //  Wikipedia "Catalina 30" lists ballast 4,250 lb (vs 4,200 in GOB); not used.
  // Tolerances: SA/D ±0.05, D/L ±0.5, ballast ±0.5 percentage points: the
  // inputs are given to 3–4 figures and the arithmetic is exact.
  const rigFor = (Pft) => ({
    type: "masthead",
    mast: { aftOfStem: 11.5 * FT, rakeDeg: 0, stepped: "deck" },
    I: 41 * FT,
    P: Pft * FT,
    E: 11.5 * FT,
    BAS: 1,
    ISP: null,
    forestayAftOfStem: 0,
    main: { roach: 0, reefs: [] },
    headsail: null,
    staysail: null,
  });
  const kg = 10200 * LB;
  const lwl = 25 * FT;

  it("SA/D 14.87 with P 35.0 [GOB], 14.97 with P 35.5 [SBO]", () => {
    // designer's area: ½·35·11.5 + ½·41·11.5 = 201.25 + 235.75 = 437.0 ft²
    // ∇ = 10,200/64 = 159.375 ft³; ^(2/3) = 29.395; 437.0/29.395 = 14.866
    // with P 35.5: 439.875/29.395 = 14.964
    const a = buildSailPlan(rigFor(35));
    const b = buildSailPlan(rigFor(35.5));
    expect(a.designer.areaM2 / FT ** 2).toBeCloseTo(437.0, 9);
    const sa = saD(a.designer.areaM2, displacedVolume(kg));
    const sb = saD(b.designer.areaM2, displacedVolume(kg));
    report("Catalina 30 standard rig", [
      ["SA/D (P 35.0, GOB)", sa, 14.87, 0.05],
      ["SA/D (P 35.5, SBO)", sb, 14.97, 0.05],
      ["P disagreement (ft)", 35.5, 35.0, "source"],
    ].map((r) => (r[3] === "source" ? [r[0], r[1], r[2], "sources disagree"] : r)));
    expect(Math.abs(sa - 14.87)).toBeLessThan(0.05);
    expect(Math.abs(sb - 14.97)).toBeLessThan(0.05);
  });

  it("D/L 291.4 and ballast ratio 41.2%", () => {
    // D/L: 10,200/2240 = 4.5536 long tons; (0.01·25)³ = 0.015625; 4.5536/0.015625 = 291.43
    // ballast: 4,200/10,200 = 0.41176
    const d = dL(kg, lwl);
    const b = ballastRatio(4200 * LB, kg);
    report("Catalina 30 hull", [
      ["D/L", d, 291.4, 0.5],
      ["ballast ratio (%)", b * 100, 41.2, 0.5],
    ]);
    expect(Math.abs(d - 291.4)).toBeLessThan(0.5);
    expect(Math.abs(b * 100 - 41.2)).toBeLessThan(0.5);
    expect(bandOf("dL", d).label).toBe("moderate");
    expect(bandOf("saD", 14.87).label).toMatch(/^low/);
  });

  it("hull speed 1.34·√25 = 6.70 kn", () => {
    expect(hullSpeed(lwl) / KNOT).toBeCloseTo(6.7, 9);
  });
});

describe("computeRatios", () => {
  it("gives NaN, not a number, for what it cannot know", () => {
    const r = computeRatios({ saDesignerM2: 40, saActualM2: 40, displacementKg: 0, lwl: 9, bwl: 0, tc: 0, ballastKg: 0 });
    expect(r.saDDesigner).toBeNaN();
    expect(r.dL).toBeNaN();
    expect(r.lwlBwl).toBeNaN();
  });
  it("flags a ratio outside the DSYHS range", () => {
    expect(bandOf("lwlBwl", 2.1).out).toBe(true);
    expect(bandOf("lwlBwl", 3.5).out).toBeUndefined();
  });
});
