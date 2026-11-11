// The real boats as a fleet: what the balance model reads on every boat that
// exists (src/fixtures REAL_BOATS), next to where her mast and keel really
// are, and what the larger sample says about the lead band and the three
// CLRs. Also the polars of the boats added on 2026-11-10 against their ORC
// certificates or designer's VPP, and the PHRF order.
//
// Nothing here recalibrates anything. The model disagrees with the boats in
// several places; each disagreement is PINNED: the reading measured when it
// was recorded, held by a ratchet either way, with the disagreement stated
// beside it. A pin that moves means the model or a fixture changed:
// re-measure (NAVAL_PRINT_PINS=1 npx vitest run src/validation-fleet.test.js
// prints the tables to paste) and say why.
//
// The reconciliation's premise, stated once: a production or class boat as
// built is balanced, so a lead rule that is right reads every one of them
// inside its band. How far each rule is from that is its residual.

import { describe, it, expect } from "vitest";
import { FIXTURES, REAL_BOATS, fixtureDoc } from "./fixtures/index.js";
import { normalize } from "./doc.js";
import { computeNumbers } from "./numbers.js";
import { buildTable } from "./naval/statics.js";
import { buildDesign } from "./naval/design.js";
import { polar } from "./naval/vpp.js";
import { firstGuess } from "./firstguess.js";
import { LEAD_BANDS, keelFamily } from "./naval/balance.js";
import { KNOT } from "./naval/units.js";

const PRINT = !!process.env.NAVAL_PRINT_PINS;
const MEASURED_ON = "2026-11-10";

/**
 * Where the mast and the keel's leading edge came from, for the three boats
 * whose fixtures predate `published.balance` (their JSON is not touched).
 */
const OLDER = {
  "catalina-30": {
    phrf: { value: 184, source: "phrf-alamo" },
    real: { mastAftOfStem: { status: "given", how: "J 11.50 ft, the tack taken at the stem (estimated)" }, keelLeAftOfStem: { status: "placed", how: "no source: placed with its quarter chord near the LCB" } },
    weight: "none",
    why: "Her keel's position is not from any source: it was placed with its quarter chord over the LCB, the rule the first guess used before the sourced boats replaced it. Her lead says where that rule put a keel, not where Catalina did.",
  },
  j24: {
    phrf: { value: 170, source: "phrf-alamo" },
    real: { mastAftOfStem: { status: "given", how: "ORC's J 2.900 m; the certificate's SFJ is blank, the tack taken at the stem (estimated)" }, keelLeAftOfStem: { status: "placed", how: "no source: placed with its quarter chord near the LCB" } },
    weight: "none",
    why: "As the Catalina 30: the keel was placed, not sourced.",
  },
  "laser-ilca7": {
    phrf: null,
    real: { mastAftOfStem: { status: "estimated", how: "read off ILCA's hull-fittings diagram, 'only a guide' (secondhand)" }, keelLeAftOfStem: { status: "estimated", how: "the same diagram" } },
    weight: "fair",
    why: "A cat rig: no band is quoted for one.",
  },
};

/**
 * PINNED: the model's readings on the real boats, measured 2026-11-10.
 * lead* are % of LWL over the three CLRs (the extended keel's, or for a long
 * keel the canoe body and keel's centroid; the whole profile's centroid; the
 * foils' hydrodynamic centre); helm is the rudder angle at the reference
 * point, + weather; fgMast is where firstGuess (asked for the boat's own rig
 * type) puts the mast, m aft of the stem, or null where it refuses.
 */
