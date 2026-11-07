// The static VPP: the solver on a toy system with a known answer, the
// balance closing at a solved point, the helm moving the right way when the
// rig moves, the flags, a dinghy that planes, and the Laser against Day's
// published VPP.

import { describe, it, expect } from "vitest";
import { newton, solve3, forcesAt, solvePoint, referencePoint, helmVerdict, polar, rmAt } from "./vpp.js";
import { buildDesign } from "./design.js";
import { tableOf } from "./sails.js";
import { buildTable } from "./statics.js";
import { defaultDoc, normalize } from "../doc.js";
import { computeNumbers } from "../numbers.js";
import { handleMessage } from "../statics-job.js";
import { KNOT } from "./units.js";

/** A doc's numbers with its statics table built (as the worker would). */
function withTable(doc) {
  const n0 = computeNumbers(doc);
  const t = buildTable(n0.form.mesh, { volumes: [n0.form.float.volumeM3, n0.form.float.volumeM3 - n0.analysis.app.volumeM3] });
  return computeNumbers(doc, { statics: { status: "ready", table: t, source: "mesh" } });
}
const designOf = (doc) => buildDesign({ doc, n: withTable(doc) });

// Laser / ILCA 7 as a test boat. LOA 4.23, LWL 3.81, beam 1.37 and 7.06 m² are the commonly quoted
// class figures (not checked here; the validation step cites them); 160 kg all up with an 80 kg sailor
// is Day (2017) Table 2's condition. BWL, Tc, freeboard, rig and blades are estimates.
const LASER = {
  title: "Laser (test)",
  hull: { dims: { loa: 4.23, lwl: 3.81, beam: 1.37, bwl: 1.15, tc: 0.12, draft: 0.8, freeboard: 0.33, displacementKg: 160 } },
  rig: { type: "cat", mast: { aftOfStem: 1.0, rakeDeg: 0, stepped: "deck" }, P: 5.1, E: 2.7, BAS: 0.2, main: { roach: 0.03, reefs: [] }, headsail: null },
  appendages: {
    keel: { kind: "daggerboard", aftOfStem: 1.55, span: 0.75, rootChord: 0.33, tipChord: 0.3, sweepDeg: 0, tc: 0.1, bulb: null },
    rudder: { kind: "kick-up", aftOfStem: 4.25, span: 0.65, rootChord: 0.26, tipChord: 0.2, sweepDeg: 5, tc: 0.1, maxDeg: 35, stockFrac: 0.15 },
  },
  loading: { ballast: { kg: 0 }, crew: { count: 1, kgEach: 80, mode: "hiking" } },
  conditions: { heelLimitDeg: 15 },
  prov: Object.fromEntries(["hull.dims.bwl", "hull.dims.tc", "hull.dims.freeboard", "rig.P", "rig.E"].map((k) => [k, "estimated"])),
};

describe("the solver", () => {
  it("solve3 by hand", () => {
    expect(solve3([[2, 0, 0], [0, 4, 0], [1, 0, 1]], [2, 8, 3])).toEqual([1, 2, 2]);
    expect(solve3([[1, 2, 3], [2, 4, 6], [0, 0, 1]], [1, 2, 3])).toBeNull();
  });
  it("damped Newton finds a toy wrench's analytic balance to 1e-9", () => {
    // drive 100 N against 4·V² N; side force 2·λ·V² = 30 N; yaw δ + 0.5·λ = 1  →  V 5, λ 0.6, δ 0.7
    const f = ([V, l, d]) => ({ r: [(100 - 4 * V * V) / 100, (2 * l * V * V - 30) / 100, d + 0.5 * l - 1] });
    const s = newton(f, [1, 0, 0], { steps: [1e-7, 1e-7, 1e-7], lo: [0.01, -10, -10] });
    expect(s.converged).toBe(true);
    expect(s.x[0]).toBeCloseTo(5, 9);
    expect(s.x[1]).toBeCloseTo(0.6, 9);
    expect(s.x[2]).toBeCloseTo(0.7, 9);
  });
});

