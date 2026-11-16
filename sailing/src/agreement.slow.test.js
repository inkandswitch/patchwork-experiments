// Sailing's physics against the rig aid's predictions (DESIGN.md, "The rig
// contract"). For each of naval's valid contract fixtures
// (copied into test/rig-contract/ from naval/contract/v1/fixtures/valid, with
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
 * Measured on 2026-11-16 (lane/n6) on naval's fixtures as of 7d473f91: §6
 * now has windage (§3.13's elements, §6.1) and swings each sail's CE to its
 * sheet (§6.6), so every predicted point moved (the sloop's reference speed
 * 3.586 → 3.430 m/s, cuvature's 3.883 → 3.268) while sailing's physics did
 * not change. The keel and rudder are the contract's planforms only (§6.4),
 * her CG, inertia and crew the contract's (§6.6), her canoe body's buoyancy,
 * resistance and side force the contract's (§6.4–6.5), and her sails each
 * their own foil (§6.2–6.3: sails-jib.test.js), each sail's CE swung with
 * its boom or clew. Her windage is still sailing's own rule (physics.js:
 * her topsides 0.7·L·f and 0.7·B·f at Cd 1, the mast 0.15·luff at the
 * lumped sail), not the contract's elements.
 * `wrench`: the points that fail (wrench, helm or heel), how many pass of
 * how many, and the worst of each kind: residuals in tolerances (1 is the
 * limit; signs as the harness's: surge + forward, sway + to leeward, roll +
 * heeling, yaw + bow to windward), heel and rudder errors in degrees (+
 * more heel, more weather helm than predicted). `settle`: what she averaged,
 * and which checks fail.
 *
 * What's left, and why (sailing's windage is breakdown()'s; §6.1's is
 * compose's sway and heeling moment with the elements less without them):
 * - windage's heeling force. Sailing's rule and §6.1 cost about the same
 *   drive on the keelboats (at 12 kn 45° the sloop's 202 N against a 32 N
 *   surge residual), but §6.1's hull element grows with heel (side area
 *   + 0.75·(B/2)·LOA·sin φ, its centre 0.66·B·sin φ higher), so on a
 *   heeled reach it heels her far more: at 20 kn 75° the sloop's windage
 *   pushes her to leeward with 455 N in sailing and 789 N in §6.1 (a
 *   heeling moment of 834 N·m about her CG against §6.1's 2675 N·m about
 *   the hull's side-force height). The predicted heel holds that, so she
 *   heels less than predicted wherever her curve is flat enough for it to
 *   show: the sloop at 20 kn 75° (−2.4°), the Catalina at 16–20 kn 70–90°
 *   (−2.0 to −2.3°), and 22 of the J/24's points from 12 kn (−2.1 to −7.9°:
 *   at 20 kn 75°, 175 N against 305 N, 220 N·m against 735). It is also
 *   the J/24's settle: her leeway 7.4°
 *   against 9.0°. No surge or sway residual is past 0.35 tolerances on any
 *   keelboat. Reading §3.13's elements (step 2 of N6) is what should close
 *   these; nothing here is re-tuned to them.
 * - the Laser's windage drag: sailing's rule costs her about twice §6.1's
 *   (at 16 kn 40°: 55 N against 24 N), so close-hauled and reaching from
 *   12 kn she fails surge (worst −1.06 tolerances) and roll (worst 1.81),
 *   and at 12 kn 75°, where her curve is flat, heels 8.1° more. Her settle
 *   passes, 5.8% slow (2.66 against 2.82 m/s) and 1.6° less heel.
 * - the Laser dead downwind (180°, 6–20 kn): both now swing the main's CE
 *   (§6.6), and sailing's swing turns her bow to windward less than §6.6's:
 *   2.4–4.2° less weather helm than predicted (worst yaw −2.93 tolerances
 *   at 20 kn). Windage there is under 20 N either way, so reading §3.13
 *   won't close it: open, to diagnose (where each puts the swung CE at 85°).
 *   Her planing-range points: 15 of 24 pass.
 * - cuvature's righting moment: her stand-in hull (the contract describes
 *   her drawn hull only by its coefficients) is 14–18% short past 10°
 *   (hull-resistance.test.js), so roll fails at 16 points from 14 kn
 *   (worst 2.28 tolerances, 4.9° more heel at 20 kn 40°); sailing's
 *   windage, which heels her less than §6.1's, makes it look smaller. In the
 *   sim she floats on her drawn mesh. Her settle now passes (3.271 against
 *   3.268 m/s): its old 16% was the windage §6 left out. (Her Munk moment
 *   goes as u·v, sin λ·cos λ, not §6.4's sin λ: its cos λ, which
 *   stock-rig.test.js checks at λ 5° and 15°.)
 * The sloop and the Catalina settle within every tolerance (the sloop 0.9%
 * slow), so they list no settle.
 */
