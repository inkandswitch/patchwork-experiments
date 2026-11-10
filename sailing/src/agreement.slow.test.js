// Sailing's physics against the rig aid's predictions (DESIGN.md, "The rig
// contract"). For each of the rig package's valid contract fixtures
// (copied into test/rig-contract/ from rig/contract/v1/fixtures/valid, with
// its reference consumer of §6, compose.js):
//
// 1. the fixture is what it says: the contract's own §6 balances at every
//    predicted equilibrium (unflagged, or flagged only planing-range, §6.7),
//    so the copy and this harness's reading of a point's state are right;
// 2. at each of those points, sailing's ship.wrench(), evaluated at the
//    predicted state (speed, heel, leeway, rudder, each sail's sheet, the
//    reef and flattening: harness), is in balance to 2% of her weight in
//    surge and sway, and the same 2% of her weight at a waterline beam in
//    roll and at a waterline length in yaw; and, so a wrong helm or heel
//    can't hide inside those moments, the rudder the yaw residual would
//    settle her at is within 1.5° of the predicted one and the heel within 2°;
// 3. at the reference point the parts are the contract's: the sails' drive
//    and heeling force (§6.3) to 1%, the upright resistance (§6.5) to 0.5%;
//    and at every point the water's forces alone (the wrench with her sails
//    stowed and no wind over her) are §6.4–6.5's: the side force square to
//    her track is compose's Y·cos φ to 1% of her weight (2% of it at the
//    reference point), the drag along it compose's R to 0.5% of her weight;
// 4. sailed from the reference point for 120 s on flat water in its steady
//    wind (the helmsman holding her heading), she has stopped changing (the
//    last 15 s's means within 0.005 m/s and 0.05° of the 15 s before) and
//    averages over those last 15 s within ±10% of its speed, ±2° of its
//    heel, ±1.5° of its leeway, with her rudder on the same side.
//
// Today's physics flies the contract's foils, mass properties and crew
// (item 9), its canoe body's buoyancy, resistance and side force (item 10)
// and its sails, each its own foil (item 11). What still fails is listed
// in KNOWN_GAPS, point by point, with what it measured, and held to that
// measure: when the physics changes, the gap moves and this test says so,
// so the list is kept true (narrowed, or removed once a case passes).

import { describe, it, expect, afterAll } from "vitest";
import { agreement, breakdown, contractShip, converged, hydroAt, planingPoint, settle, settleVerdict, summary, tolerancesOf, unflagged } from "./test/agreement-harness.js";
import { composer } from "./test/rig-contract/compose.js";
import sloop from "./test/rig-contract/sloop-12m.json";
import cuvature from "./test/rig-contract/cuvature-first-guess.json";
import catalina from "./test/rig-contract/catalina-30.json";
import j24 from "./test/rig-contract/j24.json";
import laser from "./test/rig-contract/laser-ilca7.json";

const FIXTURES = { "sloop-12m": sloop, "cuvature-first-guess": cuvature, "catalina-30": catalina, j24, "laser-ilca7": laser };

