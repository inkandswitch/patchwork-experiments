import { formatText } from "./units.js";
// Mass and stability against hand-worked cases: a box barge's wall-sided
// GZ, a crew on the rail, a mass roll-up, and the boats it must read right.

import { describe, it, expect } from "vitest";
import { prepareMesh } from "./mesh-hydro.js";
import { buildTable } from "./statics.js";
import { boxMesh } from "../test/meshes.js";
import {
  stabilityCurve,
  steadyHeel,
  crewOf,
  massRollup,
  heelingMoment,
  windForHeel,
  dellenbaugh,
  harkenSheetN,
  rudderTorque,
  curveAt,
  RHO_AIR,
  PSF,
} from "./stability.js";
import { foilOf } from "./foils.js";
import { G as GRAV } from "./ratios.js";
import { RHO_SEA, LBF, KNOT } from "./units.js";
import { normalize, defaultDoc } from "../doc.js";
import { computeNumbers } from "../numbers.js";

const RAD = Math.PI / 180;
const shift = (t, d) => t.map((v, i) => v + d[i % 3]);

// 10 × 4 × 2 m box, waterline at z = 0 at 1 m draft (40 m³), G 0.5 m above it
const mesh = prepareMesh(shift(boxMesh(10, 4, 2), [0, 0, -1]));
const Va = 1;
const table = buildTable(mesh, { volumes: [40, 40 - Va] });
const heels = Array.from({ length: 37 }, (_, i) => i * 2.5);
const noApp = { volumeM3: 0, volumeCentroid: null };
const massOf = (o = {}) => ({ volumeM3: 40, appVolumeM3: 0, massKg: 40 * RHO_SEA, G: [0, 0, 0.5], crew: { massKg: 0, arm: 0 }, ...o });
const wallSided = (phi, GM, BM) => Math.sin(phi) * (GM + 0.5 * BM * Math.tan(phi) ** 2);

