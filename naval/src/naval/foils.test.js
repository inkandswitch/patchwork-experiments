// Foils and geometric balance against hand-worked cases.

import { describe, it, expect } from "vitest";
import { liftSlope, trapezoid, foilOf, appendagesOf, bulbVolume, downwash, sectionCd0, ittc57, atHeel, rootOf, NACA_AREA } from "./foils.js";
import { balanceOf, extendedKeelCLR, leadBand } from "./balance.js";

const TWO_PI = 2 * Math.PI;
const report = (name, rows) =>
  console.log(`\n${name}\n` + rows.map(([w, ours, hand]) => `  ${w.padEnd(34)} ours ${ours.toFixed(6).padStart(11)}  hand ${hand.toFixed(6).padStart(11)}  Δ ${(ours - hand).toExponential(1)}`).join("\n"));

describe("lift slope: Helmbold with the DATCOM sweep term", () => {
  it("AR 1 gives 2π/(2 + √5), AR 2 gives 4π/(2 + √8), AR → ∞ gives 2π", () => {
    const rows = [
      ["AR 1", liftSlope(1), TWO_PI / (2 + Math.sqrt(5))],
      ["AR 2", liftSlope(2), (2 * TWO_PI) / (2 + Math.sqrt(8))],
      ["AR 1e8", liftSlope(1e8), TWO_PI],
    ];
    report("Helmbold", rows);
    expect(rows[0][1]).toBeCloseTo(1.4833, 4);
    expect(rows[1][1]).toBeCloseTo(2.6026, 4);
    for (const [, a, b] of rows) expect(Math.abs(a / b - 1)).toBeLessThan(1e-7);
  });

  it("30° of half-chord sweep at AR 4: 8π/(2 + √(16/cos²30° + 4)) = 3.5734, below the unswept 3.8833", () => {
    const hand = (4 * TWO_PI) / (2 + Math.sqrt(16 / Math.cos(Math.PI / 6) ** 2 + 4));
    report("Swept", [["AR 4, Λ½ 30°", liftSlope(4, 30), hand], ["AR 4, Λ½ 0°", liftSlope(4, 0), (4 * TWO_PI) / (2 + Math.sqrt(20))]]);
    expect(liftSlope(4, 30)).toBeCloseTo(hand, 12);
    expect(hand).toBeCloseTo(3.5734, 4);
    expect(liftSlope(4, 30)).toBeLessThan(liftSlope(4, 0));
  });
});