/**
 * Measured on 2026-11-09 after item 11 and its review: the keel and rudder
 * are the contract's planforms only (§6.4), her CG, inertia and crew the
 * contract's (§6.6), her canoe body's buoyancy, resistance and side force
 * the contract's (§6.4–6.5: Y_h square to her flow, no cross-flow drag
 * under the keel's stall), and her sails each their own foil (§6.2–6.3:
 * sails-jib.test.js reproduces every set's trimmed CL and CD through the
 * wrench). The 12 m sloop and the Catalina 30 pass every point and settle
 * within every tolerance, so they're not listed.
 * `wrench`: the points that fail (wrench, helm or heel), how many pass of
 * how many, and the worst of each kind: residuals in tolerances (1 is the
 * limit; signs as the harness's: surge + forward, sway + to leeward, roll +
 * heeling, yaw + bow to windward), heel and rudder errors in degrees (+
 * more heel, more weather helm than predicted). `settle`: what she averaged,
 * and which checks fail.
 *
 * What's left, and why (each measured by subtracting breakdown()'s windage
 * at every point, or switching a term off in a scratch copy, not here):
 * - windage. Sailing's wind on her topsides and bare mast, which §6.1
 *   leaves out, costs every boat drive and heels her (at 12 kn 45°: 209 N
 *   of the sloop's 232 N surge residual; more than all of cuvature's 353 N;
 *   36 of the Laser's 37 N). Less windage, the water's and the sails'
 *   forces close: every fixture's surge residual is within 0.07 of its
 *   tolerance at every point, and its sway within 0.15, but for the Laser
 *   running at 135° (0.84 at 16 kn, where sailing's sails heel her with
 *   75 N to the trimmed table's 48 N, the main near its stop).
 *   It is under 2% of weight on the keelboats but not on the Laser, whose
 *   close-hauled and reaching surge, sway and roll failures it all is;
 *   with it, her settle is 9% slow and heels 2.1° less.
 * - cuvature's righting moment: her stand-in hull (the contract describes
 *   her drawn hull only by its coefficients) is 14–18% short past 10°
 *   (hull-resistance.test.js), so roll and heel fail at 20 points (worst
 *   2.47 tolerances, 5.2° of heel at 20 kn), and her settle heels 12.2°
 *   against 10.3° (inside ±2° by 0.04°). In the sim she floats on her drawn
 *   mesh. Two of those points (20 kn 40° and 45°) also miss the helm by 2.07°
 *   and 1.85°, which is windage's (1.1° and 1.0° without it). (2.0° until
 *   the Munk moment went as u·v, sin λ·cos λ, not sin λ: its cos λ, which
 *   stock-rig.test.js checks against §6.4 at λ 5° and 15°.)
 * - the J/24 at 14 kn 52°: her righting curve is near its top there, so a
 *   roll residual of 0.17 tolerances is 2.2° less heel than predicted; less
 *   windage, 13 more of her points do the same (2.1–3.7° less heel at 14–20
 *   kn): windage's heel is what hides them.
 * - the Laser's main's CE swings out with the boom (to 85° running), so its
 *   drive acts up to 0.9 m to leeward and turns her bow to windward, which
 *   a centreplane CE (§6.6) doesn't: weather helm 1.5–2.2° more than
 *   predicted on the runs (135–180°) from 12 kn, and, less windage, yaw past
 *   tolerance on every reach and run from 90° at 16 kn and above (1.1–1.9
 *   tolerances), planing points included.
 * - planing (the Laser's 25 planing-range points, Fn 0.55–1.29): her hull's
 *   resistance is the contract's there (surge within 0.07 tolerances less
 *   windage); every one of them still fails, by windage or the CE's swing.
 */
const KNOWN_GAPS = {
  "cuvature-first-guess": {
    wrench: {
      failing: ["12 kn 45°", "12 kn 52°", "14 kn 40°", "14 kn 45°", "14 kn 52°", "14 kn 60°", "14 kn 70°", "16 kn 40°", "16 kn 45°", "16 kn 52°", "16 kn 60°", "16 kn 70°", "16 kn 75°", "20 kn 40°", "20 kn 45°", "20 kn 52°", "20 kn 60°", "20 kn 70°", "20 kn 75°", "20 kn 90°"],
      pass: 71,
      of: 91,
      worst: { surge: -0.533, sway: 0.509, roll: 2.465, yaw: -0.21, heelDeg: 5.245, rudderDeg: -2.069 },
    },
  },
  j24: {
    wrench: { failing: ["14 kn 52°"], pass: 90, of: 91, worst: { surge: -0.623, sway: 0.752, roll: -0.49, yaw: 0.3, heelDeg: -2.161, rudderDeg: 0.984 } },
  },
  "laser-ilca7": {
    wrench: {
      failing: [
        "12 kn 40°", "12 kn 45°", "12 kn 52°", "12 kn 60°", "12 kn 70°", "12 kn 75°", "12 kn 90°", "12 kn 135°", "12 kn 150°", "12 kn 165°", "12 kn 180°",
        "14 kn 40°", "14 kn 45°", "14 kn 52°", "14 kn 60°", "14 kn 70°", "14 kn 75°", "14 kn 90°", "14 kn 110°", "14 kn 120°", "14 kn 150°", "14 kn 165°", "14 kn 180°",
        "16 kn 40°", "16 kn 45°", "16 kn 52°", "16 kn 60°", "16 kn 70°", "16 kn 75°", "16 kn 90°", "16 kn 110°", "16 kn 120°", "16 kn 135°", "16 kn 150°", "16 kn 165°", "16 kn 180°",
        "20 kn 90°", "20 kn 110°", "20 kn 120°", "20 kn 135°", "20 kn 150°", "20 kn 165°", "20 kn 180°",
      ],
      pass: 42,
      of: 85,
      worst: { surge: -1.83, sway: 3.094, roll: 2.565, yaw: 1.625, heelDeg: 0.672, rudderDeg: 2.167 },
    },
    settle: { speedMs: 2.669, heelDeg: 12.87, leewayDeg: 4.11, rudderDeg: 1.09, fails: ["heel"] },
  },
};