const PINNED = {
  "catalina-30": { leadLE: 19.5, leadWhole: 25.5, leadHc: 30.7, helm: -3.5, fgMast: 3.77 },
  "j24": { leadLE: 16.2, leadWhole: 28.1, leadHc: 29.6, helm: -5.3, fgMast: 3.23 },
  "laser-ilca7": { leadLE: -10.1, leadWhole: 7.2, leadHc: 3.2, helm: 1.4, fgMast: 1.31 },
  "j70": { leadLE: 11.5, leadWhole: 21.8, leadHc: 24.8, helm: -2.4, fgMast: 3.1 },
  "farr40": { leadLE: 5.4, leadWhole: 17.3, leadHc: 23.8, helm: -0.9, fgMast: 5.59 },
  "soling": { leadLE: 4.6, leadWhole: 19.2, leadHc: 17.1, helm: -0.3, fgMast: 4 },
  "folkboat": { leadLE: 16.5, leadWhole: 18.8, leadHc: 13.9, helm: 5.2, fgMast: 3.33 },
  "cal40": { leadLE: 10.4, leadWhole: 22.7, leadHc: 21.7, helm: -2.6, fgMast: 5.42 },
  "contessa32": { leadLE: 15.9, leadWhole: 28.4, leadHc: 26.9, helm: -2, fgMast: 4.37 },
  "hr40c": { leadLE: 3.8, leadWhole: 12.7, leadHc: 14.1, helm: 2.1, fgMast: 4.77 },
  "dinghy-470": { leadLE: 0.6, leadWhole: 16.6, leadHc: 11.8, helm: -1.6, fgMast: 1.79 },
};
const RATCHET = { lead: 0.3, helm: 0.5, mast: 0.03 };

const metaOf = (f) => f.fixture.published.balance ?? OLDER[f.id];
const memo = new Map();
function numbersOf(f, condition = null) {
  const key = `${f.id}|${condition}`;
  if (memo.has(key)) return memo.get(key);
  const d = fixtureDoc(f.fixture);
  const c = condition && f.fixture.published.conditions?.[condition];
  if (c) d.loading = { ...d.loading, displacement: { from: "given", kg: c.displacementKg }, crew: { ...d.loading.crew, ...c.crew } };
  const doc = normalize(d);
  const n0 = computeNumbers(doc);
  const table = buildTable(n0.form.mesh, { volumes: [n0.form.float.volumeM3, n0.form.float.volumeM3 - n0.analysis.app.volumeM3] });
  const n = computeNumbers(doc, { statics: { status: "ready", table, source: "mesh" } });
  const out = { doc, n, D: buildDesign({ doc, n }) };
  memo.set(key, out);
  return out;
}

const bandOf = (doc) => {
  const fam = keelFamily(doc.appendages.keel.kind);
  return (fam && LEAD_BANDS[fam][doc.rig.type]) || null;
};
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** One boat's balance readings. */
function readingOf(f) {
  const { doc, n } = numbersOf(f);
  const b = n.analysis.balance;
  const lwl = n.form.hydro.lwl;
  const stemX = n.analysis.geo.stemX;
  const ce = n.plan.designer.ce;
  const band = bandOf(doc);
  const mid = band ? (band[0] + band[1]) / 2 : null;
  const g = firstGuess(doc, {}, { type: doc.rig.type });
  const keel = n.analysis.app.keel;
  return {
    id: f.id,
    title: doc.title,
    rig: doc.rig.type,
    keelKind: doc.appendages.keel.kind,
    lwl,
    band,
    mid,
    leadLE: 100 * b.lead,
    leadWhole: 100 * b.leadWhole,
    leadHc: b.hc ? (100 * (ce[0] - b.hc[0])) / lwl : NaN,
    clrMethod: /extended/.test(b.clrMethod) ? "extended keel" : "canoe + keel",
    helm: n.reference?.rudder ?? NaN,
    helmText: n.helm?.text ?? "",
    mast: doc.rig.mast.aftOfStem,
    // the lead is affine in the rig's position (slope −1/LWL, firstguess.js): where this rig would sit, over this keel, for the band's middle
    mastForMid: mid == null ? null : doc.rig.mast.aftOfStem + ((100 * b.lead - mid) / 100) * lwl,
    fgMast: g.ok ? g.doc.rig.mast.aftOfStem : null,
    fgWhy: g.ok ? null : g.why,
    fgKeelLe: g.ok ? g.doc.appendages.keel.aftOfStem : null,
    keelLe: doc.appendages.keel.aftOfStem,
    keelQcFromLcb: (100 * (keel.qc[0] - n.form.hydro.lcb)) / lwl,
    wlFwd: stemX - n.form.hydro.xFwd,
  };
}