describe("the stock 12 m sloop", () => {
  const doc = defaultDoc();
  const D = designOf(doc);

  it("balances: at the reference point every residual is zero and RM = HM", () => {
    expect(D.ok).toBe(true);
    const p = referencePoint(D);
    const set = D.sets.find((s) => s.id === p.set);
    const F = forcesAt(D, { set, flat: p.flat, tws: p.tws, twa: p.twa }, { V: p.V, heel: p.heel, leeway: p.leeway, rudder: p.rudder });
    const scale = 0.5 * 1.225 * p.tws ** 2 * set.areaM2;
    console.log(
      `stock sloop at 12 kn true, 45°: ${(p.V / KNOT).toFixed(2)} kn, heel ${p.heel.toFixed(1)}°, leeway ${p.leeway.toFixed(2)}°, rudder ${p.rudder.toFixed(2)}° (${helmVerdict(D, p).text}), AWA ${p.awa.toFixed(1)}°, flat ${p.flat.toFixed(2)}; residuals surge ${F.surge.toExponential(1)} N, sway ${F.sway.toExponential(1)} N, yaw ${F.yaw.toExponential(1)} N·m, roll ${(F.hm - F.rm.boat - F.rm.crew).toExponential(1)} N·m; flags: ${p.flags.map((f) => f.id).join(", ") || "none"}`,
    );
    expect(p.ok).toBe(true);
    expect(Math.abs(F.surge) / scale).toBeLessThan(1e-6);
    expect(Math.abs(F.sway) / scale).toBeLessThan(1e-6);
    expect(Math.abs(F.yaw) / (scale * D.hull.lwl)).toBeLessThan(1e-6);
    expect(Math.abs(F.hm - F.rm.boat - F.rm.crew) / F.hm).toBeLessThan(1e-6);
    // sane for a 12 m, 8 t boat in 12 kn: 5–8 kn, a few degrees of leeway, within her heel limit
    expect(p.V / KNOT).toBeGreaterThan(5);
    expect(p.V / KNOT).toBeLessThan(8);
    expect(p.leeway).toBeGreaterThan(2);
    expect(p.leeway).toBeLessThan(8);
    expect(p.heel).toBeLessThanOrEqual(D.heelLimitDeg + 1e-6);
  });

  it("the helm follows the mast: moved aft she carries more weather helm, forward less", () => {
    const at = (dx) => {
      const d = normalize({ ...doc, rig: { ...doc.rig, mast: { ...doc.rig.mast, aftOfStem: doc.rig.mast.aftOfStem + dx } } });
      const n = withTable(d);
      const Dx = buildDesign({ doc: d, n });
      return { lead: n.analysis.balance.lead, p: referencePoint(Dx), D: Dx };
    };
    const rows = [-1, -0.5, 0, 0.5, 1].map((dx) => ({ dx, ...at(dx) }));
    console.log(`mast moved: ${rows.map((r) => `${r.dx >= 0 ? "+" : ""}${r.dx} m aft: lead ${(100 * r.lead).toFixed(1)}%, rudder ${r.p.rudder.toFixed(2)}° (${helmVerdict(r.D, r.p).text})`).join("; ")}`);
    for (let i = 1; i < rows.length; i++) expect(rows[i].p.rudder).toBeGreaterThan(rows[i - 1].p.rudder);
  }, 60_000);

  it("says 'cannot be held' when the helm needed is past the rudder's limit", () => {
    const p = referencePoint({ ...D, rudder: { ...D.rudder, maxDeg: 0.1 } });
    const v = helmVerdict({ ...D, rudder: { ...D.rudder, maxDeg: 0.1 } }, p);
    expect(v.id).toBe("cannot");
    expect(p.flags.map((f) => f.id)).toContain("helm");
    expect(v.text).toMatch(/cannot be held: needs/);
  });

  it("flattens, then reefs, to stay within the heel limit as the wind rises", () => {
    const pts = [12, 16, 20, 25].map((kn) => solvePoint(D, { tws: kn * KNOT, twa: 45 }));
    console.log(`at 45°: ${pts.map((p) => `${(p.tws / KNOT).toFixed(0)} kn true: ${(p.V / KNOT).toFixed(2)} kn, heel ${p.heel.toFixed(1)}°, ${p.set}, flat ${p.flat.toFixed(2)}`).join("; ")}`);
    for (const p of pts) if (p.flags.every((f) => f.id !== "over-heel")) expect(p.heel).toBeLessThanOrEqual(D.heelLimitDeg + 1e-6);
    expect(pts.some((p) => p.flat < 1 || p.reef >= 0)).toBe(true);
  });

  it("the polar: beat VMG at 30–70°, run at 120–180°, and the worker's job gives the same", () => {
    const P = polar(D, { tws: [8 * KNOT, 14 * KNOT], twa: [45, 90, 135, 180] });
    console.log(`polar (2 winds × 4 angles + VMG searches): ${P.ms.toFixed(0)} ms; beat ${P.beat.map((b) => `${(b.vmg / KNOT).toFixed(2)} kn at ${b.twa.toFixed(1)}°`).join(", ")}; run ${P.run.map((b) => `${(-b.vmg / KNOT).toFixed(2)} kn at ${b.twa.toFixed(1)}°`).join(", ")}`);
    for (const b of P.beat) {
      expect(b.twa).toBeGreaterThanOrEqual(30);
      expect(b.twa).toBeLessThanOrEqual(70);
    }
    for (const r of P.run) expect(r.twa).toBeGreaterThanOrEqual(120);
    // the design crosses to the worker as plain data and comes back with the same answer
    const m = handleMessage(structuredClone({ id: 7, job: { type: "polar", design: D, tws: [8 * KNOT], twa: [90] } }));
    expect(m.ok).toBe(true);
    expect(m.result.points[0].V).toBeCloseTo(P.points.find((p) => p.tws === 8 * KNOT && p.twa === 90).V, 9);
  });

  it("is a keelboat: too heavy to plane, and says when the DSYHS regression is stretched", () => {
    expect(D.planing.capability).toBe(0);
    const p = referencePoint(D);
    console.log(`stock sloop: D/L ${D.planing.dL.toFixed(0)}; envelope ${D.hull.envelope.map((e) => `${e.label} ${e.value.toFixed(3)}`).join(", ") || "inside"}`);
    expect(p.regime).toBe("displacement");
    if (D.hull.envelope.length) expect(p.flags.map((f) => f.id)).toContain("dsyhs");
  });
});

