// The contract (contract.js): hand-worked cases for the figures it makes
// itself (frame, gyradii, the lumped sail, furl and sheet leads, the rudder
// stock), and cross-checks that everything it only carries is exactly what
// the modules that compute it say (the tool's VPP, design.js, stability).

import { describe, it, expect } from "vitest";
import { normalize, setPath } from "./doc.js";
import { computeNumbers, designKey } from "./numbers.js";
import { buildTable } from "./naval/statics.js";
import { polar, resistanceOf } from "./naval/vpp.js";
import { curveAt } from "./naval/stability.js";
import { buildContract, frameOf, gyradii, lumpedOf, furledClew, leadFor, pointOf, LUMPED_CE_HEIGHT, CHAINPLATE_FRAC } from "./contract.js";
import { staticsJobFor } from "./rig-build.js";
import { validate, errorText, polygonAreaCentroid } from "../contract/v1/validate.js";
import { buildCase, camberLinked, linkedDoc } from "./test/contract-cases.js";
import { buildSailPlan } from "./naval/sailplan.js";

const RAD = Math.PI / 180;
const readout = (n, id) => n.sections.flatMap((s) => s.rows).find((r) => r.id === id)?.value;
const show = (title, rows) =>
  console.log(`\n${title}\n${rows.map(([k, a, b]) => `  ${k.padEnd(34)} ours ${String(typeof a === "number" ? a.toFixed(6) : a).padStart(12)}  hand ${String(typeof b === "number" ? b.toFixed(6) : b).padStart(12)}${typeof a === "number" && typeof b === "number" ? `  Δ ${(a - b).toExponential(2)}` : ""}`).join("\n")}`);