const pad = (s, w) => String(s).padEnd(w);
const num = (v, w, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—").padStart(w);

describe("balance on every real boat: the model's lead and helm beside the real mast and keel", () => {
  const rows = REAL_BOATS.map(readingOf);

  it("every real boat says where her mast and keel positions came from, and how much her balance reading is worth", () => {
    for (const f of REAL_BOATS) {
      const m = metaOf(f);
      expect(m, `${f.id} has a balance record`).toBeTruthy();
      expect(["good", "fair", "low", "none"], f.id).toContain(m.weight);
      expect(m.why, f.id).toBeTruthy();
      for (const k of ["mastAftOfStem", "keelLeAftOfStem"]) {
        expect(["given", "estimated", "placed"], `${f.id} ${k}`).toContain(m.real[k].status);
        expect(m.real[k].how, `${f.id} ${k}`).toBeTruthy();
        // the doc carries the same number the record quotes
        if (m.real[k].value != null) expect(k === "mastAftOfStem" ? f.fixture.rig.mast.aftOfStem : f.fixture.appendages.keel.aftOfStem, `${f.id} ${k}`).toBe(m.real[k].value);
      }
      if (m.phrf) expect(f.fixture.sources.some((s) => s.id === m.phrf.source), `${f.id} cites its PHRF list`).toBe(true);
    }
  });

  it("PINNED: lead over each of the three CLRs, the helm at the reference point, and the first guess's mast", () => {
    const lines = rows.map((r) => {
      const m = metaOf(REAL_BOATS.find((f) => f.id === r.id));
      const band = r.band ? `${r.band[0]}–${r.band[1]}` : "none";
      const where = r.band ? (r.leadLE < r.band[0] ? "below" : r.leadLE > r.band[1] ? "ABOVE" : "in") : "";
      return (
        `  ${pad(r.title, 26)} ${pad(r.rig, 10)} ${pad(r.keelKind, 11)} band ${pad(band, 6)} lead ${num(r.leadLE, 5)} ${pad(where, 5)} whole ${num(r.leadWhole, 5)}  foils' HC ${num(r.leadHc, 5)}  helm ${num(r.helm, 5)}°` +
        `  mast ${num(r.mast, 5, 2)} (${m.real.mastAftOfStem.status})  for mid-band ${num(r.mastForMid, 5, 2)}  first guess ${num(r.fgMast, 5, 2)}  keel LE ${num(r.keelLe, 5, 2)} (${m.real.keelLeAftOfStem.status}; first guess ${num(r.fgKeelLe, 5, 2)})  weight ${m.weight}`
      );
    });
    console.log(
      `\nBalance on the real boats (lead % of LWL; helm at 12 kn true, 45°, + weather; positions m aft of the stem):\n${lines.join("\n")}\n` +
        rows.filter((r) => r.fgWhy).map((r) => `  first guess refuses ${r.title}: ${r.fgWhy}`).join("\n"),
    );
    const measured = Object.fromEntries(rows.map((r) => [r.id, { leadLE: r1(r.leadLE), leadWhole: r1(r.leadWhole), leadHc: r1(r.leadHc), helm: r1(r.helm), fgMast: r.fgMast == null ? null : r2(r.fgMast) }]));
    if (PRINT) console.log(`\nPINNED = ${JSON.stringify(measured, null, 2)}`);
    for (const r of rows) {
      const p = PINNED[r.id];
      expect(p, `${r.id} is pinned (NAVAL_PRINT_PINS=1 prints the table)`).toBeTruthy();
      for (const k of ["leadLE", "leadWhole", "leadHc"]) expect(Math.abs(r[k] - p[k]), `${r.id} ${k}: ${r[k].toFixed(2)}% against the ${p[k]}% pinned ${MEASURED_ON}`).toBeLessThanOrEqual(RATCHET.lead);
      expect(Math.abs(r.helm - p.helm), `${r.id} helm: ${r.helm.toFixed(2)}° against the ${p.helm}° pinned`).toBeLessThanOrEqual(RATCHET.helm);
      if (p.fgMast == null) expect(r.fgMast, `${r.id}: the first guess was refused when pinned`).toBeNull();
      else expect(Math.abs(r.fgMast - p.fgMast), `${r.id} first-guess mast`).toBeLessThanOrEqual(RATCHET.mast);
    }
  }, 120_000);

  it("the synthetic hull's waterline against the drawings: its forward end is 0.6·(LOA − LWL) aft of the stem, whatever the boat's is", () => {
    // hull.dims has no field for the bow overhang. It doesn't enter the extended-keel lead (CE and CLR are both
    // measured from the stem), but it moves the canoe body under the rig: the whole-profile CLR, the LCB and the helm.
    const lines = [];
    for (const f of REAL_BOATS) {
      const w = f.fixture.published.balance?.real.wlFwdAftOfStem;
      if (!w || w.value == null) continue;
      const r = rows.find((x) => x.id === f.id);
      lines.push(`  ${pad(r.title, 26)} model ${r.wlFwd.toFixed(2)} m  drawing ${w.value.toFixed(2)} m (${w.status})  Δ ${(r.wlFwd - w.value).toFixed(2)} m = ${((100 * (r.wlFwd - w.value)) / r.lwl).toFixed(1)}% of LWL`);
      expect(r.wlFwd).toBeCloseTo(0.6 * (f.fixture.hull.dims.loa - f.fixture.hull.dims.lwl), 2);
    }
    console.log(`\nWaterline's forward end aft of the stem, synthetic hull against the drawings:\n${lines.join("\n")}`);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it("what would reconcile the lead rule with the boats: the residuals of each single change, on the boats whose keels are sourced", () => {
    // Evidence: boats with a quoted band whose keel position came from a source. The Catalina 30 and the J/24 are
    // out (their keels were placed by rule), and so are the cat and the dinghies (no band, or a band nobody quoted for them).
    const evid = rows.filter((r) => r.band && ["good", "fair", "low"].includes(metaOf(REAL_BOATS.find((f) => f.id === r.id)).weight) && !["centreboard", "daggerboard"].includes(r.keelKind));
    const strong = evid.filter((r) => metaOf(REAL_BOATS.find((f) => f.id === r.id)).weight === "good");
    const stat = (xs) => {
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1));
      return { mean, sd, worst: Math.max(...xs.map((x) => Math.abs(x - mean))), rms: Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length) };
    };
    const options = (set) => {
      const res = (key) => set.map((r) => r[key] - r.mid);
      const out = [];
      for (const [name, key] of [["extended-keel CLR (the band's own)", "leadLE"], ["whole-profile centroid", "leadWhole"], ["foils' hydrodynamic centre", "leadHc"]]) {
        const x = res(key);
        const s = stat(x);
        const half = 2; // every band is ±2 points wide
        out.push({ name, key, asIs: s.rms, inBandAsIs: x.filter((v) => Math.abs(v) <= half).length, shift: s.mean, sd: s.sd, worst: s.worst, inBandShifted: x.filter((v) => Math.abs(v - s.mean) <= half).length, n: x.length, each: x });
      }
      // a band of the lead itself, whatever the rig or keel: one number for every boat
      for (const [name, key] of [["one band for all, extended-keel CLR", "leadLE"], ["one band for all, whole-profile", "leadWhole"], ["one band for all, foils' HC", "leadHc"]]) {
        const x = set.map((r) => r[key]);
        const s = stat(x);
        out.push({ name, key, centre: s.mean, sd: s.sd, worst: s.worst, inBandShifted: x.filter((v) => Math.abs(v - s.mean) <= 2).length, n: x.length, each: x });
      }
      return out;
    };
    const show = (title, set) => {
      const o = options(set);
      const head = `  ${pad("", 40)} ${set.map((r) => pad(r.id, 11)).join("")}`;
      const body = o.map((x) =>
        x.centre != null
          ? `  ${pad(x.name, 40)} ${x.each.map((v) => num(v, 6) + "     ").join("")}  centre ${num(x.centre, 5)}%, SD ${num(x.sd, 4)}, worst ${num(x.worst, 4)}; within ±2 of it: ${x.inBandShifted}/${x.n}`
          : `  ${pad(x.name, 40)} ${x.each.map((v) => num(v, 6) + "     ").join("")}  as is: RMS ${num(x.asIs, 4)}, in band ${x.inBandAsIs}/${x.n}; best single shift of every band ${x.shift >= 0 ? "+" : ""}${x.shift.toFixed(1)} points leaves SD ${num(x.sd, 4)}, worst ${num(x.worst, 4)}, in band ${x.inBandShifted}/${x.n}`,
      );
      console.log(`\n${title} (lead − its band's middle, points of LWL; then the lead itself):\n${head}\n${body.join("\n")}`);
      return o;
    };
    const all = show(`Reconciliation on the ${evid.length} boats with a band and a sourced keel`, evid);
    const good = show(`The same on the ${strong.length} whose balance reading is weighted "good"`, strong);
    // what is held: the sample, and that the model's lead on real boats is not in the quoted bands (the disagreement itself)
    expect(evid.map((r) => r.id)).toEqual(["j70", "farr40", "soling", "folkboat", "cal40", "contessa32", "hr40c"]);
    expect(strong.map((r) => r.id)).toEqual(["j70", "farr40", "soling", "folkboat", "cal40"]);
    if (PRINT) console.log(`\nRECON = ${JSON.stringify({ all: all.map((x) => ({ name: x.name, asIs: x.asIs && r2(x.asIs), inBandAsIs: x.inBandAsIs, shift: x.shift != null ? r2(x.shift) : undefined, centre: x.centre != null ? r2(x.centre) : undefined, sd: r2(x.sd), worst: r2(x.worst), inBandShifted: x.inBandShifted })), good: good.map((x) => ({ name: x.name, shift: x.shift != null ? r2(x.shift) : undefined, centre: x.centre != null ? r2(x.centre) : undefined, sd: r2(x.sd), worst: r2(x.worst), inBandShifted: x.inBandShifted })) }, null, 1)}`);
    for (const x of all) expect(Number.isFinite(x.sd)).toBe(true);
  }, 120_000);
});

