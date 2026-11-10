// The validation suite: published boats (src/fixtures/*.json) run through the
// tool's own path (sail plan, synthetic hull, statics table, mass roll-up,
// VPP) and compared with their sources. Every comparison prints ours, the
// source's, the delta and the tolerance, pass or fail, and names the inputs
// marked estimated that feed it. Where the model misses a stated tolerance
// the fixture says so as a `knownGap`: the value measured when the gap was
// recorded and a ratchet around it, so the test fails if the gap moves by
// more than the ratchet either way (better or worse: then re-measure it). A
// figure whose value is one of the doc's own inputs (`roundTrip`) is printed
// apart, as a check of the hull and foil generators, not as validation.

import { describe, it, expect } from "vitest";
import { FIXTURES, fixtureDoc } from "./fixtures/index.js";
import { normalize, STOCK_SLOOP, defaultDoc } from "./doc.js";
import { computeNumbers } from "./numbers.js";
import { buildTable } from "./naval/statics.js";
import { buildDesign } from "./naval/design.js";
import { solvePoint, polar } from "./naval/vpp.js";
import { FT, KNOT } from "./naval/units.js";
import { G } from "./naval/ratios.js";

const byId = Object.fromEntries(FIXTURES.map((f) => [f.id, f.fixture]));
const docOf = (fx, condition) => {
  const d = fixtureDoc(fx);
  const c = condition && fx.published.conditions?.[condition];
  if (c) d.loading = { ...d.loading, displacement: { from: "given", kg: c.displacementKg }, crew: { ...d.loading.crew, ...c.crew } };
  return normalize(d);
};

/** A doc's numbers with its statics table built (as the worker would). */
const memo = new Map();
function numbersOf(fx, condition = null) {
  const key = `${fx.title}|${condition}`;
  if (memo.has(key)) return memo.get(key);
  const doc = docOf(fx, condition);
  const n0 = computeNumbers(doc);
  const table = buildTable(n0.form.mesh, { volumes: [n0.form.float.volumeM3, n0.form.float.volumeM3 - n0.analysis.app.volumeM3] });
  const n = computeNumbers(doc, { statics: { status: "ready", table, source: "mesh" } });
  const out = { doc, n, D: buildDesign({ doc, n }) };
  memo.set(key, out);
  return out;
}
const readout = (n, id) => n.sections.flatMap((s) => s.rows).find((r) => r.id === id)?.value;

/** Ours for a published figure id. */
const OURS = {
  saDesignerFt2: (n) => n.plan.designer.areaM2 / FT ** 2,
  saDesignerM2: (n) => n.plan.designer.areaM2,
  saD: (n) => n.ratios.saDDesigner,
  dL: (n) => n.ratios.dL,
  ballastRatio: (n) => n.ratios.ballast,
  hullSpeedKn: (n) => n.ratios.hullSpeedMs / KNOT,
  draftM: (n) => readout(n, "draftOverall"),
  mainM2: (n) => n.plan.sails.find((s) => s.id === "main").areaM2,
  headsailM2: (n) => n.plan.sails.find((s) => s.id === "jib").areaM2,
  mainTriangleM2: (n) => n.plan.rule.mainM2,
  cp: (n) => n.form.hydro.cp,
  cm: (n) => n.form.hydro.cm,
  bwlM: (n) => n.form.hydro.bwl,
  tcM: (n) => n.form.hydro.tc,
  wettedM2: (n) => n.form.hydro.wsaCanoeM2,
  rm1KgM: (n) => readout(n, "rm1") / G,
  avsDeg: (n) => readout(n, "avs"),
};

const within = (ours, theirs, tol) => (tol.rel != null ? Math.abs(ours / theirs - 1) <= tol.rel : Math.abs(ours - theirs) <= tol.abs);
const tolText = (tol) => (!tol ? "—" : tol.rel != null ? `±${+(tol.rel * 100).toFixed(2)}%` : `±${tol.abs}`);
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toFixed(4));
const estimatedOf = (doc) => Object.keys(doc.prov).filter((k) => doc.prov[k] === "estimated");

