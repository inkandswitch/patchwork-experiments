// Resistance against cited worked examples: the ITTC line, the DSYHS
// worked example in Principles of Yacht Design, Savitsky against
// OpenPlaning, and the regression's envelope, the blend and its edges.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RESIDUARY_FN,
  RESIDUARY_A,
  dsyhsFromParticulars,
  residuaryCoefficient,
  residuaryN,
  heelResiduaryN,
  frictionN,
  envelope,
  envelopeText,
  savitsky,
  effectiveDraft,
  inducedN,
  resistanceModel,
  planingCapability,
  regime,
  spheroidArea,
  TE_UPRIGHT,
} from "./resistance.js";
import { ittc57 } from "./foils.js";

// a helper, not new URL(literal, …) inline: vite rewrites that pattern to an asset URL
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const TABLE_COPY = here("../test/fixtures/delft-residuary-lofilobzik.json");
const rel = (got, want) => (got - want) / want;
const pct = (x) => `${(100 * x).toFixed(2)}%`;

// YD-41, half-loaded, Larsson, Eliasson & Orych, Principles of Yacht Design 5th ed. (2022),
// Appendix 1, as transcribed by aciceri/vela tests/dsyhs.rs (retrieved 2026-11-06; book not opened here).
const YD41 = dsyhsFromParticulars({ lwl: 11.9, bwl: 3.18, tc: 0.4, volumeM3: 6.05, wsaM2: 28.2, awM2: 26.75, cp: 0.56, cm: 0.715, lcbPct: -4.2, lcfPct: -7.3 });
const BOOK = { rho: 1025, g: 9.81, nu: 1.0e-6 }; // the book's constants for its example
const V35 = 0.35 * Math.sqrt(BOOK.g * 11.9);

describe("friction, ITTC-57", () => {
  it("C_f(10⁷) = 0.075/25 = 0.003", () => {
    expect(ittc57(1e7)).toBeCloseTo(0.003, 15);
  });
});