describe("polars of the 2026-11-10 boats against their ORC certificate or designer's VPP", () => {
  const withPolar = FIXTURES.filter((f) => f.id !== "j24" && ["orc", "designer-vpp"].includes(f.fixture.published.polar?.kind)); // the J/24's is in validation.test.js
  it("there are four", () => expect(withPolar.map((f) => f.id)).toEqual(["j70", "farr40", "soling", "hr40c"]));

  for (const f of withPolar)
    it(`${f.label}: beat VMG and reaching speeds at 8, 12, 16 kn, each PINNED where the model stands against ${f.fixture.published.polar.kind === "orc" ? "ORC" : "the designer's VPP"}`, () => {
      const P = f.fixture.published.polar;
      const { D } = numbersOf(f, P.condition);
      expect(D.ok).toBe(true);
      const res = polar(D, { tws: P.compare.twsKn.map((k) => k * KNOT), twa: P.compare.twaDeg });
      const cells = {};
      const lines = [];
      let inTol = 0, count = 0;
      const cell = (key, ours, theirs, unit, isAngle) => {
        const d = isAngle ? ours - theirs : 100 * (ours / theirs - 1);
        cells[key] = r1(d);
        const pin = P.pinned?.cells?.[key];
        const ok = isAngle ? null : Math.abs(d) <= 100 * P.tol.rel;
        if (!isAngle) (count++, ok && inTol++);
        const held = pin != null && Math.abs(d - pin) <= (isAngle ? P.pinned.ratchetDeg : P.pinned.ratchetPoints);
        lines.push(`  ${pad(key, 14)} ours ${ours.toFixed(2)}  theirs ${theirs.toFixed(2)} ${unit}  Δ ${d >= 0 ? "+" : ""}${d.toFixed(1)}${isAngle ? "°" : "%"}  ${isAngle ? "" : ok ? `within ±${100 * P.tol.rel}%` : `OUTSIDE ±${100 * P.tol.rel}%`}  pinned ${pin ?? "—"}${held ? "" : "  MOVED"}`);
        if (!PRINT) expect(held, `${f.id} ${key}: Δ ${d.toFixed(1)} against the ${pin} pinned ${P.pinned?.measuredOn}`).toBe(true);
      };
      for (const p of res.points) {
        const kn = Math.round(p.tws / KNOT);
        cell(`${kn}kn ${p.twa}°`, p.V / KNOT, P.rows[String(p.twa)][P.twsKn.indexOf(kn)], "kn", false);
      }
      res.beat.forEach((b, i) => {
        const kn = P.compare.twsKn[i];
        const j = P.twsKn.indexOf(kn);
        cell(`${kn}kn beatVMG`, b.vmg / KNOT, P.rows.beatVmg[j], "kn", false);
        cell(`${kn}kn beatAngle`, b.twa, P.rows.beatAngle[j], "°", true);
      });
      console.log(`\n${f.label} polar (${P.source}; ${f.fixture.published.conditions[P.condition].what}): ${inTol}/${count} speeds within ±${100 * P.tol.rel}%\n${lines.join("\n")}\n  ${P.note}${P.pinned?.why ? `\n  why: ${P.pinned.why}` : ""}`);
      if (PRINT) console.log(`\nPOLARPIN ${f.id} = ${JSON.stringify(cells)}`);
    }, 120_000);
});