describe("planform", () => {
  it("a trapezoid's area, MAC and the MAC's span station by the textbook formulas", () => {
    // cr 2, ct 1, b 3: S = 4.5, λ = ½, MAC = ⅔·2·(1 + ½ + ¼)/(1 + ½) = 1.5556 = ∫c²/S (= 7/4.5),
    // y_MAC = b/3·(1 + 2λ)/(1 + λ) = 1.3333
    const t = trapezoid(2, 1, 3);
    report("Trapezoid cr 2, ct 1, b 3", [
      ["area", t.area, 4.5],
      ["MAC", t.mac, 7 / 4.5],
      ["MAC from root", t.macFromRoot, 4 / 3],
      ["AR b²/S", t.arGeom, 2],
    ]);
    expect(t.area).toBe(4.5);
    expect(t.mac).toBeCloseTo(7 / 4.5, 12);
    expect(t.macFromRoot).toBeCloseTo(4 / 3, 12);
    expect(t.arGeom).toBeCloseTo(2, 12);
  });

  it("a rectangle (chord 1, span 2) under a hull: area 2, AR 2, effective AR 4, centroid and quarter chord", () => {
    const f = foilOf({ kind: "fin", aftOfStem: 5, span: 2, rootChord: 1, tipChord: 1, sweepDeg: 0, tc: 0.12 }, { id: "keel", stemX: 6, rootZ: -0.5, endPlate: true });
    expect(f.areaM2).toBeCloseTo(2, 12);
    expect(f.arGeom).toBeCloseTo(2, 12);
    expect(f.arEff).toBeCloseTo(4, 12);
    expect(f.liftSlope).toBeCloseTo((4 * TWO_PI) / (2 + Math.sqrt(20)), 12);
    expect(f.centroid[0]).toBeCloseTo(0.5, 12); // LE at x = 1, half a chord aft
    expect(f.centroid[1]).toBeCloseTo(-1.5, 12);
    expect(f.qc[0]).toBeCloseTo(0.75, 12);
    expect(f.qc[1]).toBeCloseTo(-1.5, 12);
    // NACA 00xx: 0.685·t·c² per section, its centroid 0.42 c aft of the LE
    expect(f.volumeM3).toBeCloseTo(NACA_AREA * 0.12 * 1 * 2, 12);
    expect(f.volumeCentroid[0]).toBeCloseTo(1 - 0.42, 12);
    expect(f.volumeCentroid[1]).toBeCloseTo(-1.5, 12);
    expect(f.bottomZ).toBeCloseTo(-2.5, 12);
  });

  it("a tapered, swept foil's volume and the volume's depth are the integrals of c²", () => {
    // c(s) = 2 − s/3 over b = 3: ∫c² = 7, ∫c²·s = ∫(4s − 4s²/3 + s³/9) ds = 18 − 12 + 2.25 = 8.25
    const f = foilOf({ kind: "fin", aftOfStem: 0, span: 3, rootChord: 2, tipChord: 1, sweepDeg: 20, tc: 0.1 }, { id: "keel", stemX: 0, rootZ: 0, endPlate: true });
    expect(f.volumeM3).toBeCloseTo(NACA_AREA * 0.1 * 7, 12);
    expect(f.volumeCentroid[1]).toBeCloseTo(-8.25 / 7, 12);
    // half-chord sweep: tan Λ½ = tan 20° − (2 − 1)/(2·3)
    expect(Math.tan((f.sweepHalfDeg * Math.PI) / 180)).toBeCloseTo(Math.tan((20 * Math.PI) / 180) - 1 / 6, 12);
  });

  it("a bulb: a cylinder's volume with cp 1, a spheroid's (2/3 of it) by default, hung D/2 under the tip", () => {
    expect(bulbVolume(2, 0.5, 1)).toBeCloseTo((Math.PI / 4) * 0.25 * 2, 12);
    expect(bulbVolume(2, 0.5)).toBeCloseTo((Math.PI / 6) * 0.25 * 2, 12);
    const f = foilOf({ kind: "fin-bulb", aftOfStem: 0, span: 1, rootChord: 1, tipChord: 0.8, sweepDeg: 0, tc: 0.1, bulb: { length: 2, diameter: 0.5 } }, { id: "keel", stemX: 0, rootZ: -0.5, endPlate: true });
    expect(f.bulb.centre[1]).toBeCloseTo(-1.5 - 0.25, 12);
    expect(f.bulb.centre[0]).toBeCloseTo(-0.2, 12); // under the tip's quarter chord
    expect(f.bottomZ).toBeCloseTo(-2, 12);
    const app = appendagesOf({ keel: { kind: "fin-bulb", aftOfStem: 0, span: 1, rootChord: 1, tipChord: 0.8, sweepDeg: 0, tc: 0.1, bulb: { length: 2, diameter: 0.5 } } }, { stemX: 0, hullBottomAt: () => -0.5 });
    const Vb = bulbVolume(2, 0.5);
    const Vf = app.keel.volumeM3;
    expect(app.volumeM3).toBeCloseTo(Vb + Vf, 12);
    expect(app.volumeCentroid[1]).toBeCloseTo((Vb * -1.75 + Vf * app.keel.volumeCentroid[1]) / (Vb + Vf), 12);
  });

  it("downwash, profile drag and the end plate", () => {
    expect(downwash(0.4, 2)).toBeCloseTo(0.4 / (2 * Math.PI), 12);
    // ITTC-57 at Re 1e6: 0.075/16; Hoerner at t/c 0.12: × 2 × (1 + 0.24 + 60·0.12⁴)
    expect(ittc57(1e6)).toBeCloseTo(0.075 / 16, 15);
    expect(sectionCd0(0.12, 1e6)).toBeCloseTo((2 * 0.075 * (1 + 0.24 + 60 * 0.12 ** 4)) / 16, 15);
    // the hull's end plate fades with heel: 2× upright, 1× on her side
    const f = foilOf({ kind: "fin", aftOfStem: 0, span: 2, rootChord: 1, tipChord: 1, sweepDeg: 0, tc: 0.1 }, { id: "keel", stemX: 0, rootZ: -0.5, endPlate: true });
    expect(atHeel(f, 0).arEff).toBeCloseTo(4, 12);
    expect(atHeel(f, 90).arEff).toBeCloseTo(2, 12);
    expect(atHeel(f, 30).liftSlope).toBeLessThan(f.liftSlope);
    // a transom-hung rudder hangs from the waterline, with no end plate
    const r = rootOf({ kind: "transom-hung", aftOfStem: 4, rootChord: 0.3 }, { stemX: 2, hullBottomAt: () => -0.2, id: "rudder" });
    expect(r).toMatchObject({ rootZ: 0, endPlate: false });
    expect(rootOf({ kind: "spade", aftOfStem: 4, rootChord: 0.3 }, { stemX: 2, hullBottomAt: () => -0.2, id: "rudder" })).toMatchObject({ rootZ: -0.2, endPlate: true });
  });

  it("more keel span raises its lift slope", () => {
    const at = { id: "keel", stemX: 0, rootZ: -0.5, endPlate: true };
    const slopes = [0.8, 1.2, 1.6, 2.0].map((span) => foilOf({ kind: "fin", aftOfStem: 0, span, rootChord: 1.2, tipChord: 0.8, sweepDeg: 10, tc: 0.12 }, at).liftSlope);
    console.log(`keel lift slope by span 0.8/1.2/1.6/2.0 m: ${slopes.map((s) => s.toFixed(3)).join(", ")}`);
    for (let i = 1; i < slopes.length; i++) expect(slopes[i]).toBeGreaterThan(slopes[i - 1]);
  });
});

