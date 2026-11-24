// The sail model against the published ORC sets, and its regimes by hand.
// Calibration is a test: trimmed to its best angle of attack at each
// apparent wind angle, a main and a jib set together must sit inside the
// band the ORC tables give, within the tolerances stated here.

import { describe, it, expect } from "vitest";
import {
  sailCoefficients,
  trimmedTable,
  rigForces,
  coeffTable,
  sailAR,
  wrap180,
  interaction,
  SAIL_KINDS,
  ORC_MAIN_2026,
  ORC_MAIN_DAY2017,
  ORC_JIB_2026,
} from "./sails.js";
import { liftSlope } from "./foils.js";

const RAD = Math.PI / 180;
const mk = (id, kind, luff, area) => {
  const ar = sailAR(luff, area);
  return { id, kind, areaM2: area, luffM: luff, ar, slope: liftSlope(ar), sheet: SAIL_KINDS[kind].sheet };
};
// a 12 m sloop's main (luff 13 m, 31 m²) and jib (luff 11.7 m, 24 m²), ARe = (1.1·14.4 m)²/55 m²
const MAIN = mk("main", "main", 13, 31);
const JIB = mk("jib", "jib", 11.7, 24);
const ARE = 15.8 ** 2 / 55;
const table = trimmedTable([MAIN, JIB], ARE);
const lerp = (xs, ys, x) => {
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  return ys[ys.length - 1];
};

describe("calibration against the ORC low sets (Day 2017 Table 1; ORC VPP Documentation 2026 Tables 5.2, 5.5)", () => {
  // Upwind to a beam reach the per-sail coefficients are held tight: CL within 0.15 of either ORC
  // main set (whichever is nearer) and CDv within 0.05; the jib from 15° (at 7–9° it is luffing, which
  // ORC tabulates as CL 0 and the model, sheeted at its 7° limit, does not).
  it("the main: CL within 0.15 and CDv within 0.05, β 12°–90°", () => {
    const lines = [];
    for (const b of [12, 28, 60, 90]) {
      const r = table.rows[b].per.main;
      const i = ORC_MAIN_2026.beta.indexOf(b);
      const dCl = Math.min(Math.abs(r.cl - ORC_MAIN_2026.cl[i]), Math.abs(r.cl - ORC_MAIN_DAY2017.cl[i]));
      const dCd = Math.min(Math.abs(r.cdv - ORC_MAIN_2026.cdv[i]), Math.abs(r.cdv - ORC_MAIN_DAY2017.cdv[i]));
      lines.push(`β ${b}°: CL ${r.cl.toFixed(3)} (ORC ${ORC_MAIN_2026.cl[i]} / ${ORC_MAIN_DAY2017.cl[i]}, Δ ${dCl.toFixed(3)}), CDv ${r.cdv.toFixed(3)} (${ORC_MAIN_2026.cdv[i]} / ${ORC_MAIN_DAY2017.cdv[i]}, Δ ${dCd.toFixed(3)}), α ${r.alphaDeg.toFixed(1)}°, boom ${r.sheetDeg.toFixed(1)}°`);
      expect(dCl).toBeLessThan(0.15);
      expect(dCd).toBeLessThan(0.05);
    }
    console.log(`main, trimmed:\n  ${lines.join("\n  ")}`);
  });

  it("the jib: CL within 0.15 and CDv within 0.06, β 15°–60°", () => {
    const lines = [];
    for (const b of [15, 20, 27, 50, 60]) {
      const r = table.rows[b].per.jib;
      const i = ORC_JIB_2026.beta.indexOf(b);
      const dCl = r.cl - ORC_JIB_2026.cl[i], dCd = r.cdv - ORC_JIB_2026.cdv[i];
      lines.push(`β ${b}°: CL ${r.cl.toFixed(3)} (ORC ${ORC_JIB_2026.cl[i]}, Δ ${dCl.toFixed(3)}), CDv ${r.cdv.toFixed(3)} (${ORC_JIB_2026.cdv[i]}, Δ ${dCd.toFixed(3)}), sheet ${r.sheetDeg.toFixed(1)}°`);
      expect(Math.abs(dCl)).toBeLessThan(0.15);
      expect(Math.abs(dCd)).toBeLessThan(0.06);
    }
    console.log(`jib, trimmed:\n  ${lines.join("\n  ")}`);
  });

  it("the rig's drive within −15%/+10% of the ORC sets composed the ORC way, β 20°–180°; its heeling force within 5% to 60°", () => {
    const lines = [];
    for (const b of [20, 28, 40, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180]) {
      const sb = Math.sin(b * RAD), cb = Math.cos(b * RAD);
      const orc = [ORC_MAIN_2026, ORC_MAIN_DAY2017].map((M) => {
        const cl = (lerp(M.beta, M.cl, b) * 31 + lerp(ORC_JIB_2026.beta, ORC_JIB_2026.cl, b) * 24) / 55;
        const cdv = (lerp(M.beta, M.cdv, b) * 31 + lerp(ORC_JIB_2026.beta, ORC_JIB_2026.cdv, b) * 24) / 55;
        const cd = cdv + (cl * cl) / (Math.PI * ARE);
        return { drive: cl * sb - cd * cb, heel: cl * cb + cd * sb };
      });
      const r = table.rows[b];
      const cd = r.cdv + (r.cl * r.cl) / (Math.PI * ARE);
      const drive = r.cl * sb - cd * cb, heel = r.cl * cb + cd * sb;
      const lo = Math.min(...orc.map((o) => o.drive)), hi = Math.max(...orc.map((o) => o.drive));
      lines.push(`β ${b}°: drive ${drive.toFixed(3)} (ORC ${lo.toFixed(3)}–${hi.toFixed(3)}, ${(100 * (drive / (drive > hi ? hi : drive < lo ? lo : drive) - 1)).toFixed(1)}% outside), heel force ${heel.toFixed(3)} (ORC ${orc.map((o) => o.heel.toFixed(3)).join(" / ")})`);
      expect(drive).toBeGreaterThan(0.85 * lo);
      expect(drive).toBeLessThan(1.1 * hi);
      if (b <= 60) {
        const hlo = Math.min(...orc.map((o) => o.heel)), hhi = Math.max(...orc.map((o) => o.heel));
        expect(heel).toBeGreaterThan(0.95 * hlo);
        expect(heel).toBeLessThan(1.05 * hhi);
      }
    }
    console.log(`rig, trimmed:\n  ${lines.join("\n  ")}`);
  });
});