describe("PHRF order: the model's beat against the handicaps (ordinal only)", () => {
  it("PINNED: the model's order of the eight boats with a PHRF number, beside PHRF's", () => {
    // PHRF is seconds per mile of handicap from committees' observation, on three different lists here,
    // with spinnakers the VPP doesn't have. Only the order means anything, and only roughly.
    const boats = REAL_BOATS.filter((f) => metaOf(f).phrf).map((f) => {
      const { D } = numbersOf(f);
      const res = polar(D, { tws: [12 * KNOT], twa: [90] });
      const vmg = res.beat[0].vmg / KNOT;
      const reach = res.points[0].V / KNOT;
      // seconds per mile on a mile to windward and a mile on a beam reach
      return { id: f.id, title: fixtureDoc(f.fixture).title, phrf: metaOf(f).phrf, vmg, reach, secPerMile: (3600 / vmg + 3600 / reach) / 2 };
    });
    const byPhrf = [...boats].sort((a, b) => a.phrf.value - b.phrf.value);
    const byModel = [...boats].sort((a, b) => a.secPerMile - b.secPerMile);
    const rank = (list) => Object.fromEntries(list.map((b, i) => [b.id, i + 1]));
    const rp = rank(byPhrf), rm = rank(byModel);
    const nB = boats.length;
    const rho = 1 - (6 * boats.reduce((s, b) => s + (rp[b.id] - rm[b.id]) ** 2, 0)) / (nB * (nB * nB - 1));
    console.log(
      `\nPHRF order against the model's (12 kn true: beat VMG, beam-reach speed, their mean seconds per mile):\n` +
        byPhrf.map((b) => `  ${pad(b.title, 22)} PHRF ${String(b.phrf.value).padStart(3)} [${pad(b.phrf.source, 11)}] rank ${rp[b.id]}   model: beat VMG ${b.vmg.toFixed(2)} kn, reach ${b.reach.toFixed(2)} kn, ${b.secPerMile.toFixed(0)} s/mile, rank ${rm[b.id]}`).join("\n") +
        `\n  Spearman's ρ ${rho.toFixed(2)} over ${nB} boats. Model order: ${byModel.map((b) => b.id).join(" < ")}`,
    );
    if (PRINT) console.log(`\nPHRFPIN = ${JSON.stringify(byModel.map((b) => b.id))}`);
    expect(byPhrf.map((b) => b.id)).toEqual(["farr40", "j70", "cal40", "soling", "j24", "catalina-30", "contessa32", "folkboat"]);
    expect(byModel.map((b) => b.id)).toEqual(PHRF_MODEL_ORDER);
    expect(rho).toBeGreaterThan(0.7);
  }, 120_000);
});

/** PINNED 2026-11-10: the model's order, fastest first (see the test above). */
const PHRF_MODEL_ORDER = ["farr40", "j70", "cal40", "soling", "catalina-30", "j24", "contessa32", "folkboat"];