describe("a box barge's righting and heeling", () => {
  const GM = 0.5 + 4 / 3 - 1.5; // KB 0.5 + BM 4/3 − KG 1.5
  const W = 40 * RHO_SEA * GRAV;

  it("a constant heeling moment heels her M/(Δ·g·GM) to 2%, and to the wall-sided root to 0.02°", () => {
    const { points } = stabilityCurve(table, { mass: massOf(), app: noApp, heels });
    const M = W * GM * Math.sin(5 * RAD);
    const s = steadyHeel(points, () => M);
    const small = M / (W * GM) / RAD;
    // the wall-sided root, by bisection
    let lo = 0, hi = 20 * RAD;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (W * wallSided(m, GM, 4 / 3) < M) lo = m;
      else hi = m;
    }
    console.log(`box, constant M: steady heel ${s.heelDeg.toFixed(4)}°, M/(ΔgGM) ${small.toFixed(4)}°, wall-sided ${(lo / RAD).toFixed(4)}°`);
    expect(s.state).toBe("steady");
    expect(Math.abs(s.heelDeg / small - 1)).toBeLessThan(0.02);
    expect(Math.abs(s.heelDeg - lo / RAD)).toBeLessThan(0.02);
    // too much moment: past the greatest RM there's no steady heel
    expect(steadyHeel(points, () => 2 * W).state).toBe("overpowered");
  });

  it("an appendage's buoyancy is a rigid body: GZ = (∇c·GZc + ∇a·GZa)/∇, and GM gains it", () => {
    // 1 m³ of foil 1.5 m below the DWL; the box carries the other 39 m³ at T = 0.975
    const app = { volumeM3: Va, volumeCentroid: [0, -1.5] };
    const mass = massOf({ appVolumeM3: Va });
    const { points, gmTable } = stabilityCurve(table, { mass, app, heels: [0, 10, 20] });
    const T = (40 - Va) / 40;
    const BMc = 16 / (12 * T);
    const zG = 0.5;
    const GMc = -1 + T / 2 + BMc - zG; // in the frame: K at −1
    for (const p of points.filter((p) => p.heelDeg > 0)) {
      const phi = p.heelDeg * RAD;
      const hand = ((40 - Va) * wallSided(phi, GMc, BMc) + Va * Math.sin(phi) * (-1.5 - zG)) / 40;
      console.log(`box + 1 m³ at −1.5 m, ${p.heelDeg}°: GZ ${p.gz.toFixed(8)} (hand ${hand.toFixed(8)})`);
      expect(p.gz).toBeCloseTo(hand, 9);
    }
    // GM: zB of both, + I/∇ (I = L·B³/12 = 53.33), − zG
    const zB = ((40 - Va) * (-1 + T / 2) + Va * -1.5) / 40;
    expect(gmTable).toBeCloseTo(zB + (10 * 64) / 12 / 40 - zG, 9);
  });

  it("appendages displacing the whole boat leave no curve, and say why, instead of throwing", () => {
    // a full-size keel under a model-sized hull (found by the browser probe on a 1 m camber render): ∇ − ∇a ≤ 0
    for (const appVolumeM3 of [40, 41]) {
      const c = stabilityCurve(table, { mass: massOf({ appVolumeM3 }), app: { volumeM3: appVolumeM3, volumeCentroid: [0, -1.5] }, heels: [0, 10] });
      expect(c.gmTable).toBeNull();
      expect(c.points.every((p) => !p.available && /displace/.test(p.reason))).toBe(true);
      expect(c.readouts.gzMax).toBeNull();
    }
  });

  it("a crew on the rail adds m·g·arm·cos φ, arm = half-breadth + 0.15 m", () => {
    const crew = crewOf({ count: 1, kgEach: 80, mode: "rail", arm: null }, { x: 0, sheerZ: 1, halfBreadth: 2 });
    expect(crew.arm).toBeCloseTo(2.15, 12);
    expect(crew.at[2]).toBeCloseTo(1.35, 12);
    const { points } = stabilityCurve(table, { mass: massOf({ crew }), app: noApp, heels: [0, 30] });
    expect(points[0].crewRm).toBeCloseTo(80 * GRAV * 2.15, 9);
    expect(points[1].crewRm).toBeCloseTo(80 * GRAV * 2.15 * Math.cos(30 * RAD), 9);
    expect(points[1].rm).toBeCloseTo(W * points[1].gz + points[1].crewRm, 6);
    // a given arm wins; "none" counts nobody
    expect(crewOf({ count: 1, kgEach: 80, mode: "rail", arm: 1 }, { x: 0, sheerZ: 1, halfBreadth: 2 }).arm).toBe(1);
    expect(crewOf({ count: 3, kgEach: 80, mode: "none", arm: null }, { x: 0, sheerZ: 1, halfBreadth: 2 }).massKg).toBe(0);
  });

  it("the reef wind is the AWS whose steady heel is the heel limit", () => {
    const { points } = stabilityCurve(table, { mass: massOf(), app: noApp, heels });
    const set = { areaM2: 60, ce: [0, 7] };
    const aws = windForHeel(points, 20, set, -0.5);
    const s = steadyHeel(points, (phi) => heelingMoment(aws, phi, set, -0.5));
    expect(s.heelDeg).toBeCloseTo(20, 1);
    // HM = ½ρV²·A·C_H·h·cos²φ
    expect(heelingMoment(10, 0, set, -0.5)).toBeCloseTo(0.5 * RHO_AIR * 100 * 60 * 7.5, 9);
    expect(heelingMoment(10, 60, set, -0.5)).toBeCloseTo(0.25 * 0.5 * RHO_AIR * 100 * 60 * 7.5, 9);
  });
});

describe("formulas", () => {
  it("Dellenbaugh: 57.3·SA·HA·(1 lb/ft²)/(Δ·g·GM)", () => {
    expect(PSF).toBeCloseTo(47.880259, 5);
    expect(dellenbaugh({ saM2: 55, heelingArmM: 6, massKg: 8000, gm: 1.1 })).toBeCloseTo(((180 / Math.PI) * 55 * 6 * PSF) / (8000 * GRAV * 1.1), 12);
  });

  it("Harken's sheet rule: 400 ft² at 25 kn is 1,077.5 lb", () => {
    const ft2 = 400 * 0.3048 ** 2;
    expect(harkenSheetN(ft2, 25 * KNOT) / LBF).toBeCloseTo(1077.5, 9);
  });

  it("rudder-stock torque: q·A·CL_max·(0.25 − stock)·MAC at stall, q·A·1.1·(0.40 − stock)·MAC stalled", () => {
    const r = foilOf({ kind: "spade", aftOfStem: 0, span: 1, rootChord: 0.6, tipChord: 0.6, sweepDeg: 0, tc: 0.12 }, { id: "rudder", stemX: 0, rootZ: -0.2, endPlate: true });
    const q = 0.5 * RHO_SEA * 16;
    const t = rudderTorque(r, { speedMs: 4, stockFrac: 0.2, maxDeg: 35 });
    expect(t.atStallNm).toBeCloseTo(q * 0.6 * r.clMax * 0.05 * 0.6, 9);
    expect(t.stalledNm).toBeCloseTo(q * 0.6 * 1.1 * 0.2 * 0.6, 9);
    expect(t.nm).toBe(Math.max(t.atStallNm, t.stalledNm));
  });
});