describe("geometric balance", () => {
  // a canoe body as a 10 × 1 m rectangle (centroid [0, −0.5]) and a 1 × 1 m fin under it, LE at x = −0.5
  const lateral = { areaM2: 10, centroid: [0, -0.5] };
  const app = appendagesOf({ keel: { kind: "fin", aftOfStem: 5.5, span: 1, rootChord: 1, tipChord: 1, sweepDeg: 0, tc: 0.1 } }, { stemX: 5, hullBottomAt: () => -1 });
  const plan = { designer: { ce: [0.2, 6] }, actual: { ce: [0.1, 6] } };

  it("the CLR of a rectangle plus a fin is their area-weighted centroid", () => {
    const b = balanceOf({ plan, lateral, app, lwl: 10, rigType: "fractional" });
    // (10·0 + 1·(−1))/11, (10·(−0.5) + 1·(−1.5))/11
    report("Rectangle + fin CLR", [
      ["x", b.clrWhole[0], -1 / 11],
      ["z", b.clrWhole[1], -6.5 / 11],
    ]);
    expect(b.clrWhole[0]).toBeCloseTo(-1 / 11, 12);
    expect(b.clrWhole[1]).toBeCloseTo(-6.5 / 11, 12);
    expect(b.lateralAreaM2).toBeCloseTo(11, 12);
  });

  it("the extended-keel CLR is on the quarter-chord line at 0.45 of its depth, and the lead is CE − CLR over LWL", () => {
    // unswept: the quarter-chord line is x = −0.75; the tip is 2 m down, so z = −0.9
    expect(extendedKeelCLR(app.keel)).toEqual([expect.closeTo(-0.75, 12), expect.closeTo(-0.9, 12)]);
    const b = balanceOf({ plan, lateral, app, lwl: 10, rigType: "fractional" });
    expect(b.lead).toBeCloseTo((0.2 - -0.75) / 10, 12);
    expect(b.leadBand.label).toMatch(/above 3–7%/);
    // swept 45°, chord 1, root at −1, tip at −2: x(z) = −0.25 + (z + 1), so −0.15 at z = −0.9
    const swept = appendagesOf({ keel: { kind: "fin", aftOfStem: 0, span: 1, rootChord: 1, tipChord: 1, sweepDeg: 45, tc: 0.1 } }, { stemX: 0, hullBottomAt: () => -1 });
    const c = extendedKeelCLR(swept.keel);
    expect(c[0]).toBeCloseTo(-0.15, 12);
    expect(c[1]).toBeCloseTo(-0.9, 12);
  });

  it("lead bands: Larsson & Eliasson's, where there are any", () => {
    expect(leadBand("fractional", "fin", 0.04)).toMatchObject({ range: [3, 7] }); // the one band the quote gives
    expect(leadBand("fractional", "fin", 0.065).out).toBeUndefined();
    expect(leadBand("fractional", "fin", 0.04).label).toMatch(/est\./);
    expect(leadBand("fractional", "fin", 0.04).out).toBeUndefined();
    expect(leadBand("masthead", "fin-bulb", 0.03).label).toMatch(/below 5–9%.*weather helm/); // too little lead: the CE nearly over the CLR, so weather helm (the VPP agrees: mast aft, more weather helm)
    expect(leadBand("masthead", "long", 0.17).label).toMatch(/above 12–16%.*lee helm/);
    expect(leadBand("cat", "daggerboard", 0.05).label).toMatch(/no band quoted for a cat rig/);
  });
});