/** How far a ratcheted measure may move before the gap list must be updated. */
const RATCHET = { tol: 0.01, rel: 0.01, deg: 0.05, speedMs: 0.02, settleDeg: 0.2 };
const within = (got, was, abs, rel = 0) => Math.abs(got - was) <= abs + rel * Math.abs(was);
const label = (p) => `${p.twsKn} kn ${p.twaDeg}°`;

const report = [];

for (const [name, contract] of Object.entries(FIXTURES)) {
  describe(`agreement: ${name}`, () => {
    const ship = contractShip(contract);
    const gap = KNOWN_GAPS[name] ?? {};

    it("the fixture balances by its own rules (§6) at every unflagged point", () => {
      const k = composer(contract);
      const points = unflagged(contract);
      expect(points.length).toBeGreaterThan(10);
      for (const p of points) {
        const r = k.residuals(p);
        for (const v of [r.surge, r.sway, r.roll ?? 0, r.yaw]) expect(Math.abs(v)).toBeLessThan(1e-6);
      }
    });

    it(gap.wrench ? "ship.wrench at the predicted points: KNOWN GAP, held to what it measured" : "ship.wrench balances at every predicted point, helm within 1.5° and heel within 2°", () => {
      const { rows } = agreement(contract, ship);
      const s = summary(rows);
      const ref = contract.predicted.reference;
      const b = breakdown(contract, ship, ref, composer(contract));
      report.push({ name, s, b, ref, planing: rows.filter((r) => planingPoint(r.p)) });
      const failing = rows.filter((r) => !r.pass).map((r) => label(r.p));
      if (!gap.wrench) {
        expect(failing).toEqual([]);
        return;
      }
      expect(failing).toEqual(gap.wrench.failing);
      expect({ pass: s.pass, of: s.of }).toEqual({ pass: gap.wrench.pass, of: gap.wrench.of });
      for (const k of ["surge", "sway", "roll", "yaw"]) {
        expect(within(s.worst[k], gap.wrench.worst[k], RATCHET.tol, RATCHET.rel), `${name} worst ${k}: ${s.worst[k].toFixed(3)}, listed ${gap.wrench.worst[k]}`).toBe(true);
      }
      for (const k of ["heelDeg", "rudderDeg"]) {
        expect(within(s.worst[k], gap.wrench.worst[k], RATCHET.deg), `${name} worst ${k}: ${s.worst[k].toFixed(3)}, listed ${gap.wrench.worst[k]}`).toBe(true);
      }
    });

    it("at the reference point, the sails' drive and heeling force are §6.3's to 1%, the upright resistance §6.5's to 0.5%", () => {
      const ref = contract.predicted.reference;
      const b = breakdown(contract, ship, ref, composer(contract));
      expect(Math.abs(b.sail.sailing.drive / b.sail.contract.drive - 1), `drive ${b.sail.sailing.drive.toFixed(1)} vs ${b.sail.contract.drive.toFixed(1)}`).toBeLessThan(0.01);
      expect(Math.abs(b.sail.sailing.heel / b.sail.contract.heel - 1), `heeling ${b.sail.sailing.heel.toFixed(1)} vs ${b.sail.contract.heel.toFixed(1)}`).toBeLessThan(0.01);
      expect(Math.abs(b.resistance.sailing / b.resistance.contract - 1), `R ${b.resistance.sailing.toFixed(1)} vs ${b.resistance.contract.toFixed(1)}`).toBeLessThan(0.005);
    });

    it("the water's forces alone are §6.4–6.5's: side force Y·cos φ square to her track, R along it", () => {
      const k = composer(contract);
      const { W } = tolerancesOf(contract);
      const ref = hydroAt(contract, ship, contract.predicted.reference, k);
      expect(Math.abs(ref.sailing.side / ref.contract.side - 1), `at the reference point: ${ref.sailing.side.toFixed(1)} vs ${ref.contract.side.toFixed(1)} N`).toBeLessThan(0.02);
      for (const p of unflagged(contract)) {
        const h = hydroAt(contract, ship, p, k);
        expect(Math.abs(h.sailing.side - h.contract.side) / W, `${label(p)} side ${h.sailing.side.toFixed(1)} vs ${h.contract.side.toFixed(1)} N`).toBeLessThan(0.01);
        expect(Math.abs(h.sailing.drag - h.contract.drag) / W, `${label(p)} drag ${h.sailing.drag.toFixed(1)} vs ${h.contract.drag.toFixed(1)} N`).toBeLessThan(0.005);
      }
    });

    it(gap.settle ? "settles near the reference point: KNOWN GAP, held to what it measured" : "settles near the reference point", () => {
      const ref = contract.predicted.reference;
      const got = settle(contract, ref, { ship });
      const v = settleVerdict(ref, got);
      const entry = report.find((r) => r.name === name);
      if (entry) entry.settle = { got, v };
      expect(converged(got), `still changing: ${JSON.stringify(got.before)} → ${got.speedMs.toFixed(4)} m/s`).toBe(true);
      if (!gap.settle) {
        expect(v).toMatchObject({ speed: true, heel: true, leeway: true, rudder: true });
        return;
      }
      expect(Object.keys(v).filter((k) => k !== "pass" && !v[k])).toEqual(gap.settle.fails);
      expect(within(got.speedMs, gap.settle.speedMs, RATCHET.speedMs), `speed ${got.speedMs.toFixed(3)}`).toBe(true);
      expect(within(got.heelDeg, gap.settle.heelDeg, RATCHET.settleDeg), `heel ${got.heelDeg.toFixed(2)}`).toBe(true);
      expect(within(got.leewayDeg, gap.settle.leewayDeg, RATCHET.settleDeg), `leeway ${got.leewayDeg.toFixed(2)}`).toBe(true);
      expect(within(got.rudderDeg, gap.settle.rudderDeg, RATCHET.settleDeg), `rudder ${got.rudderDeg.toFixed(2)}`).toBe(true);
    });
  });
}