describe("figures the contract makes, by hand", () => {
  it("frame: a camber hull (bow +X, up +Y) lowered by h maps glTF (x, y, z) to (x, −z, y − h), and back", () => {
    const h = 0.37;
    const doc = linkedDoc();
    const fr = frameOf(doc, { shiftZ: h });
    const m = fr.glbToFrame;
    const apply = (p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
    const g = [1.5, 2.25, -0.75];
    expect(apply(g)).toEqual([1.5, 0.75, 2.25 - h]);
    const back = fr.toGlb(apply(g));
    back.forEach((v, i) => expect(v).toBeCloseTo(g[i], 14));
    // the synthetic hull's GLB uses the same default frame
    expect(frameOf(normalize({}), { shiftZ: 0 }).glbAxes).toEqual({ bow: "+X", up: "+Y" });
  });

  it("gyradii: two point masses and a rod about their centre", () => {
    // 2 kg at x = ±1, and a 12 kg rod 2 m long along z through G:
    // I_roll = 12·2²/12 = 4; I_pitch = 2·1 + 2·1 + 4 = 8; I_yaw = 4; m = 16
    const items = [
      { id: "a", kind: "rig", massKg: 2, atM: [1, 0, 0] },
      { id: "b", kind: "rig", massKg: 2, atM: [-1, 0, 0] },
      { id: "mast", kind: "rig", massKg: 12, atM: [0, 0, 0] },
    ];
    const k = gyradii(items, [0, 0, 0], { beam: 0, loa: 0 }, { mast: { lengthM: 2, u: [0, 0, 1] } });
    show("gyradii (m)", [["roll", k[0], Math.sqrt(4 / 16)], ["pitch", k[1], Math.sqrt(8 / 16)], ["yaw", k[2], Math.sqrt(4 / 16)]]);
    expect(k[0]).toBeCloseTo(0.5, 12);
    expect(k[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(k[2]).toBeCloseTo(0.5, 12);
    // the lightship's own k: 100 kg at G, beam 2, LOA 10 → roll 0.7, pitch and yaw 2.5
    const l = gyradii([{ id: "lightship", kind: "lightship", massKg: 100, atM: [0, 0, 0] }], [0, 0, 0], { beam: 2, loa: 10 });
    expect(l[0]).toBeCloseTo(0.7, 12);
    expect(l[1]).toBeCloseTo(2.5, 12);
  });

  it("the lumped sail: a cat's roachless main gives foot = E and luff = P/(3·0.38); its CE is sailing's tack + 0.38·luff, foot/3 aft", () => {
    const plan = buildSailPlan({ type: "cat", mast: { aftOfStem: 1, rakeDeg: 0 }, P: 6, E: 2.7, BAS: 0.4, main: { roach: 0, reefs: [] } }, { stemX: 2, stemZ: 0.3, sheerZ: 0.3 });
    const ls = lumpedOf(plan);
    show("lumped sail, cat, no roach", [["foot", ls.footM, 2.7], ["luff", ls.luffM, 6 / (3 * LUMPED_CE_HEIGHT)], ["tack x", ls.tackM[0], 1 + 0], ["tack z", ls.tackM[2], 0.7]]);
    expect(ls.footM).toBeCloseTo(2.7, 12);
    expect(ls.luffM).toBeCloseTo(6 / (3 * LUMPED_CE_HEIGHT), 12);
    expect(ls.tackM[0]).toBeCloseTo(1, 12); // the gooseneck: 1 m aft of the stem at x = 2
    expect(ls.tackM[2]).toBeCloseTo(0.3 + 0.4, 12);
    // sailing's rule (physics.js): CE = tack + CE_HEIGHT·luff up, foot/3 aft
    expect(ls.tackM[2] + LUMPED_CE_HEIGHT * ls.luffM).toBeCloseTo(plan.actual.ce[1], 12);
    expect(ls.tackM[0] - ls.footM / 3).toBeCloseTo(plan.actual.ce[0], 12);
    expect(ls.areaM2).toBeCloseTo(0.5 * 6 * 2.7, 12);
  });

  it("the lumped sail of a sloop: still the combined CE, its arm the sails' area-weighted swing arms", () => {
    const { n } = buildCase("sloop-12m");
    const ls = lumpedOf(n.plan);
    const arm = n.plan.sails.reduce((s, x) => s + x.areaM2 * ((x.id === "main" ? n.plan.boom.gooseneck[0] : x.polygon[0][0]) - x.ce[0]), 0) / n.plan.actual.areaM2;
    expect(ls.footM).toBeCloseTo(3 * arm, 12);
    expect(ls.tackM[2] + LUMPED_CE_HEIGHT * ls.luffM).toBeCloseTo(n.plan.actual.ce[1], 12);
    expect(ls.tackM[0] - ls.footM / 3).toBeCloseTo(n.plan.actual.ce[0], 12);
  });

  it("furl: the clew slides toward the luff along the LP line, LP × (1 − furl)", () => {
    const c = furledClew([0, 0, 0], [0, 0, 10], [-4, 0, 1], 0.25);
    expect(c[0]).toBeCloseTo(-3, 12);
    expect(c[2]).toBeCloseTo(1, 12);
  });

  it("a sheet lead: the line from mid-luff through the clew, to a flat deck, at the least sheeting angle", () => {
    // mid-luff (0, 0, 5) through the clew (−4, 0, 1) reaches z = 0 at x = −5; 5 m aft of the tack at 7°: y = 5·tan 7°
    const l = leadFor({ tack: [0, 0, 0], head: [0, 0, 10], clew: [-4, 0, 1] }, () => 0, 7);
    expect(l.port[0]).toBeCloseTo(-5, 9);
    expect(l.port[2]).toBeCloseTo(0, 9);
    expect(l.port[1]).toBeCloseTo(5 * Math.tan(7 * RAD), 9);
    expect(l.starboard[1]).toBeCloseTo(-l.port[1], 12);
  });

  it("the rudder stock passes through the MAC's balance point, from the tip to the deck", () => {
    const { contract, n } = buildCase("sloop-12m");
    const r = contract.appendages.find((a) => a.id === "rudder");
    const f = n.analysis.app.rudder;
    const k = r.stock.balanceFrac;
    const [a, b] = r.stock.axisM;
    // where the axis crosses the MAC's height
    const zMac = f.corners.rootLE[1] - f.macFromRoot;
    const t = (zMac - a[2]) / (b[2] - a[2]);
    const x = a[0] + t * (b[0] - a[0]);
    const macLE = f.corners.rootLE[0] - f.macFromRoot * Math.tan(f.sweepDeg * RAD);
    show("rudder stock", [["x at the MAC", x, macLE - k * f.mac], ["deck z", b[2], n.analysis.geo.sheerAt(b[0])]]);
    expect(x).toBeCloseTo(macLE - k * f.mac, 9);
    expect(b[2]).toBeCloseTo(n.analysis.geo.sheerAt(b[0]), 6);
    expect(r.stock.bearingM[2]).toBeCloseTo(f.corners.rootLE[1], 12);
  });
});

describe("what the contract carries is what the aid computed", () => {
  it("predicted points are the tool's VPP output, exactly (same table, same design)", () => {
    const { contract, n, doc } = buildCase("sloop-12m");
    // the tool's path: its worker builds the table from staticsJobFor, then the polar from n.design
    const n0 = computeNumbers(doc);
    const j = staticsJobFor(n0.form);
    const table = buildTable(j.triangles, j);
    const nTool = computeNumbers(doc, { statics: { status: "ready", table, source: "mesh" } });
    expect(designKey(nTool.design)).toBe(designKey(n.design));
    const p = polar(nTool.design);
    expect(contract.predicted.points).toEqual(p.points.map(pointOf));
    expect(contract.predicted.beat).toEqual(p.beat.map(pointOf));
    expect(contract.predicted.run).toEqual(p.run.map(pointOf));
    expect(contract.predicted.reference).toEqual(pointOf(nTool.reference));
    expect(contract.predicted.helm.text).toBe(nTool.helm.text);
  });

  for (const id of ["sloop-12m", "j24", "laser-ilca7", "cuvature-first-guess"])
    it(`${id}: areas, CEs, mass, foils and righting are design.js's and the stability module's`, () => {
      const { contract: c, n } = buildCase(id);
      const D = n.design;
      expect(c.sets.map((s) => s.id)).toEqual(D.sets.map((s) => s.id));
      c.sets.forEach((s, i) => {
        expect(s.areaM2).toBe(D.sets[i].areaM2);
        expect(s.ceM).toEqual([D.sets[i].ce[0], 0, D.sets[i].ce[1]]);
        expect(s.heM).toBe(D.sets[i].he);
        expect(s.are).toBe(D.sets[i].are);
      });
      const full = D.sets[0].sails;
      for (const s of full) {
        const cs = c.sails.find((x) => x.id === s.id);
        expect(cs.liftSlope).toBe(s.slope);
        expect(cs.ar).toBe(s.ar);
        expect(cs.model.family).toBe(s.kind);
      }
      expect(c.loading.massKg).toBe(D.massKg);
      expect(c.loading.cgM).toEqual(D.G);
      expect(c.loading.righting.boatNm).toEqual(D.rm.boat);
      expect(c.loading.righting.crewNm).toEqual(D.rm.crew);
      for (const id2 of ["keel", "rudder"]) {
        const f = D[id2];
        const a = c.appendages.find((x) => x.id === id2);
        if (!f) continue;
        expect(a.areaM2).toBe(f.areaM2);
        expect(a.arGeom).toBe(f.arGeom);
        expect(a.qcM).toEqual([f.qc[0], 0, f.qc[1]]);
        expect(a.sweepHalfDeg).toBe(f.sweepHalfDeg);
      }
      expect(c.hull.sideForce.yv).toBe(D.hullSide.yv);
      // RM30 is the stability module's
      expect(c.loads.rm30Nm).toBe(curveAt(n.analysis.stab.points, 30));
      expect(c.loads.rm30Nm).toBe(readout(n, "rm30"));
      expect(c.loads.rudderTorqueNm).toBe(n.analysis.loads.rudder.nm);
      // the resistance table is the design's own model, sampled
      const R = resistanceOf(D);
      const iv = Math.floor(c.resistance.speedsMs.length / 2), ih = c.resistance.heelsDeg.indexOf(20);
      expect(c.resistance.hullN[ih][iv]).toBe(R.at(c.resistance.speedsMs[iv], 20, 0).hull);
      // sails: each polygon's area and centroid are the stated ones
      for (const s of c.sails) {
        const g = polygonAreaCentroid(s.polygonM);
        expect(g.area).toBeCloseTo(s.areaM2, 9);
      }
      const v = validate(c);
      expect(v.ok, errorText(v)).toBe(true);
    });

  it("the Laser's contract states the planing model's points: planing regime, Savitsky's flags where it extrapolates", () => {
    const { contract: c } = buildCase("laser-ilca7");
    expect(c.resistance.planing.capability).toBeGreaterThan(0.5);
    const planing = c.predicted.points.filter((p) => p.regime === "planing" || p.regime === "transition");
    expect(planing.length).toBeGreaterThan(0);
    expect(c.resistance.regime).toContain("planing");
    const w = c.resistance.planingWeight;
    expect(Math.max(...w)).toBeCloseTo(1, 12);
    console.log(`  Laser: ${planing.length} of ${c.predicted.points.length} points planing or in transition; ${planing.filter((p) => p.flags.some((f) => f.id === "planing-range")).length} flagged "planing model extrapolated"`);
  });
});

describe("hardpoints and loads", () => {
  for (const id of ["sloop-12m", "catalina-30", "cuvature-first-guess"])
    it(`${id}: forestay at the stemhead, chainplates on the sheer, the jib's lead track spans its leads over the furl range`, () => {
      const { contract: c, n } = buildCase(id);
      const geo = n.analysis.geo;
      const hp = c.hardpoints;
      expect(hp.forestayTackM).toEqual(hp.stemheadM); // forestayAftOfStem 0 on these
      expect(hp.stemheadM).toEqual([n.form.stem[0], 0, n.form.stem[1]]);
      for (const cp of hp.chainplates) {
        expect(cp.atM[2]).toBeCloseTo(geo.sheerAt(cp.atM[0]), 12);
        expect(Math.abs(cp.atM[1])).toBeCloseTo(CHAINPLATE_FRAC * geo.halfBreadthAt(cp.atM[0]), 12);
      }
      const fs = c.rig.standing.find((s) => s.id === "forestay");
      expect(fs.fromM).toEqual(hp.forestayTackM);
      const jib = c.sails.find((s) => s.id === "jib");
      for (const t of hp.jibLeads.filter((l) => l.sail === "jib")) {
        const xs = t.leads.map((l) => l.atM[0]);
        expect(t.trackFromM[0]).toBe(Math.max(...xs));
        expect(t.trackToM[0]).toBe(Math.min(...xs));
        for (const l of t.leads) {
          expect(l.atM[0]).toBeLessThanOrEqual(t.trackFromM[0]);
          expect(l.atM[0]).toBeGreaterThanOrEqual(t.trackToM[0]);
          // each lead sits on the deck, on its side, at the jib's least sheeting angle from the tack
          expect(l.atM[2]).toBeCloseTo(geo.sheerAt(l.atM[0]), 6);
          expect(Math.sign(l.atM[1])).toBe(t.side === "port" ? 1 : -1);
          expect(Math.atan2(Math.abs(l.atM[1]), jib.tackM[0] - l.atM[0]) / RAD).toBeCloseTo(jib.sheeting.minDeg, 9);
        }
        // furling moves the lead forward (the clew rises and comes forward)
        const byFurl = [...t.leads].sort((a, b) => a.furl - b.furl);
        expect(byFurl[byFurl.length - 1].atM[0]).toBeGreaterThan(byFurl[0].atM[0]);
        console.log(`  ${id} ${t.side} jib track: ${(t.trackFromM[0] - t.trackToM[0]).toFixed(3)} m long, furl ${byFurl.map((l) => l.furl).join("/")}`);
      }
      // loads: windward chainplates carry RM30 over their base
      for (const v of Object.values(c.loads.chainplatesN)) expect(v).toBeCloseTo(c.loads.rm30Nm / c.loads.chainplateBaseM, 6);
      expect(c.loads.chainplateBaseM).toBeCloseTo(Math.abs(hp.chainplates[0].atM[1]) * 2 / 2, 12);
    });

  it("a cat rig is unstayed: no chainplates, no standing rigging, no headsail leads; its crew station is the hiking one", () => {
    const { contract: c } = buildCase("laser-ilca7");
    expect(c.hardpoints.chainplates).toEqual([]);
    expect(c.rig.standing).toEqual([]);
    expect(c.hardpoints.jibLeads).toEqual([]);
    expect(c.hardpoints.backstayPlateM).toBeNull();
    const st = c.loading.crew.stations[0];
    expect(c.loading.crew.mode).toBe("hiking");
    expect(st.atM[1]).toBe(c.loading.crew.armM);
  });

  it("a cutter: the inner forestay runs from the staysail's tack to its head, and the staysail has its own leads", () => {
    const d = structuredClone(buildCase("sloop-12m").doc);
    setPath(d, ["rig", "type"], "cutter");
    setPath(d, ["rig", "staysail"], { I2: 8, J2: 2.2, LP2: 2, clewHeight: null });
    const doc = normalize(d);
    const n0 = computeNumbers(doc);
    const j = staticsJobFor(n0.form);
    const n = computeNumbers(doc, { statics: { status: "ready", table: buildTable(j.triangles, j), source: "mesh" } });
    const r = buildContract({ doc, n, polar: null });
    expect(r.ok).toBe(true);
    const c = r.contract;
    const st = c.sails.find((s) => s.id === "staysail");
    const inner = c.rig.standing.find((s) => s.id === "inner-forestay");
    expect(inner.fromM).toEqual(st.tackM);
    expect(inner.toM).toEqual(st.headM);
    expect(c.hardpoints.innerForestayTackM).toEqual(st.tackM);
    expect(c.hardpoints.jibLeads.filter((l) => l.sail === "staysail")).toHaveLength(2);
    expect(c.predicted.status).toBe("not-computed");
    const v = validate(c);
    expect(v.ok, errorText(v)).toBe(true);
  });
});

describe("a contract on a linked camber hull", () => {
  it("states the hull as linked and its frame as camber's, lowered to the floated waterplane", () => {
    const { contract: c, n } = buildCase("cuvature-first-guess");
    expect(c.source.hull.kind).toBe("linked");
    expect(c.frame.glbAxes).toEqual({ bow: "+X", up: "+Y" });
    expect(c.frame.design.sourceWaterplaneZM).toBe(n.form.shiftZ);
    expect(c.hull.prov).toBe("mesh");
    expect(c.source.statics).toBe("mesh");
    expect(c.hull.envelope.length).toBeGreaterThan(0); // a beamy camber hull is outside DSYHS
    expect(camberLinked).toBeTypeOf("function");
  });
});

describe("a degenerate hull still makes a contract that validates", () => {
  it("a 1.2 m, 5 kg stock rig (Savitsky has no solution at some speeds): every resistance cell is a number", async () => {
    const { composeRig } = await import("./rig-build.js");
    const { defaultDoc } = await import("./doc.js");
    const d = defaultDoc();
    Object.assign(d.hull.dims, { loa: 1.2, lwl: 1.1, bwl: 0.25, beam: 0.3, displacementKg: 5 });
    const r = composeRig({ doc: d, polar: false });
    expect(r.ok, r.why).toBe(true);
    const v = validate(JSON.parse(JSON.stringify(r.contract)));
    expect(v.ok, errorText(v)).toBe(true);
    expect(r.contract.resistance.hullN.flat().every(Number.isFinite)).toBe(true);
  });
});