const KNOWN_GAPS = {
  "sloop-12m": {
    wrench: { failing: ["20 kn 75°"], pass: 90, of: 91, worst: { surge: -0.047, sway: -0.225, roll: -0.601, yaw: -0.053, heelDeg: -2.382, rudderDeg: -0.805 } },
  },
  "cuvature-first-guess": {
    wrench: {
      failing: ["14 kn 40°", "14 kn 45°", "14 kn 52°", "14 kn 60°", "16 kn 40°", "16 kn 45°", "16 kn 52°", "16 kn 60°", "16 kn 70°", "16 kn 75°", "20 kn 40°", "20 kn 45°", "20 kn 52°", "20 kn 60°", "20 kn 70°", "20 kn 75°"],
      pass: 75,
      of: 91,
      worst: { surge: -0.081, sway: -0.249, roll: 2.283, yaw: -0.061, heelDeg: 4.861, rudderDeg: -0.638 },
    },
  },
  "catalina-30": {
    wrench: { failing: ["16 kn 70°", "20 kn 70°", "20 kn 75°", "20 kn 90°"], pass: 87, of: 91, worst: { surge: -0.048, sway: -0.292, roll: -0.532, yaw: -0.07, heelDeg: -2.259, rudderDeg: -0.95 } },
  },
  j24: {
    wrench: {
      failing: [
        "12 kn 52°", "12 kn 60°", "14 kn 45°", "14 kn 52°", "14 kn 60°", "14 kn 70°", "14 kn 75°", "16 kn 40°", "16 kn 45°", "16 kn 52°", "16 kn 60°",
        "16 kn 70°", "16 kn 75°", "20 kn 40°", "20 kn 45°", "20 kn 52°", "20 kn 60°", "20 kn 70°", "20 kn 75°", "20 kn 90°", "20 kn 110°", "20 kn 120°",
      ],
      pass: 69,
      of: 91,
      worst: { surge: -0.068, sway: -0.34, roll: -0.879, yaw: 0.137, heelDeg: -7.933, rudderDeg: -0.706 },
    },
    // leeway 7.4° against 9.0° at 12 kn 45°: windage's heeling force, above
    settle: { speedMs: 2.99, heelDeg: 23.82, leewayDeg: 7.39, rudderDeg: -4.8, fails: ["leeway"] },
  },
  "laser-ilca7": {
    wrench: {
      failing: [
        "6 kn 180°", "8 kn 180°", "10 kn 180°", "12 kn 75°", "12 kn 180°", "14 kn 75°", "14 kn 90°", "14 kn 180°", "16 kn 40°",
        "16 kn 45°", "16 kn 52°", "16 kn 70°", "16 kn 75°", "16 kn 90°", "16 kn 180°", "20 kn 90°", "20 kn 110°", "20 kn 180°",
      ],
      pass: 67,
      of: 85,
      worst: { surge: -1.064, sway: -1.059, roll: 1.812, yaw: -2.929, heelDeg: 8.067, rudderDeg: -4.152 },
    },
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
      const { W } = tolerancesOf(contract);
      const ref = hydroAt(contract, ship, contract.predicted.reference);
      expect(Math.abs(ref.sailing.side / ref.contract.side - 1), `at the reference point: ${ref.sailing.side.toFixed(1)} vs ${ref.contract.side.toFixed(1)} N`).toBeLessThan(0.02);
      for (const p of unflagged(contract)) {
        const h = hydroAt(contract, ship, p);
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
      `${"".padEnd(22)} residual surge ${f(b.residual.surge, 0)} N, sway ${f(b.residual.sway, 0)} N, roll ${f(b.residual.roll, 0)} N·m, yaw ${f(b.residual.yaw, 0)} N·m; of which sailing's windage ${f(b.windage.surge, 0)} N, ${f(b.windage.sway, 0)} N, ${f(b.windage.roll, 0)} N·m, ${f(b.windage.yaw, 0)} N·m`,
    );
    if (st) lines.push(`${"".padEnd(22)} settle: speed ${f(st.got.speedMs)} vs ${f(ref.speedMs)} m/s, heel ${f(st.got.heelDeg, 1)} vs ${f(ref.heelDeg, 1)}°, leeway ${f(st.got.leewayDeg, 1)} vs ${f(ref.leewayDeg, 1)}°, rudder ${f(st.got.rudderDeg, 1)} vs ${f(ref.rudderDeg, 1)}°${st.v.pass ? "" : "  (fails: " + Object.keys(st.v).filter((k) => k !== "pass" && !st.v[k]).join(", ") + ")"}`);
  }
  console.log(lines.join("\n"));
});
