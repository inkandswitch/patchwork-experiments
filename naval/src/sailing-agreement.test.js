// The aid's predictions against what sailing's physics measured on the same
// contracts, where sailing published a figure (sailing/src/agreement.slow.test.js,
// its header and KNOWN_GAPS, measured 2026-11-10 on the fixtures this package
// built before windage and the swung CE were in §6).
//
// Sailing sailed each contract and found it short of the aid's predictions in
// two ways the aid's §6 then left out:
// - windage: "Sailing's wind on her topsides and bare mast, which §6.1 leaves
//   out" cost, at 12 kn true 45° in the predicted state, 209 N of the 12 m
//   sloop's surge, 395 N of cuvature's and 36 N of the Laser's; and so she
//   settled slow: the sloop 4.8%, cuvature at 3.243 m/s against 3.881, the
//   Laser 9% (and 2.1° less heel).
// - the main's CE swung out with the boom: "weather helm 1.5–2.2° more than
//   predicted on the runs (135–180°) from 12 kn" on the Laser, where the
//   aid predicted none (its CE was on the centreplane).
//
// §6.1 now has windage (ORC's elements, windage.js) and §6.6 swings each
// sail's CE to its sheet, so the aid predicts both. The two windage rules
// still differ (sailing's: Cd 1 on 0.7 × LWL × freeboard and 0.7 × beam ×
// freeboard per axis, and a 0.15 m mast of the lumped luff, from every
// side; the aid's: ORC's Cd 0.816 on the mean freeboard × LOA and × beam, the
// mast at the contract's drawn width with ORC's 0.4 / 0.6 beside the sail,
// and the rigging), so the agreement is to what that difference allows, and
// the Laser, whose 0.15 m mast is three times her drawn one, is stated
// apart. Sailing will read the contract's windage instead of its own rule
// (a follow-up on sailing's side), which closes the rest by construction.

import { describe, it, expect } from "vitest";
import { buildCase } from "./test/contract-cases.js";
import { forcesAt, solvePoint } from "./naval/vpp.js";
import { KNOT } from "./naval/units.js";

/** The predicted state at 12 kn true, 45°, in the fixtures sailing measured against (before this change). */
const MEASURED_AT = {
  "sloop-12m": { V: 3.58572921, heel: 15.7426472, leeway: 4.33333472, rudder: 0.646208969, flat: 1 },
  "cuvature-first-guess": { V: 3.88256849, heel: 10.2593847, leeway: 4.24612687, rudder: -0.891664189, flat: 1 },
  "laser-ilca7": { V: 2.92666776, heel: 14.9998282, leeway: 3.41872941, rudder: 1.41568241, flat: 0.911905289 },
};
/** Sailing's figures: windage's surge there (N), and the speed she settled at sailing from it (m/s). */
const SAILING = {
  "sloop-12m": { windageN: 209, settleMs: 3.58572921 * (1 - 0.048) },
  "cuvature-first-guess": { windageN: 395, settleMs: 3.243 },
  "laser-ilca7": { windageN: 36, settleMs: 2.92666776 * (1 - 0.09) },
};
const TWS = 12 * KNOT;

describe("windage: the aid's §6.1 against sailing's measured windage", () => {
  for (const id of ["sloop-12m", "cuvature-first-guess"])
    it(`${id}: the windage's surge in the state sailing measured is sailing's to 10%, and the reference speed is where sailing settled, to 2%`, () => {
      const { n } = buildCase(id);
      const D = n.design;
      const s = MEASURED_AT[id];
      const F = forcesAt(D, { set: D.sets[0], flat: s.flat, tws: TWS, twa: 45 }, { V: s.V, heel: s.heel, leeway: s.leeway, rudder: s.rudder });
      const surge = -F.windage.drive;
      const p = solvePoint(D, { tws: TWS, twa: 45 });
      console.log(`${id}: windage surge ${surge.toFixed(0)} N (sailing ${SAILING[id].windageN} N, ${(100 * (surge / SAILING[id].windageN - 1)).toFixed(1)}%); reference speed ${p.V.toFixed(3)} m/s (sailing settled ${SAILING[id].settleMs.toFixed(3)}, ${(100 * (p.V / SAILING[id].settleMs - 1)).toFixed(1)}%; without windage the aid said ${s.V.toFixed(3)})`);
      expect(Math.abs(surge / SAILING[id].windageN - 1)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(p.V / SAILING[id].settleMs - 1)).toBeLessThanOrEqual(0.02);
    });

  it("laser-ilca7: KNOWN GAP, the two windage rules differ most on a dinghy (sailing's 0.15 m mast against her drawn 0.04 m); PINNED", () => {
    const { n } = buildCase("laser-ilca7");
    const D = n.design;
    const s = MEASURED_AT["laser-ilca7"];
    const F = forcesAt(D, { set: D.sets[0], flat: s.flat, tws: TWS, twa: 45 }, { V: s.V, heel: s.heel, leeway: s.leeway, rudder: s.rudder });
    const surge = -F.windage.drive;
    const p = solvePoint(D, { tws: TWS, twa: 45 });
    console.log(`laser-ilca7: windage surge ${surge.toFixed(1)} N (sailing 36 N); reference ${p.V.toFixed(3)} m/s (sailing settled ${SAILING["laser-ilca7"].settleMs.toFixed(3)})`);
    // measured 2026-11-12: 15.4 N and 2.820 m/s
    expect(surge).toBeCloseTo(15.4, 0);
    expect(p.V).toBeCloseTo(2.82, 2);
    expect(p.V).toBeGreaterThan(SAILING["laser-ilca7"].settleMs);
    expect(p.V).toBeLessThan(s.V);
  });
});

describe("helm: the main's CE swung to its sheet (§6.6) against sailing's Laser on the runs", () => {
  it("the Laser running at 12 and 16 kn true (135–180°) carries 1.5–2.2° of weather helm, as sailing measured; the old centreplane CE predicted none", () => {
    const { n } = buildCase("laser-ilca7");
    const D = n.design;
    const lines = [];
    for (const kn of [12, 16, 20])
      for (const twa of [135, 150, 165, 180]) {
        const p = solvePoint(D, { tws: kn * KNOT, twa });
        lines.push(`  ${kn} kn ${twa}°: rudder ${p.rudder.toFixed(2)}°`);
        if (kn <= 16) expect(p.rudder, `${kn} kn ${twa}°`).toBeGreaterThanOrEqual(1.5), expect(p.rudder, `${kn} kn ${twa}°`).toBeLessThanOrEqual(2.2);
        // 20 kn: she is planing (flagged), and sailing's statement starts "from 12 kn"; measured 2026-11-12 at 1.17–1.55°, pinned
        else expect(p.rudder, `${kn} kn ${twa}°`).toBeGreaterThan(1.1), expect(p.rudder, `${kn} kn ${twa}°`).toBeLessThan(1.6);
      }
    console.log(`Laser on the runs (sailing: 1.5–2.2° weather helm from 12 kn):\n${lines.join("\n")}`);
  });
});