// the agreement table, for whoever is closing the gaps
afterAll(() => {
  if (!report.length || process.env.AGREEMENT_QUIET) return;
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
  const lines = ["", "agreement (worst residual in tolerances; settle at the reference point, got vs predicted)"];
  for (const { name, s, b, ref, planing, settle: st } of report) {
    lines.push(
      `${name.padEnd(22)} wrench ${String(s.pass).padStart(2)}/${s.of} pass  worst surge ${f(s.worst.surge)} sway ${f(s.worst.sway)} roll ${f(s.worst.roll)} yaw ${f(s.worst.yaw)}  heel err worst ${f(s.worst.heelDeg, 1)}° median ${f(s.medianHeelErrDeg, 1)}°, rudder err worst ${f(s.worst.rudderDeg, 1)}° median ${f(s.medianRudderErrDeg, 1)}°${planing.length ? `  (planing: ${planing.filter((r) => r.pass).length}/${planing.length})` : ""}`,
      `${"".padEnd(22)} at ${ref.twsKn} kn ${ref.twaDeg}°: sail drive ${f(b.sail.sailing.drive, 0)} vs ${f(b.sail.contract.drive, 0)} N, heeling ${f(b.sail.sailing.heel, 0)} vs ${f(b.sail.contract.heel, 0)} N; upright R ${f(b.resistance.sailing, 0)} vs ${f(b.resistance.contract, 0)} N`,
      `${"".padEnd(22)} residual surge ${f(b.residual.surge, 0)} N, sway ${f(b.residual.sway, 0)} N, roll ${f(b.residual.roll, 0)} N·m, yaw ${f(b.residual.yaw, 0)} N·m; of which windage (§6.1 has none) ${f(b.windage.surge, 0)} N, ${f(b.windage.sway, 0)} N, ${f(b.windage.roll, 0)} N·m, ${f(b.windage.yaw, 0)} N·m`,
    );
    if (st) lines.push(`${"".padEnd(22)} settle: speed ${f(st.got.speedMs)} vs ${f(ref.speedMs)} m/s, heel ${f(st.got.heelDeg, 1)} vs ${f(ref.heelDeg, 1)}°, leeway ${f(st.got.leewayDeg, 1)} vs ${f(ref.leewayDeg, 1)}°, rudder ${f(st.got.rudderDeg, 1)} vs ${f(ref.rudderDeg, 1)}°${st.v.pass ? "" : "  (fails: " + Object.keys(st.v).filter((k) => k !== "pass" && !st.v[k]).join(", ") + ")"}`);
  }
  console.log(lines.join("\n"));
});