describe("the α model by hand", () => {
  it("is linear at small α on Helmbold's slope, and zero at α0", () => {
    const k = SAIL_KINDS.main;
    const a = MAIN.slope;
    expect(sailCoefficients("main", k.alpha0, { slope: a }).cl).toBeCloseTo(0, 12);
    const c = sailCoefficients("main", k.alpha0 + 0.5, { slope: a });
    expect(c.cl / (a * 0.5 * RAD)).toBeCloseTo(1, 4);
    expect(c.cdv).toBeCloseTo(k.cdp + k.kv * c.cl * c.cl, 6);
  });
  it("backs: sheeted past the wind (α < α0) the lift reverses, bounded by CLback", () => {
    const c = sailCoefficients("jib", -15, { slope: JIB.slope });
    expect(c.backed).toBe(true);
    expect(c.cl).toBeLessThan(0);
    expect(c.cl).toBeGreaterThan(-SAIL_KINDS.jib.clBack - 1e-9);
  });
  it("square to the wind it is a plate: CL 0, CDv cdp + cn90; and odd in α beyond stall", () => {
    const c = sailCoefficients("main", 90, { slope: MAIN.slope });
    expect(c.cl).toBeCloseTo(0, 9);
    expect(c.cdv).toBeCloseTo(SAIL_KINDS.main.cdp + SAIL_KINDS.main.cn90, 9);
    expect(sailCoefficients("main", -60, { slope: MAIN.slope }).cl).toBeCloseTo(-sailCoefficients("main", 60, { slope: MAIN.slope }).cl, 9);
    expect(wrap180(270)).toBe(-90);
    expect(wrap180(-180)).toBe(180);
  });
  it("the jib backwinds the main close-hauled and the main blankets the jib running", () => {
    expect(interaction("main", 25, 1.4).dAlphaDeg).toBeCloseTo(-4 * 1.4, 9);
    expect(interaction("main", 120, 1.4).dAlphaDeg).toBeCloseTo(0, 12);
    expect(interaction("jib", 60, 0).qFactor).toBe(1);
    expect(interaction("jib", 160, 0).qFactor).toBeCloseTo(0.65, 9);
  });
  it("tabulates CL and CDv from −30° to 120° for the contract", () => {
    const t = coeffTable(MAIN);
    expect(t.alphaDeg[0]).toBe(-30);
    expect(t.alphaDeg.at(-1)).toBe(120);
    expect(t.cl.length).toBe(t.alphaDeg.length);
  });
});

describe("rig forces", () => {
  it("heel turns the wind in the sail plane: β_e = atan(tan β·cos φ), AWS_e² = AWS²(cos²β + sin²β cos²φ)", () => {
    const f = rigForces(table, { aws: 10, awaDeg: 45, heelDeg: 30, flat: 1 });
    expect(f.betaE).toBeCloseTo(Math.atan(Math.cos(30 * RAD)) / RAD, 9);
    expect(f.awsE).toBeCloseTo(10 * Math.sqrt(0.5 + 0.5 * 0.75), 9);
  });
  it("flat scales the lift; the induced drag goes with its square", () => {
    const a = rigForces(table, { aws: 8, awaDeg: 30, heelDeg: 0, flat: 1 });
    const b = rigForces(table, { aws: 8, awaDeg: 30, heelDeg: 0, flat: 0.6 });
    expect(b.cl).toBeCloseTo(0.6 * a.cl, 12);
    expect(b.cd - (b.cl * b.cl) / (Math.PI * ARE)).toBeCloseTo(a.cd - (a.cl * a.cl) / (Math.PI * ARE), 12);
    expect(b.heelForce).toBeLessThan(a.heelForce);
  });
});
