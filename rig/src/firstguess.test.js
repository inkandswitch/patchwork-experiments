// The first guess and the 1-D helpers. The first guess is rules of thumb, so
// the tests check that each rule is applied as stated (hand values), that
// the result is a whole, sound boat on camber's hulls and the fixtures'
// hulls, and print how its proportions compare with the real boats (the
// rules were read off those boats, so that is a consistency check, not a
// validation). The helpers are checked against the model they solve with.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { firstGuess, pForArea, RULES, targetLead, FIRST_GUESS_KEYS } from "./firstguess.js";
import { solve1d, mastForHelm, mastForLead, scaleToSAD } from "./helpers.js";
import { normalize, defaultDoc, setPath } from "./doc.js";
import { computeNumbers } from "./numbers.js";
import { glbTriangles } from "./link/glb-read.js";
import { FIXTURES, fixtureDoc } from "./fixtures/index.js";
import { buildSailPlan, jOf } from "./naval/sailplan.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const CAMBER = { bow: "+X", up: "+Y" };
const camber = (name) => ({ status: "ready", mesh: glbTriangles(new Uint8Array(readFileSync(here(`./test/fixtures/camber/${name}.glb`)))), chip: name });
const linkedDoc = (kg = 8000) =>
  normalize({ ...defaultDoc(), hull: { ...defaultDoc().hull, link: { url: "automerge:hull", frame: CAMBER } }, loading: { ...defaultDoc().loading, displacement: { from: "given", kg } } });
const apply = (doc, writes) => {
  const d = structuredClone(doc);
  for (const [p, v] of writes) setPath(d, p, v);
  return normalize(d);
};
const readout = (n, id) => n.sections.flatMap((s) => s.rows).find((r) => r.id === id)?.value;

describe("the rules, by hand", () => {
  it("P from the area: ½·P·E + ½·I·J with E = P/3, I = 1.15·P, J = 3.5 comes back to the area", () => {
    // P²/6 + 0.575·3.5·P = 40  →  P = (−2.0125 + √(2.0125² + 4·40/6)) / (1/3) = 10.4458…
    const P = pForArea(40, { r: 3, c: 1.15, J: 3.5 });
    expect(P).toBeCloseTo((-2.0125 + Math.sqrt(2.0125 ** 2 + 160 / 6)) * 3, 12);
    expect(0.5 * P * (P / 3) + 0.5 * 1.15 * P * 3.5).toBeCloseTo(40, 12);
    // a cat: ½·P·P/1.9 = 7  →  P = √(2·1.9·7)
    expect(pForArea(7, { r: 1.9, c: 0, J: 0 })).toBeCloseTo(Math.sqrt(26.6), 12);
  });

  it("the lead aimed at is the band's middle (a cutter uses the masthead's; a cat has none)", () => {
    expect(targetLead("masthead", "fin")).toBeCloseTo(0.07, 12);
    expect(targetLead("fractional", "fin")).toBeCloseTo(0.05, 12);
    expect(targetLead("cutter", "fin")).toBeCloseTo(0.07, 12);
    expect(targetLead("cat", "daggerboard")).toBeNull();
  });

  it("every rule says what it is based on and that it is to verify", () => {
    for (const [k, r] of Object.entries(RULES)) {
      expect(r.basis, k).toMatch(/\w/);
      expect(r.verify, k).toMatch(/to verify/);
    }
  });

  it("solve1d: Illinois on a monotone function, rising or falling, and says when the target is out of reach", () => {
    const a = solve1d((x) => x ** 3, 8, { lo: 0, hi: 10, x0: 0.5, step: 0.3, tolX: 1e-12, tolF: 1e-12 });
    expect(a.ok).toBe(true);
    expect(a.x).toBeCloseTo(2, 9);
    const b = solve1d((x) => -2 * x + 1, -5, { lo: -10, hi: 10, x0: 0, step: 1, tolF: 1e-12 });
    expect(b.x).toBeCloseTo(3, 9);
    const c = solve1d((x) => x, 20, { lo: 0, hi: 10, x0: 1, step: 1 });
    expect(c.ok).toBe(false);
    expect(c.why).toMatch(/out of reach/);
  });
});