describe("the mass roll-up", () => {
  const plan = { type: "cat", mast: { partners: [0, 1], head: [0, 9], heightM: 8 }, boom: { gooseneck: [0, 1.5], end: [-3, 1.5] }, sails: [] };
  const hull = { lcb: -0.2, lwl: 6, bottomZ: -0.4, mastStepZ: -0.4, sheerAt: () => 0.8, halfBreadthAt: () => 1, midDepthZ: 0.2 };
  const doc = normalize({ rig: { type: "cat", mast: { stepped: "deck", kgPerM: 2 } }, loading: { ballast: { kg: 300, at: "hull" }, crew: { count: 2, kgEach: 75, mode: "rail" } } });
  const app = { keel: null, foils: [], volumeM3: 0, volumeCentroid: null };

  it("sums to the displacement, the lightship takes the remainder, and G sits over the LCB", () => {
    const m = massRollup({ doc, plan, app, displacementKg: 2000, hull });
    const byId = Object.fromEntries(m.items.map((i) => [i.id, i]));
    // mast deck-stepped: 8 m at the given 2 kg/m, at mid-height z = 5; boom 0.6·2·3 = 3.6 kg at z 1.5
    expect(byId.mast.massKg).toBeCloseTo(16, 12);
    expect(byId.mast.at[2]).toBeCloseTo(5, 12);
    expect(byId.boom.massKg).toBeCloseTo(3.6, 12);
    expect(byId.rigging).toBeUndefined(); // a cat rig is unstayed
    expect(byId.ballast.at[2]).toBeCloseTo(-0.3, 12); // inside the hull, 0.1 m off the bottom
    expect(byId.crew.massKg).toBe(150);
    expect(byId.crew.at[2]).toBeCloseTo(0.8 + 0.35, 12);
    expect(byId.lightship.massKg).toBeCloseTo(2000 - 16 - 3.6 - 300 - 150, 9);
    expect(byId.lightship.at[2]).toBeCloseTo(0.2, 12);
    expect(m.massKg).toBeCloseTo(2000, 9);
    expect(m.G[0]).toBeCloseTo(-0.2, 9);
    const zHand = (16 * 5 + 3.6 * 1.5 + 300 * -0.3 + 150 * 1.15 + (2000 - 469.6) * 0.2) / 2000;
    expect(m.G[2]).toBeCloseTo(zHand, 9);
    expect(m.crew.arm).toBeCloseTo(1.15, 12);
  });

  it("a given lightship that doesn't add up leaves an unaccounted item and says so", () => {
    const d = normalize({ ...doc, loading: { ...doc.loading, lightship: { kg: 1000, vcg: 0.3 } } });
    const m = massRollup({ doc: d, plan, app, displacementKg: 2000, hull });
    const un = m.items.find((i) => i.id === "unaccounted");
    expect(un.massKg).toBeCloseTo(2000 - 1000 - 469.6, 9);
    expect(m.massKg).toBeCloseTo(2000, 9);
    expect(formatText(m.warnings.join(" "))).toMatch(/530 kg short/);
    expect(formatText(m.warnings.join(" "), "imperial")).toMatch(/1,169 lb short/);
    expect(m.G[0]).toBeCloseTo(-0.2, 9);
  });
});

