// The first guess and the 1-D helpers. The first guess is rules of thumb, so
// the tests check that each rule is applied as stated (hand values), that
// the mast solve is what its header derives (the lead affine in the mast's
// position, the answer inside the bracket or a refusal) on every hull there
// is a fixture for, that the result is a whole, sound boat, and print how
// its proportions compare with the real boats (the rules were read off those
// boats, so that is a consistency check, not a validation). The helpers are
// checked against the model they solve with.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { firstGuess, pForArea, RULES, targetLead, targetBand, mastForBand, FIRST_GUESS_KEYS } from "./firstguess.js";
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
    expect(targetBand("masthead", "fin-bulb")).toEqual([0.05, 0.09]);
    expect(targetBand("cutter", "fin")).toEqual([0.05, 0.09]);
    expect(targetBand("fractional", "long")).toEqual([0.1, 0.14]);
    expect(targetBand("masthead", "none")).toBeNull();
  });

  it("the mast for a band: every case of where the target falls against the bracket", () => {
    // lead(m) = 0.27 − (m − 4)/10 on a 10 m waterline; band 5–9%, target 7% at m = 6
    const q = { lead0: 0.27, m0: 4, lwl: 10, band: [0.05, 0.09] };
    const at = (lo, hi) => mastForBand({ ...q, lo, hi });
    // inside the bracket: the target exactly
    expect(at(4, 8)).toEqual({ ok: true, m: 6, lead: expect.closeTo(0.07, 12), clamped: false });
    // the bracket ends short of the target but inside the band (m 5.8…6.2): clamped, still in band
    expect(at(4, 5.9)).toEqual({ ok: true, m: 5.9, lead: expect.closeTo(0.08, 12), clamped: true });
    expect(at(6.1, 8)).toEqual({ ok: true, m: 6.1, lead: expect.closeTo(0.06, 12), clamped: true });
    // the band is m 5.8…6.2: a bracket ending just inside it is ok, just outside it is not
    expect(at(4, 5.81).ok).toBe(true);
    expect(at(4, 5.79).ok).toBe(false);
    expect(at(6.19, 8).ok).toBe(true);
    expect(at(6.21, 8).ok).toBe(false);
    // the bracket ends before the band begins: the nearest position, and not ok
    expect(at(4, 5.5)).toEqual({ ok: false, m: 5.5, lead: expect.closeTo(0.12, 12), clamped: true });
    expect(at(7, 8)).toEqual({ ok: false, m: 7, lead: expect.closeTo(-0.03, 12), clamped: true });
    // an empty bracket (J + E longer than the hull): nothing to place
    expect(at(5, 4.9)).toEqual({ ok: false, m: null, lead: null });
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

/** The mast solve, as its header states it: the model reads the target lead, and the rig fits the hull. */
function expectBalanced(g, n) {
  const r = g.report;
  const rig = g.doc.rig;
  const [lo, hi] = r.mastRangeM;
  // the model's own lead is the target: the mast is rounded to 0.1 mm, a lead of 1e-4/LWL
  expect(r.targetLead).toBe(targetLead(rig.type, g.doc.appendages.keel.kind));
  expect(r.mastClamped).toBe(false);
  expect(Math.abs(n.analysis.balance.lead - r.targetLead)).toBeLessThan(2e-4 / n.form.hydro.lwl + 1e-9);
  expect(r.lead).toBe(n.analysis.balance.lead);
  // inside the bracket: the tack at or aft of the stem, the boom's end at or forward of the stern
  expect(lo).toBeCloseTo(jOf(rig), 3);
  expect(hi).toBeCloseTo(n.form.loa - rig.E, 3);
  expect(rig.forestayAftOfStem).toBeGreaterThanOrEqual(0);
  expect(rig.mast.aftOfStem).toBeGreaterThanOrEqual(lo - 1e-4);
  expect(rig.mast.aftOfStem + rig.E).toBeLessThanOrEqual(n.form.loa + 1e-4);
  expect(r.tackAftOfStemM).toBe(rig.forestayAftOfStem);
}

describe("the mast solve's premise: the lead is affine in the rig's position, slope −1/LWL", () => {
  it("on a camber hull and a synthetic one, the model's lead at three positions is the line through the first", () => {
    for (const [doc, ctx] of [
      [firstGuess(linkedDoc(), { linked: camber("narrow-transom") }).doc, { linked: camber("narrow-transom") }],
      [firstGuess(normalize(fixtureDoc(FIXTURES.find((f) => f.id === "catalina-30").fixture))).doc, {}],
    ]) {
      const n0 = computeNumbers(doc, ctx);
      const lwl = n0.form.hydro.lwl;
      for (const dx of [-1.25, 0.5, 2]) {
        const moved = apply(doc, [
          [["rig", "mast", "aftOfStem"], doc.rig.mast.aftOfStem + dx],
          [["rig", "forestayAftOfStem"], doc.rig.forestayAftOfStem + dx],
        ]);
        expect(computeNumbers(moved, ctx).analysis.balance.lead).toBeCloseTo(n0.analysis.balance.lead - dx / lwl, 10);
      }
    }
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
      expectBalanced(g, n);
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
          `mast ${g.doc.rig.mast.aftOfStem.toFixed(2)} m aft of the stem (tack ${r.tackAftOfStemM.toFixed(2)}, bracket ${r.mastRangeM.map((v) => v.toFixed(2)).join("–")}); lead ${(100 * r.lead).toFixed(2)}% (${r.leadBand}); ${r.helm}`,
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
      // a sloop's mast is solved for the lead; a cat's has no band and goes by its rule
      if (g.doc.rig.type === "cat") expect(g.report).toMatchObject({ targetLead: null, mastRangeM: null, tackAftOfStemM: 0 });
      else expectBalanced(g, ng);
      const lead = (n) => `${(100 * n.analysis.balance.lead).toFixed(1)}%`;
      const k = (d) => d.appendages.keel;
      const row = (what, a, b) => `${what} ${a.toFixed(2)}/${b.toFixed(2)}`;
      lines.push(
        `  ${real.title.padEnd(26)} guess/real: ${g.doc.rig.type}/${real.rig.type}; ${row("P", g.doc.rig.P, real.rig.P)}; ${row("E", g.doc.rig.E, real.rig.E)}; ${row("mast", g.doc.rig.mast.aftOfStem, real.rig.mast.aftOfStem)}; ${row("SA/D", ng.ratios.saDDesigner, nr.ratios.saDDesigner)}; ` +
          `${row("draft", readout(ng, "draftOverall"), readout(nr, "draftOverall"))}; ${row("keel LE", k(g.doc).aftOfStem, k(real).aftOfStem)}; lead ${lead(ng)}/${lead(nr)}; helm ${ng.helm.text} / ${nr.helm.text}`,
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
      const n = computeNumbers(g.doc);
      expect(n.ratios.saDDesigner).toBeCloseTo(17, 3);
      expectBalanced(g, n);
      if (type === "cutter") expect(g.doc.rig.staysail).toBeTruthy();
    }
  });

  it("says why when there's no hull to guess from", () => {
    const d = normalize({ ...defaultDoc(), hull: { ...defaultDoc().hull, link: { url: "automerge:x", frame: CAMBER } } });
    const g = firstGuess(d, { linked: { status: "loading" } });
    expect(g.ok).toBe(false);
    expect(g.why).toMatch(/isn't read yet/);
  });

  it("says so, and guesses nothing, when no mast position balances the hull or the rig doesn't fit it", () => {
    // narrow-transom at 12 m floated at 16 t: SA/D 17's boom leaves the mast 4.39–5.64 m, and the keel
    // (over the LCB) is too far aft of that for the band: the nearest position still reads 10.8%
    const a = firstGuess(linkedDoc(16000), { linked: camber("narrow-transom") });
    expect(a.ok).toBe(false);
    expect(a.why).toMatch(/^no mast position balances this hull: .* 5\.0%–9\.0% band nowhere from 4\.39 m .* to 5\.64 m aft of the stem .*; the nearest, at 5\.64 m, gives 10\.8%$/);
    expect(a.doc).toBeUndefined();
    // cuvature-kink at 12 m at 24 t (it floats at 23.7 t as drawn): J and the boom together are longer than the hull
    const b = firstGuess(linkedDoc(24000), { linked: camber("cuvature-kink-with-unmodified-pchip") });
    expect(b.ok).toBe(false);
    expect(b.why).toMatch(/^this hull is too heavy to rig by the rules: at 24\.0 t, SA\/D 17 is \d+ m², whose J 4\.64 m and boom 7\.33 m are together longer than her 11\.24 m overall$/);
    expect(b.doc).toBeUndefined();
    console.log(`refusals:\n  ${a.why}\n  ${b.why}`);
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