describe("a Laser / ILCA 7 (estimated hull and blades)", () => {
  const D = designOf(normalize(LASER));

  it("against Day (2017)'s VPP at 9 kn true, 80 kg: within 15% upwind and down", () => {
    // Day, A.H. (2017), Ocean Engineering 136, Figs 4 and 6, 'VPP 9.0 knots 80 kg', read off the plots
    // to about ±0.05 kn by lofilobzik/sail (data/laser-polar-target.json, MIT), retrieved 2026-11-06.
    const target = [[40, 4.55], [45, 4.91], [50, 5.15], [55, 5.41], [60, 5.54], [150, 4.41], [160, 4.28], [170, 4.23], [180, 4.19]];
    const lines = [];
    let guess = null;
    for (const [twa, kn] of target) {
      const p = solvePoint(D, { tws: 9 * KNOT, twa }, guess);
      guess = p.ok ? p : null;
      const v = p.V / KNOT;
      lines.push(`${twa}°: ${v.toFixed(2)} kn (Day ${kn}, ${(100 * (v / kn - 1)).toFixed(1)}%)`);
      expect(Math.abs(v / kn - 1)).toBeLessThan(0.15);
    }
    console.log(`Laser at 9 kn true: ${lines.join("; ")}`);
  });

  it("planes on a reach in a breeze (Savitsky), and holds displacement speeds upwind", () => {
    const reach = solvePoint(D, { tws: 16 * KNOT, twa: 100 });
    const beat = solvePoint(D, { tws: 16 * KNOT, twa: 45 });
    console.log(`Laser at 16 kn true: 100° ${(reach.V / KNOT).toFixed(2)} kn, Fn ${reach.fn.toFixed(2)}, ${reach.regimeText}, w ${reach.planingWeight.toFixed(2)} [${reach.flags.map((f) => f.text).join(" ")}]; 45° ${(beat.V / KNOT).toFixed(2)} kn, Fn ${beat.fn.toFixed(2)}, ${beat.regimeText}`);
    expect(D.planing.capability).toBe(1);
    expect(reach.regime).toBe("planing");
    expect(reach.planingWeight).toBe(1);
    expect(reach.V).toBeGreaterThan(beat.V);
    expect(reach.speed).not.toBeNull();
  });

  it("sails upright in light air: the crew holds her", () => {
    const p = solvePoint(D, { tws: 5 * KNOT, twa: 50 });
    expect(p.heel).toBe(0);
    const rm0 = rmAt(D, 0);
    expect(rm0.crew).toBeGreaterThan(0);
  });
});

describe("design", () => {
  it("is plain data, and the sails' trimmed tables are rebuilt from it identically", () => {
    const D = designOf(defaultDoc());
    const C = structuredClone(D);
    expect(C).toEqual(D);
    expect(tableOf(C.sets[0]).rows[40]).toEqual(tableOf(D.sets[0]).rows[40]);
  });
});