describe("boats", () => {
  const withTable = (doc) => {
    const n0 = computeNumbers(doc);
    const t = buildTable(n0.form.mesh, { volumes: [n0.form.float.volumeM3, n0.form.float.volumeM3 - n0.analysis.app.volumeM3] });
    return computeNumbers(doc, { statics: { status: "ready", table: t, source: "mesh" } });
  };
  const val = (n, id) => n.sections.flatMap((s) => s.rows).find((r) => r.id === id);

  it("the stock sloop: G against sailing's SLOOP, steady heel rises with the wind, the reef wind heels her to the limit", () => {
    const n = withTable(defaultDoc());
    const a = n.analysis;
    // sailing/src/hull-model.js SLOOP: cg −0.3 m (0.3 m below the waterline), copied. Our G comes
    // from estimated masses, so this prints the difference; it is not a test of either.
    console.log(`stock sloop: VCG ${a.mass.G[2].toFixed(3)} m (SLOOP cg −0.300, Δ ${(a.mass.G[2] + 0.3).toFixed(3)}); GM ${a.stab.gmTable.toFixed(3)} m; RM30 ${(a.stab.rm30 / 1000).toFixed(1)} kN·m; reef wind ${(a.stab.reef[0].aws / KNOT).toFixed(1)} kn AWS; lead ${(a.balance.lead * 100).toFixed(2)}%`);
    const heelsByWind = a.stab.winds.map((w) => w.heelDeg ?? 90);
    for (let i = 1; i < heelsByWind.length; i++) expect(heelsByWind[i]).toBeGreaterThanOrEqual(heelsByWind[i - 1]);
    const set = a.sets[0];
    const s = steadyHeel(a.stab.points, (phi) => heelingMoment(a.stab.reef[0].aws, phi, set, a.clrZ));
    expect(s.heelDeg).toBeCloseTo(a.heelLimit, 1);
    // small-angle: RM at 1° ≈ Δ·g·GM·sin 1° + crew
    const rm1 = a.mass.massKg * GRAV * a.stab.gmTable * Math.sin(RAD) + a.mass.crew.massKg * GRAV * a.mass.crew.arm * Math.cos(RAD);
    expect(Math.abs(a.stab.rm1 / rm1 - 1)).toBeLessThan(0.01);
    expect(a.balance.leadBand.out).toBeUndefined();
    expect(val(n, "rm30").value).toBe(a.stab.rm30);
    expect(val(n, "loadRm30").value).toBe(a.stab.rm30);
  });

  it("a Laser/ILCA 7's righting moment is mostly her crew's (all figures estimated)", () => {
    // Shape: LOA 4.23, LWL 3.81, beam 1.37 (commonly quoted class figures, not checked here; the
    // validation step cites them). Sailing weight 154 kg, BWL, Tc, freeboard, rig and blades are
    // estimates for this test: a cat rig of ~7 m², a daggerboard, a kick-up rudder, one 80 kg sailor hiking.
    const doc = normalize({
      title: "Laser (test)",
      hull: { dims: { loa: 4.23, lwl: 3.81, beam: 1.37, bwl: 1.15, tc: 0.12, draft: 0.8, freeboard: 0.33, displacementKg: 154 } },
      rig: { type: "cat", mast: { aftOfStem: 1.0, rakeDeg: 0, stepped: "deck" }, P: 5.1, E: 2.7, BAS: 0.2, main: { roach: 0.03, reefs: [] }, headsail: null },
      appendages: {
        keel: { kind: "daggerboard", aftOfStem: 1.55, span: 0.75, rootChord: 0.33, tipChord: 0.3, sweepDeg: 0, tc: 0.1, bulb: null },
        rudder: { kind: "kick-up", aftOfStem: 4.25, span: 0.65, rootChord: 0.26, tipChord: 0.2, sweepDeg: 5, tc: 0.1, maxDeg: 35, stockFrac: 0.15 },
      },
      loading: { ballast: { kg: 0 }, crew: { count: 1, kgEach: 80, mode: "hiking" } },
      prov: Object.fromEntries(["hull.dims.bwl", "hull.dims.tc", "hull.dims.freeboard", "hull.dims.displacementKg", "loading.crew.count"].map((k) => [k, "estimated"])),
    });
    const n = withTable(doc);
    const a = n.analysis;
    const at = (d) => ({ boat: curveAt(a.stab.points, d, "rmBoat"), crew: curveAt(a.stab.points, d, "crewRm") });
    for (const d of [10, 20, 25]) {
      const r = at(d);
      console.log(`Laser at ${d}°: RM boat ${r.boat.toFixed(0)} N·m, crew ${r.crew.toFixed(0)} N·m (${((100 * r.crew) / (r.boat + r.crew)).toFixed(0)}%)`);
    }
    console.log(`Laser: crew arm ${a.mass.crew.arm.toFixed(3)} m, rig ${a.mass.riggedMassKg.toFixed(1)} kg, lightship ${a.mass.lightship.massKg.toFixed(1)} kg, steady heel ${a.stab.winds.map((w) => `${(w.aws / KNOT).toFixed(0)} kn ${w.heelDeg?.toFixed(1) ?? w.state}`).join(", ")}`);
    expect(a.stab.crewShare).toBeGreaterThan(0.6);
    expect(val(n, "crewArm").prov).toBe("estimated");
    expect(val(n, "crewShare").prov).toBe("from-estimated");
    // the rudder hangs on the transom, with no end plate
    expect(a.app.rudder.endPlate).toBe(false);
    expect(a.app.rudder.arEff).toBeCloseTo(a.app.rudder.arGeom, 12);
    expect(n.warnings.join(" ")).not.toMatch(/weigh .* more than/);
  });
});