describe("a first guess on camber's hulls (12 m, floated at a given 8 t)", () => {
  for (const name of ["cuvature-kink-with-unmodified-pchip", "flat-bottom", "narrow-transom", "hull-default"])
    it(name, () => {
      const linked = camber(name);
      const g = firstGuess(linkedDoc(), { linked });
      expect(g.ok, g.why).toBe(true);
      const n = computeNumbers(g.doc, { linked });
      const h = n.form.hydro;
      const keel = n.analysis.app.keel;
      const rudder = n.analysis.app.rudder;
      const r = g.report;
      // the rules, as stated
      expect(r.type).toBe("masthead");
      expect(Math.abs(n.ratios.saDDesigner - 17)).toBeLessThan(0.5);
      expect(n.ratios.saDDesigner).toBeCloseTo(17, 3); // solved, not approximated
      expect(jOf(g.doc.rig)).toBeCloseTo(RULES.mast.jOverLwl * h.lwl, 3);
      expect(g.doc.rig.P / g.doc.rig.E).toBeCloseTo(3, 3);
      expect(g.doc.rig.BAS / g.doc.rig.P).toBeCloseTo(0.12, 3);
      expect(n.ratios.ballast).toBeCloseTo(0.38, 3);
      expect(Math.abs(keel.qc[0] - h.lcb)).toBeLessThan(0.01); // its quarter chord over the LCB
      expect(keel.areaM2 / n.plan.designer.areaM2).toBeCloseTo(0.04, 3);
      expect(keel.arGeom).toBeGreaterThanOrEqual(RULES.keelArea.minArGeom - 1e-3); // planform rounded to 0.1 mm
      expect(r.draftOverallM).toBeGreaterThanOrEqual(RULES.draft.keelboat * h.lwl - 0.01);
      expect(rudder.areaM2 / keel.areaM2).toBeCloseTo(0.35, 3);
      expect(Math.abs(rudder.qc[0] - (h.xFwd - 0.92 * h.lwl))).toBeLessThan(0.1);
      // a sound boat: the sail plan and the hull agree, and the reference point solves and can be steered
      expect(buildSailPlan(g.doc.rig).warnings).toEqual([]);
      expect(n.reference?.ok).toBe(true);
      expect(n.helm.id).not.toBe("cannot");
      for (const p of g.estimated) expect(g.doc.prov[p], p).toBe("estimated");
      expect(normalize(g.doc)).toEqual(g.doc);
      console.log(
        `${name}: ${r.type}, P ${g.doc.rig.P.toFixed(2)} E ${g.doc.rig.E.toFixed(2)} I ${g.doc.rig.I.toFixed(2)} J ${jOf(g.doc.rig).toFixed(2)}, SA ${n.plan.designer.areaM2.toFixed(1)} m², SA/D ${n.ratios.saDDesigner.toFixed(3)}; ` +
          `keel ${keel.kind} ${keel.span.toFixed(2)} × ${keel.rootChord.toFixed(2)}/${keel.tipChord.toFixed(2)} m (AR ${keel.arGeom.toFixed(2)}), draft ${r.draftOverallM.toFixed(2)} m (rule ${r.draftRuleM.toFixed(2)}), Tc ${h.tc.toFixed(2)}; ` +
          `lead ${(100 * r.lead).toFixed(1)}% (${r.leadBand}); ${r.helm} — the plan wanted weather helm here: see the report`,
      );
    });
});