describe("the fixtures themselves", () => {
  it("cite their sources: what, where, when, and whether it was really fetched", () => {
    for (const { id, fixture: fx } of FIXTURES) {
      expect(fx.sources.length, id).toBeGreaterThan(0);
      const ids = new Set(fx.sources.map((s) => s.id));
      for (const s of fx.sources) {
        expect(typeof s.what, `${id} ${s.id}`).toBe("string");
        expect(s.url || s.cite, `${id} ${s.id}`).toBeTruthy();
        expect(s.retrieved, `${id} ${s.id}`).toMatch(/^2026-11-\d\d$/);
        expect(typeof s.fetched, `${id} ${s.id}`).toBe("boolean");
        if (!s.fetched) expect(s.note, `${id} ${s.id}: say why it wasn't fetched`).toBeTruthy();
      }
      for (const f of fx.published.figures) {
        expect(ids.has(f.source), `${id} ${f.id} cites ${f.source}`).toBe(true);
        if (f.assert !== false) expect(f.tol, `${id} ${f.id} states a tolerance`).toBeTruthy();
        if (f.knownGap) expect(Number.isFinite(f.knownGap.measured) && f.knownGap.ratchet && f.knownGap.why, `${id} ${f.id}: a known gap records what was measured, its ratchet and why`).toBeTruthy();
      }
      for (const d of fx.published.disagreements ?? []) expect(d.values.length, `${id} ${d.what}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("load as docs: normalize keeps every given field, and the estimated marks are only on fields that exist", () => {
    for (const { id, fixture: fx } of FIXTURES) {
      const d = normalize(fixtureDoc(fx));
      expect(d.title, id).toBe(fx.title);
      expect(normalize(d), id).toEqual(d);
      expect(JSON.stringify(d)).not.toMatch(/undefined/);
      for (const k of Object.keys(d.prov)) {
        const v = k.split(".").reduce((o, p) => o?.[p], d);
        expect(v, `${id}: prov ${k} names a field`).not.toBeUndefined();
      }
      for (const [k, v] of Object.entries(fx.hull.dims)) if (v != null) expect(d.hull.dims[k], `${id} ${k}`).toBe(v);
    }
  });

  it("the stock sloop's fixture is STOCK_SLOOP, so the copy can't drift", () => {
    expect(normalize(fixtureDoc(byId["sloop-12m"]))).toEqual({ ...defaultDoc(), sources: normalize(fixtureDoc(byId["sloop-12m"])).sources });
    expect(fixtureDoc(byId["sloop-12m"]).rig).toEqual(JSON.parse(JSON.stringify(STOCK_SLOOP.rig)));
  });
});

for (const { id, label, fixture: fx } of FIXTURES)
  describe(`${label} against its published figures`, () => {
    it("figures", () => {
      const lines = [];
      const trips = [];
      const fails = [];
      for (const f of fx.published.figures) {
        const { doc, n } = numbersOf(fx, f.condition ?? null);
        const ours = OURS[f.id](n);
        const est = estimatedOf(doc);
        const ok = f.tol ? within(ours, f.value, f.tol) : null;
        // a ratchet: within ±ratchet of what was measured when the gap was recorded
        const gap = f.knownGap && !ok ? within(ours, f.knownGap.measured, f.knownGap.ratchet) : null;
        const d = ours - f.value;
        const verdict = f.assert === false ? "printed only" : ok ? "ok" : gap ? `KNOWN GAP (ratchet: within ${tolText(f.knownGap.ratchet)} of ${fmt(f.knownGap.measured)} measured ${f.knownGap.measuredOn})` : f.knownGap ? `FAIL: the known gap moved past its ratchet (${tolText(f.knownGap.ratchet)} of ${fmt(f.knownGap.measured)}); re-measure it` : "FAIL";
        (f.roundTrip ? trips : lines).push(
          `  ${f.label.padEnd(58)} ours ${fmt(ours).padStart(9)}  ${f.roundTrip ? "input " : "source"} ${fmt(f.value).padStart(9)} ${f.unit.padEnd(5)} Δ ${fmt(d).padStart(8)} (${((100 * d) / f.value).toFixed(2)}%)  tol ${tolText(f.tol)}  ${verdict}  [${f.source}]` +
            (f.roundTrip ? `\n      round trip: ${f.roundTrip}` : "") +
            (f.knownGap && !ok ? `\n      why: ${f.knownGap.why}${f.knownGap.toClose ? `\n      to close it: ${f.knownGap.toClose}` : ""}` : "") +
            (f.estimatedInputs || (!ok && est.length) ? `\n      inputs marked estimated: ${est.join(", ") || "none"}` : ""),
        );
        if (f.id === "wettedM2") {
          const foils = n.analysis.app.foils.reduce((s, x) => s + 2 * x.areaM2, 0);
          lines.push(`      with the keel and rudder (2 × planform): ${fmt(ours + foils)} m² (${((100 * (ours + foils - f.value)) / f.value).toFixed(1)}%)`);
        }
        if (f.assert !== false && !ok && !gap) fails.push(f.id);
      }
      console.log(
        `\n${label}: published figures (${fx.sources.map((s) => `${s.id}${s.fetched ? "" : " [not fetched]"}`).join(", ")})\n${lines.join("\n")}` +
          (trips.length ? `\n  Round trips of the doc's own inputs (the generators, not validation):\n${trips.join("\n")}` : ""),
      );
      expect(fails, `outside tolerance: ${fails.join(", ")}`).toEqual([]);
    });

    if (fx.published.disagreements?.length)
      it("records where its sources disagree", () => {
        console.log(`\n${label}: source disagreements\n${fx.published.disagreements.map((d) => `  ${d.what}: ${d.values.map((v) => `${v.value} [${v.source}${v.verified === false ? ", unverified" : ""}]`).join(" vs ")}; used ${d.used}${d.effect ? `; ${d.effect}` : ""}`).join("\n")}`);
        expect(fx.published.disagreements.every((d) => d.used)).toBe(true);
      });
  });

describe("polars against published targets", () => {
  it("J/24 against its ORC one-design certificate: ±8% at 52–90° and beat VMG, 8–16 kn", () => {
    const fx = byId.j24;
    const P = fx.published.polar;
    const { D, doc } = numbersOf(fx, P.condition);
    expect(D.ok).toBe(true);
    const tws = P.compare.twsKn.map((k) => k * KNOT);
    const res = polar(D, { tws, twa: [...P.compare.twaDeg, 110, 135, 150] });
    const lines = [];
    const fails = [];
    for (const p of res.points) {
      const kn = Math.round(p.tws / KNOT);
      const t = P.rows[String(p.twa)]?.[P.twsKn.indexOf(kn)];
      const v = p.V / KNOT;
      const compared = P.compare.twaDeg.includes(p.twa);
      const ok = within(v, t, P.tol);
      if (compared && !ok) fails.push(`${kn} kn ${p.twa}°`);
      lines.push(`  ${String(kn).padStart(2)} kn ${String(p.twa).padStart(3)}°: ours ${v.toFixed(2)}  ORC ${t.toFixed(2)}  Δ ${(100 * (v / t - 1)).toFixed(1).padStart(6)}%  ${compared ? (ok ? "ok" : "FAIL") : "printed only (ORC with spinnaker)"}  heel ${p.heel.toFixed(1)}°`);
    }
    res.beat.forEach((b, i) => {
      const kn = P.compare.twsKn[i];
      const j = P.twsKn.indexOf(kn);
      const v = b.vmg / KNOT;
      const ok = within(v, P.rows.beatVmg[j], P.tol);
      if (!ok) fails.push(`beat VMG ${kn} kn`);
      const dA = b.twa - P.rows.beatAngle[j];
      const kg = P.knownGaps.beatAngle;
      const m = kg.measuredDeltaDeg[String(kn)];
      const held = Math.abs(dA - m) <= kg.ratchetDeg;
      lines.push(`  ${String(kn).padStart(2)} kn beat VMG: ours ${v.toFixed(2)} at ${b.twa.toFixed(1)}°  ORC ${P.rows.beatVmg[j].toFixed(2)} at ${P.rows.beatAngle[j]}°  Δ ${(100 * (v / P.rows.beatVmg[j] - 1)).toFixed(1)}% ${ok ? "ok" : "FAIL"}; angle Δ ${dA.toFixed(1)}° (KNOWN GAP, ratchet: within ±${kg.ratchetDeg}° of the ${m.toFixed(1)}° measured ${kg.measuredOn}${held ? "" : ": MOVED, re-measure"})`);
      expect(held, `beat angle Δ at ${kn} kn moved from ${m}° to ${dA.toFixed(1)}°`).toBe(true);
    });
    console.log(`\nJ/24 polar vs ORC (${P.source}; ${fx.published.conditions.orc.what}). Estimated: ${estimatedOf(doc).join(", ")}\n${lines.join("\n")}`);
    expect(fails).toEqual([]);
  }, 60_000);

  it("Catalina 30 beat VMG against the J/24's ORC beat slowed by the PHRF difference: ±15% (a weak target), 16 kn a ratcheted known gap", () => {
    const fx = byId["catalina-30"];
    const P = fx.published.polar;
    const j = byId.j24.published.polar;
    const { D, doc } = numbersOf(fx);
    const knots = [8, 12, 16];
    const res = polar(D, { tws: knots.map((k) => k * KNOT), twa: [90] });
    const dPhrf = P.phrfSecPerMile - P.referencePhrfSecPerMile;
    const lines = [];
    const fails = [];
    res.beat.forEach((b, i) => {
      const kn = knots[i];
      const vj = j.rows.beatVmg[j.twsKn.indexOf(kn)];
      const target = 3600 / (3600 / vj + dPhrf);
      const v = b.vmg / KNOT;
      const ok = within(v, target, P.tol);
      // 16 kn: a known gap (she points too high, as the J/24 does against ORC), held by a ratchet on the measured miss
      const kg = kn === 16 ? P.knownGaps.beatVmg16 : null;
      const known = kg && !ok && Math.abs(v / target - 1 - kg.measuredRel) <= kg.ratchetRel;
      if (!ok && !known) fails.push(`${kn} kn`);
      lines.push(`  ${kn} kn: ours ${v.toFixed(2)} kn at ${b.twa.toFixed(1)}°  target ${target.toFixed(2)} (J/24 ORC ${vj} + ${dPhrf} s/mile)  Δ ${(100 * (v / target - 1)).toFixed(1)}%  ${ok ? "ok" : known ? `KNOWN GAP (ratchet: within ±${100 * kg.ratchetRel} points of the +${(100 * kg.measuredRel).toFixed(1)}% measured ${kg.measuredOn})` : "FAIL"}`);
    });
    console.log(`\nCatalina 30 beat VMG, PHRF-relative (${P.note})\nEstimated: ${estimatedOf(doc).join(", ")}\n${lines.join("\n")}`);
    expect(fails).toEqual([]);
  }, 60_000);

  it("Laser against Day (2017)'s VPP at 9 kn true: ±15% upwind and down; planes on a reach at 16 kn, at a speed near an estimated target", () => {
    const fx = byId["laser-ilca7"];
    const P = fx.published.polar;
    const { D, doc } = numbersOf(fx);
    const lines = [];
    const fails = [];
    for (const part of [P.upwind, P.downwind])
      part.twaDeg.forEach((a, i) => {
        const p = solvePoint(D, { tws: P.twsKn * KNOT, twa: a });
        const v = p.V / KNOT;
        const t = part.speedKn[i];
        const ok = within(v, t, P.tol);
        if (!ok) fails.push(`${a}°`);
        lines.push(`  ${String(a).padStart(3)}°: ours ${v.toFixed(2)}  Day ${t.toFixed(2)}  Δ ${(100 * (v / t - 1)).toFixed(1).padStart(5)}%  ${ok ? "ok" : "FAIL"}  heel ${p.heel.toFixed(1)}°, ${p.regime}`);
      });
    const pl = fx.published.planing;
    const reach = solvePoint(D, { tws: pl.twsKn * KNOT, twa: pl.twaDeg });
    const vr = reach.V / KNOT;
    const reachOk = within(vr, pl.speedKn, pl.speedTol);
    lines.push(
      `  ${pl.twsKn} kn true at ${pl.twaDeg}°: ours ${vr.toFixed(2)} kn  target ${pl.speedKn.toFixed(2)} kn (ESTIMATED, ±${100 * pl.speedTol.rel}%) Δ ${(100 * (vr / pl.speedKn - 1)).toFixed(1)}%  ${reachOk ? "ok" : "FAIL"}  [${pl.speedSource}]; Fn ${reach.fn.toFixed(2)}, trim ${reach.flags.some((f) => /trim/.test(f.text)) ? "below Savitsky's 2°" : "in range"}, ${reach.regimeText}; flags: ${reach.flags.map((f) => f.text).join(" ") || "none"}\n      ${pl.speedNote}`,
    );
    console.log(`\nLaser vs Day 2017 VPP, 9 kn true, 80 kg (${P.note})\nEstimated: ${estimatedOf(doc).join(", ")}\n${lines.join("\n")}`);
    expect(fails).toEqual([]);
    expect(reach.regime).toBe(pl.expect);
    expect(reachOk, `planing reach ${vr.toFixed(2)} kn against the estimated ${pl.speedKn} kn ±${100 * pl.speedTol.rel}%`).toBe(true);
    expect(reach.flags.map((f) => f.id)).toContain("planing-range");
  }, 60_000);
});

describe("balance on the published rigs", () => {
  it("KNOWN GAP: with their keels' quarter chords estimated near the LCB, the VPP reads lee helm on the Catalina 30 and J/24, and the lead is far above the quoted band", () => {
    // Not a pass/fail on the boats: their keel positions are estimates (no source gives them).
    // It is held here so a change to the balance or the VPP that moves it is seen.
    const lines = [];
    for (const id of ["catalina-30", "j24", "laser-ilca7", "sloop-12m"]) {
      const { n, doc } = numbersOf(byId[id]);
      const k = n.analysis.app.keel;
      const qcFromLcb = (k.qc[0] - n.form.hydro.lcb) / n.form.hydro.lwl;
      lines.push(`  ${doc.title.padEnd(26)} lead ${(100 * n.analysis.balance.lead).toFixed(1).padStart(5)}% (${n.analysis.balance.leadBand.label}); keel qc ${(100 * qcFromLcb).toFixed(1)}% LWL ${qcFromLcb >= 0 ? "forward of" : "aft of"} the LCB; ${n.helm.text}`);
      expect(n.helm.id, id).not.toBe("cannot");
    }
    console.log(`\nBalance at 12 kn true, 45°, on the fixtures:\n${lines.join("\n")}`);
  }, 60_000);
});