describe("DSYHS against the YD-41 worked example (Figs 5.8, 5.18, 5.22)", () => {
  it("the table matches the second, independent transcription cell for cell", () => {
    const other = JSON.parse(readFileSync(TABLE_COPY, "utf8"));
    expect(other.fn).toEqual(RESIDUARY_FN);
    for (let i = 0; i < RESIDUARY_FN.length; i++) for (let k = 0; k < 8; k++) expect(RESIDUARY_A[i][k]).toBe(other[`a${k}`][i]);
  });

  it("residuary 0.00649 and 394.9 N, friction 512.7 N (Re on 0.7·LWL), heel 33 N at 20°", () => {
    const c = residuaryCoefficient(YD41, 0.35);
    const rr = residuaryN(V35, YD41, BOOK);
    const rf = frictionN(V35, { lwl: 11.9, wsaM2: 28.2 }, BOOK);
    const dr = heelResiduaryN(V35, 20, YD41, BOOK);
    console.log(`YD-41 at Fn 0.35: R_r/(∇ρg) ${c.toFixed(6)} (book 0.00649, Δ ${pct(rel(c, 0.00649))}); R_r ${rr.toFixed(1)} N (394.9, Δ ${pct(rel(rr, 394.9))}); R_f ${rf.toFixed(1)} N (512.7, Δ ${pct(rel(rf, 512.7))}); ΔR_r(20°) ${dr.toFixed(1)} N (33, Δ ${pct(rel(dr, 33))})`);
    expect(Math.abs(rel(c, 0.00649))).toBeLessThan(1e-3);
    expect(Math.abs(rel(rr, 394.9))).toBeLessThan(2e-3);
    expect(Math.abs(rel(rf, 512.7))).toBeLessThan(2e-3);
    expect(Math.abs(rel(dr, 33))).toBeLessThan(0.02);
    // the full waterline instead of 0.7 of it would miss the book by more than 2%
    expect(Math.abs(rel(frictionN(V35, { lwl: 11.9 / 0.7, wsaM2: 28.2 }, BOOK), 512.7))).toBeGreaterThan(0.02);
  });

  it("heel scales as 6·φ^1.7 (1 at 20°), vanishes upright and is symmetric", () => {
    expect(6 * (20 * (Math.PI / 180)) ** 1.7).toBeCloseTo(1, 2);
    expect(heelResiduaryN(V35, 0, YD41, BOOK)).toBe(0);
    expect(heelResiduaryN(V35, -20, YD41, BOOK)).toBeCloseTo(heelResiduaryN(V35, 20, YD41, BOOK), 12);
    expect(heelResiduaryN(V35, 10, YD41, BOOK)).toBeLessThan(heelResiduaryN(V35, 30, YD41, BOOK));
  });

  it("is continuous at the table's edges and zero at rest; upright total rises through the hump", () => {
    const at = (fn) => residuaryN(fn * Math.sqrt(9.80665 * 11.9), YD41);
    expect(at(0)).toBe(0);
    for (const e of [0.15, 0.75]) expect(Math.abs(at(e + 1e-7) - at(e - 1e-7))).toBeLessThan(1e-3 * Math.abs(at(e)) + 1e-6);
    let prev = 0;
    for (let fn = 0.2; fn <= 0.45 + 1e-9; fn += 0.025) {
      const V = fn * Math.sqrt(9.80665 * 11.9);
      const t = residuaryN(V, YD41) + frictionN(V, YD41);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("the YD-41 is inside the regression's envelope; a barge is outside, named parameter by parameter", () => {
    expect(envelope(YD41)).toEqual([]);
    const barge = { ...YD41, bwl: 6, cp: 0.8, cm: 0.95 };
    const out = envelope(barge).map((e) => e.id);
    console.log(envelopeText(envelope(barge)));
    expect(out).toEqual(expect.arrayContaining(["cp", "cm", "bwlLwl"]));
    expect(envelopeText(envelope(barge))).toMatch(/Cp 0\.800 \(fitted 0\.519–0\.599\)/);
  });
});

describe("Savitsky's planing surface against OpenPlaning", () => {
  // OpenPlaning (elcf/python-openplaning), base Savitsky-'64, on the Savitsky-'76 example hull
  // W 827400 N, b 7.315 m, β 15°, LCG 10.67 m: [V, τ°, λ, V_m, C_Lβ, R N]. Copied from Rising Tide
  // Research's resistance module, test/savitsky.ts (MIT). OpenPlaning's base-'64 run has no spray
  // either; its friction is Savitsky's, on λb²/cos β with ΔC_f = 0.0004, and so is ours, so R
  // agrees to ±2% (without those two terms it read 6–13% low).
  const ship = { weightN: 827400, beam: 7.315, deadriseDeg: 15, lcg: 10.67 };
  const REF = [
    [10.0, 2.7697, 3.5325, 9.9296, 0.30075, 61653.6],
    [11.0, 2.9525, 3.3657, 10.9142, 0.24848, 67657.3],
    [12.0, 3.1319, 3.1982, 11.8968, 0.20872, 73608.8],
    [13.07, 3.3006, 3.0272, 12.947, 0.17589, 79657.5],
    [15.0, 3.4874, 2.7633, 14.8426, 0.13348, 89111.9],
    [17.0, 3.4959, 2.5628, 16.8152, 0.10392, 96941.5],
    [20.0, 3.2722, 2.3713, 19.7935, 0.07512, 107117.0],
  ];
  it("τ to 4%, λ to 3%, V_m to 2%, C_Lβ to 1%, R to ±3%", () => {
    for (const [V, tau, lam, vm, clb, R] of REF) {
      const r = savitsky(ship, V);
      console.log(`V ${V}: τ ${r.tau.toFixed(3)} (${tau}, ${pct(rel(r.tau, tau))}), λ ${r.lambda.toFixed(3)} (${lam}, ${pct(rel(r.lambda, lam))}), V_m ${r.vm.toFixed(3)} (${pct(rel(r.vm, vm))}), C_Lβ ${pct(rel(r.cLbeta, clb))}, R ${r.rTotal.toFixed(0)} (${R}, ${pct(rel(r.rTotal, R))})`);
      expect(Math.abs(rel(r.tau, tau))).toBeLessThan(0.04);
      expect(Math.abs(rel(r.lambda, lam))).toBeLessThan(0.03);
      expect(Math.abs(rel(r.vm, vm))).toBeLessThan(0.02);
      expect(Math.abs(rel(r.cLbeta, clb))).toBeLessThan(0.01);
      expect(Math.abs(rel(r.rTotal, R))).toBeLessThan(0.03);
    }
  });
  it("closes its own equilibrium: lift = weight, centre of pressure under G", () => {
    const r = savitsky(ship, 15);
    expect(r.cLbeta * 0.5 * 1025 * 15 * 15 * ship.beam ** 2).toBeCloseTo(ship.weightN, 3);
    expect((0.75 - 1 / (5.21 * (r.cv / r.lambda) ** 2 + 2.39)) * r.lambda * ship.beam).toBeCloseTo(ship.lcg, 6);
  });
  it("friction is Savitsky's: on λb²/cos β, with ΔC_f = 0.0004 on ITTC-57", () => {
    const r = savitsky(ship, 15);
    const hand = (0.5 * 1025 * r.vm ** 2 * r.lambda * ship.beam ** 2 * (r.cf + 0.0004)) / Math.cos((15 * Math.PI) / 180);
    expect(r.rFric).toBeCloseTo(hand, 6);
  });
  it("says when it is out of its tested range", () => {
    const slow = savitsky(ship, 5);
    expect(slow.inRange).toBe(false);
    expect(slow.why.join(" ")).toMatch(/C_V/);
  });
});

describe("induced resistance, appendages and the blend", () => {
  it("T_e from the DSYHS upright row, by hand", () => {
    const g = { T: 2, tc: 0.5, bwl: 3, taper: 0.5 };
    const r = 0.25;
    const [A1, A2, A3, A4, B0, B1] = TE_UPRIGHT;
    const hand = 2 * (A1 * r + A2 * r * r + A3 * 6 + A4 * 0.5) * (B0 + B1 * 0.3);
    expect(effectiveDraft(g, 0.3)).toBeCloseTo(hand, 12);
    expect(effectiveDraft(g, 0.3, 30)).toBeCloseTo(hand * Math.cos(Math.PI / 6), 12);
    // R_i = F²/(π T_e² q)
    expect(inducedN(1000, 3, 1.5)).toBeCloseTo(1e6 / (Math.PI * 2.25 * 0.5 * 1025 * 9), 9);
  });
  it("induced drag is on the horizontal side force: Y²/(π·T_e(0)²·q) whatever the heel", () => {
    const hull = dsyhsFromParticulars({ lwl: 9, bwl: 3, tc: 0.5, volumeM3: 5, wsaM2: 22, awM2: 20, cp: 0.55, cm: 0.7, lcbPct: -3, lcfPct: -5 });
    const m = resistanceModel({ hull, foils: [], draftT: 1.8, keelTaper: 0.5 });
    const up = m.at(3, 0, 2000), heeled = m.at(3, 25, 2000);
    expect(heeled.induced).toBeCloseTo(up.induced, 6);
  });
  it("a degenerate planing case falls back to displacement, finite, and says so", () => {
    const hull = dsyhsFromParticulars({ lwl: 1.1, bwl: 0.25, tc: 0.03, volumeM3: 0.005, wsaM2: 0.3, awM2: 0.2, cp: 0.55, cm: 0.7, lcbPct: -3, lcfPct: -5 });
    const m = resistanceModel({ hull, foils: [], draftT: 0.3, keelTaper: 0.5, planing: { capability: 1, weightN: 50, beam: 0.25, deadriseDeg: 10, lcg: -460 } });
    let seen = 0;
    for (const fn of [0.6, 0.7, 0.9, 1.2]) {
      const r = m.at(fn * Math.sqrt(9.80665 * 1.1));
      expect(Number.isFinite(r.hull)).toBe(true);
      if (r.degenerate) {
        seen++;
        expect(r.planingWeight).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
  it("a sphere's area from the spheroid formula's limit", () => {
    expect(spheroidArea(1, 1)).toBeCloseTo(Math.PI, 12);
    expect(spheroidArea(1.000001, 1)).toBeCloseTo(Math.PI, 4);
  });
  it("a light hull blends into planing between Fn 0.55 and 0.75, continuously; a heavy one is beyond model past 0.75", () => {
    expect(planingCapability(80)).toBe(1);
    expect(planingCapability(200)).toBe(0);
    expect(regime(0.8, 1).id).toBe("planing");
    expect(regime(0.8, 0).id).toBe("beyond");
    expect(regime(0.6, 0).id).toBe("displacement");
    // a Laser-like hull (estimated figures), the blend
    const hull = dsyhsFromParticulars({ lwl: 3.81, bwl: 1.15, tc: 0.12, volumeM3: 0.15, wsaM2: 2.8, awM2: 2.7, cp: 0.55, cm: 0.7, lcbPct: -3, lcfPct: -5 });
    const m = resistanceModel({ hull, foils: [], draftT: 0.9, keelTaper: 0.9, planing: { capability: 1, weightN: 1510, beam: 1.15, deadriseDeg: 12, lcg: 1.8 } });
    const vAt = (fn) => fn * Math.sqrt(9.80665 * 3.81);
    for (const e of [0.55, 0.75]) {
      const a = m.at(vAt(e) - 1e-6).total, b = m.at(vAt(e) + 1e-6).total;
      expect(Math.abs(b - a)).toBeLessThan(1e-3 * a);
    }
    expect(m.at(vAt(0.5)).planingWeight).toBe(0);
    expect(m.at(vAt(0.8)).planingWeight).toBe(1);
    const rows = [0.4, 0.5, 0.6, 0.7, 0.8, 1.0].map((fn) => {
      const r = m.at(vAt(fn));
      return `Fn ${fn}: DSYHS ${r.displacement.toFixed(0)} N, Savitsky ${r.planing?.toFixed(0) ?? "—"} N, w ${r.planingWeight.toFixed(2)}, hull ${r.hull.toFixed(0)} N`;
    });
    console.log(`Laser-like blend: ${rows.join("; ")}`);
  });
});