describe("a first guess on the fixtures' hulls, against the real boats (the rules came from these: a consistency check)", () => {
  it("prints the guess beside the real rig", () => {
    const lines = [];
    for (const { id, fixture } of FIXTURES) {
      const real = normalize(fixtureDoc(fixture));
      const g = firstGuess(real);
      expect(g.ok, `${id}: ${g.why}`).toBe(true);
      const nr = computeNumbers(real);
      const ng = computeNumbers(g.doc);
      const k = (d) => d.appendages.keel;
      const row = (what, a, b) => `${what} ${a.toFixed(2)}/${b.toFixed(2)}`;
      lines.push(
        `  ${real.title.padEnd(26)} guess/real: ${g.doc.rig.type}/${real.rig.type}; ${row("P", g.doc.rig.P, real.rig.P)}; ${row("E", g.doc.rig.E, real.rig.E)}; ${row("mast", g.doc.rig.mast.aftOfStem, real.rig.mast.aftOfStem)}; ${row("SA/D", ng.ratios.saDDesigner, nr.ratios.saDDesigner)}; ` +
          `${row("draft", readout(ng, "draftOverall"), readout(nr, "draftOverall"))}; ${row("keel LE", k(g.doc).aftOfStem, k(real).aftOfStem)}; helm ${ng.helm.text} / ${nr.helm.text}`,
      );
    }
    console.log(`\nFirst guess vs the published boats (m):\n${lines.join("\n")}`);
  }, 60_000);

  it("a dinghy hull gets a cat rig, a daggerboard, a kick-up rudder, no ballast and a hiking crew", () => {
    const laser = normalize(fixtureDoc(FIXTURES.find((f) => f.id === "laser-ilca7").fixture));
    const g = firstGuess(laser);
    expect(g.report.dinghy).toBe(true);
    expect(g.doc.rig.type).toBe("cat");
    expect(g.doc.rig.headsail).toBeNull();
    expect(g.doc.appendages.keel.kind).toBe("daggerboard");
    expect(g.doc.appendages.rudder.kind).toBe("kick-up");
    expect(g.doc.loading.ballast.kg).toBe(0);
    expect(g.doc.loading.crew).toMatchObject({ count: 1, mode: "hiking" });
    const n = computeNumbers(g.doc);
    expect(n.ratios.saDDesigner).toBeCloseTo(RULES.saD.dinghy, 3);
    expect(g.doc.rig.mast.aftOfStem).toBeCloseTo(RULES.mast.catAtLoa * n.form.loa, 3);
  });

  it("can be asked for another rig type: fractional and cutter", () => {
    const base = defaultDoc();
    for (const type of ["fractional", "cutter"]) {
      const g = firstGuess(base, {}, { type });
      expect(g.ok).toBe(true);
      expect(g.doc.rig.type).toBe(type);
      expect(buildSailPlan(g.doc.rig).warnings).toEqual([]);
      expect(computeNumbers(g.doc).ratios.saDDesigner).toBeCloseTo(17, 3);
      if (type === "cutter") expect(g.doc.rig.staysail).toBeTruthy();
    }
  });

  it("says why when there's no hull to guess from", () => {
    const d = normalize({ ...defaultDoc(), hull: { ...defaultDoc().hull, link: { url: "automerge:x", frame: CAMBER } } });
    const g = firstGuess(d, { linked: { status: "loading" } });
    expect(g.ok).toBe(false);
    expect(g.why).toMatch(/isn't read yet/);
  });

  it("replaces only the design: the hull, its link, the conditions and the title stay", () => {
    const linked = camber("flat-bottom");
    const d = linkedDoc();
    const g = firstGuess(d, { linked });
    expect(g.doc.hull).toEqual(d.hull);
    expect(g.doc.conditions).toEqual(d.conditions);
    expect(g.doc.title).toBe(d.title);
    expect(g.doc.loading.displacement).toEqual(d.loading.displacement);
    expect(FIRST_GUESS_KEYS).toEqual(["rig", "appendages", "loading", "prov", "sources"]);
  });
});

describe("the helpers", () => {
  const linked = camber("flat-bottom");
  const base = firstGuess(linkedDoc(), { linked }).doc;

  it("rig for a helm: the solved rig position gives the target rudder angle to ±0.5° (it gets ±0.02°), J and the area kept", () => {
    for (const target of [0, 3]) {
      const r = mastForHelm(base, { linked }, target);
      expect(r.ok, r.why).toBe(true);
      const after = computeNumbers(apply(base, r.writes), { linked });
      console.log(`rig for ${target}° helm: mast ${r.from.toFixed(3)} → ${r.x.toFixed(3)} m aft of the stem, tack ${r.writes[1][1].toFixed(3)} in ${r.evals} solves; reads ${after.reference.rudder.toFixed(3)}° (${after.helm.text}); lead ${(100 * after.analysis.balance.lead).toFixed(1)}%`);
      expect(Math.abs(after.reference.rudder - target)).toBeLessThan(0.5);
      expect(Math.abs(after.reference.rudder - target)).toBeLessThan(0.02);
      // the rig moves as a unit: mast and tack together, so J and the area stay
      expect(r.writes.map(([p]) => p.join("."))).toEqual(["rig.mast.aftOfStem", "rig.forestayAftOfStem"]);
      expect(after.ratios.saDDesigner).toBeCloseTo(17, 3);
      expect(jOf(apply(base, r.writes).rig)).toBeCloseTo(jOf(base.rig), 3);
    }
  }, 60_000);

  it("rig for a lead: the solved rig position gives the lead to 0.01% of LWL", () => {
    const r = mastForLead(base, { linked }, 0.12);
    expect(r.ok, r.why).toBe(true);
    const after = computeNumbers(apply(base, r.writes), { linked });
    expect(after.analysis.balance.lead).toBeCloseTo(0.12, 4);
  });

  it("scale to an SA/D: hits it to ±0.1 (exactly: area goes as the square), J and the mast scale, BAS and the forestay stay", () => {
    for (const target of [14, 20]) {
      const r = scaleToSAD(base, { linked }, target);
      expect(r.ok).toBe(true);
      const d = apply(base, r.writes);
      const n = computeNumbers(d, { linked });
      console.log(`scale to SA/D ${target}: ×${r.scale.toFixed(4)}, reads ${n.ratios.saDDesigner.toFixed(6)}`);
      expect(Math.abs(n.ratios.saDDesigner - target)).toBeLessThan(0.1);
      expect(n.ratios.saDDesigner).toBeCloseTo(target, 5);
      expect(jOf(d.rig)).toBeCloseTo(r.scale * jOf(base.rig), 5);
      expect(d.rig.BAS).toBe(base.rig.BAS);
      expect(d.rig.forestayAftOfStem).toBe(base.rig.forestayAftOfStem);
    }
  });

  it("say why when a target is out of reach, and write nothing", () => {
    const r = mastForHelm(base, { linked }, 60);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/no mast position/);
    expect(r.writes).toBeUndefined();
    expect(scaleToSAD(base, { linked }, 0).ok).toBe(false);
  }, 60_000);
});
