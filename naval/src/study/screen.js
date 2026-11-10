// Screening one subject: every figure the study shows, as Figures. Pure and
// synchronous (a table from a mesh is ~0.6 s, the polar ~0.3 s), so it runs
// in the package's worker (statics-job.js, job type "screen") and directly
// in tests. It reuses the rig aid's own pipeline (computeNumbers, staticsFor,
// the VPP), so a subject with a design reads exactly what the Rig tool shows
// for that design on that hull.
//
// A subject is a hull, a design, or both:
// - hull only: the hull floated at its design waterline (real size: the
//   linked mesh is the hull's own doc built with default params), its
//   particulars, KMt (the limiting KG for GMt > 0), KN, and its bare-hull
//   upright R(V).
// - with a design: the same on the design's displacement, plus draft, SA/D,
//   ballast ratio, GM and the GZ curve's readings, the balance (lead), and
//   the VPP's reference point and VMGs.
// A design with no linked hull stands on its synthetic hull (from its
// principal dimensions): those figures are "estimated".
//
// Every figure is a pure function of (the docs at their heads,
// METHOD_VERSION); nothing derived is stored anywhere.

import { normalize, isEstimated } from "../doc.js";
import { computeNumbers } from "../numbers.js";
import { staticsFor } from "../rig-build.js";
import { rigToTable } from "../naval/hull-form.js";
import { rightingAt } from "../naval/statics.js";
import { polar as runPolar, resistanceOf } from "../naval/vpp.js";
import { dsyhsHull, dsyhsParams, resistanceModel, planingCapability, DSYHS_ENVELOPE, DSYHS_RESIDUARY_SOURCE, SAVITSKY_SOURCE, PLANING_FN } from "../naval/resistance.js";
import { deadriseOf } from "../naval/design.js";
import { dL as dLOf, G as GRAV } from "../naval/ratios.js";
import { LE_SOURCE } from "../naval/balance.js";
import { RHO_SEA, formatText } from "../naval/units.js";
import { DEFAULT_FRAME } from "../naval/hull-frame.js";
import { figure, gradeParams, combineProvenance, worstEnvelope } from "./figures.js";

/** Bump when the same docs would screen to different figures. */
export const METHOD_VERSION = 1;

/** The Froude numbers the resistance figures are read at. */
export const RESIST_FN = [0.25, 0.35, 0.45];
/** The heels KN is read at. */
export const KN_HEELS = [30, 60, 90];
/** The DSYHS residuary table's Froude range (Keuning & Katgert 2008, Table 2). */
export const DSYHS_FN = { min: 0.15, max: 0.75 };

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const CITE = {
  mesh: "naval/src/naval/mesh-hydro.js uprightHydrostatics: the immersed mesh integrated exactly (Chartroom hydrostatic-table v1 definitions)",
  synthetic: "naval/src/naval/synthetic-hull.js: a hull fitted to the principal dimensions (Cp, Cm, LCB fitted; shape assumed)",
  ratios: "naval/src/naval/ratios.js; Larsson, Eliasson & Orych, Principles of Yacht Design (5th ed.), ch. 3",
  kmt: "KMt = KB + I_T/∇ at the waterline floated; GMt = KMt − KG > 0 is the upright limit on KG (as camber's stability.ts limitingKgCurve)",
  stability: "naval/src/naval/stability.js stabilityCurve over the hull's hydrostatic table, with the design's mass roll-up; readings as camber's (naval/src/naval/statics.js curveReadouts)",
  vpp: "naval/src/naval/vpp.js: a static VPP (sails after ORC 2026 coefficients, DSYHS hull, Clarke hull side force, lifting-line foils)",
};

/** A numbers row's provenance, in the study's three words. */
export function provFromRow(p) {
  if (p === "mesh") return "measured";
  if (p === "given" || p === "derived") return "given";
  return "estimated";
}

/**
 * The bare doc a hull-only subject is screened through: the hull linked in
 * its frame, floated at its design waterline. The rig and foils it carries
 * (normalize's stock sloop) are never read for a hull-only subject.
 */
export function bareDoc(frame = DEFAULT_FRAME, title = "hull") {
  return normalize({ title, hull: { link: { url: "automerge:subjecthull", frame } }, loading: { displacement: { from: "hull", kg: null } }, appendages: { keel: { kind: "none" } } });
}

/**
 * Screen a subject.
 * @param {{ doc?: object|null, linked?: { status: "ready", mesh: object, chip?: string, tableSource?: string }|null, frame?: object, title?: string, hullOnly?: boolean }} job
 *   doc: the design (a rig-design doc) or null for a hull-only subject; linked: the hull's mesh (and its own table, mesh.table)
 * @returns {{ ok: boolean, methodVersion: number, kind: "hull"|"design", figures: Record<string, object>, warnings: string[], why?: string }}
 */
export function screenSubject(job) {
  const hullOnly = !job.doc;
  const d = hullOnly ? bareDoc(job.frame, job.title) : normalize(job.doc);
  const linked = d.hull.link ? (job.linked ?? null) : null;
  if (d.hull.link && !linked) return fail(hullOnly ? "hull" : "design", "the hull hasn't been read");
  const n0 = computeNumbers(d, { linked });
  const form = n0.form;
  const warnings = n0.warnings.map((w) => formatText(w, "metric"));
  if (!form) return { ...fail(hullOnly ? "hull" : "design", warnings.find((w) => /hull/i.test(w)) ?? "no hull could be floated"), warnings };
  const statics = staticsFor(d, linked, form);
  const tableFrom = statics.source === "chartroom" ? `the hull's own Chartroom table${job.linked?.tableSource ? ` (${job.linked.tableSource})` : ""}` : "a Chartroom table built from the hull mesh (naval/src/naval/statics.js buildTable)";
  const n = computeNumbers(d, { linked, statics: { status: "ready", table: statics.table, source: statics.source } });
  const figures = {};
  const put = (id, f) => (figures[id] = figure(f));
  const h = form.hydro;
  const synthetic = form.kind === "synthetic";
  const shape = synthetic
    ? { method: "Upright hydrostatics of the synthetic hull", cite: CITE.synthetic, provenance: "estimated" }
    : { method: "Upright hydrostatics of the floated mesh", cite: CITE.mesh, provenance: "measured" };
  // a dimension the doc states (synthetic hull): its own provenance; read off a mesh: measured
  const dimProv = (k) => (synthetic ? (isEstimated(d, ["hull", "dims", k]) ? "estimated" : "given") : "measured");
  const given = form.float.from === "given";
  const dispProv = given ? (isEstimated(d, ["loading", "displacement", "kg"]) ? "estimated" : "given") : synthetic ? dimProv("displacementKg") : "measured";
  const floated = given ? "floated at the stated displacement" : synthetic ? "at the stated displacement" : "floated at its design waterline";

  // ── particulars
  const mid = (h.xAft + h.xFwd) / 2;
  put("loa", { value: form.loa, unit: "length", ...shape, method: "Length overall, the hull's drawn extent", provenance: synthetic ? dimProv("loa") : "measured" });
  put("lwl", { value: h.lwl, unit: "length", ...shape, method: `Waterline length, ${floated}`, provenance: synthetic ? dimProv("lwl") : combineProvenance("measured", dispProv) });
  put("bwl", { value: h.bwl, unit: "length", ...shape, method: `Waterline beam, ${floated}`, provenance: synthetic ? dimProv("bwl") : combineProvenance("measured", dispProv) });
  put("tc", { value: h.tc, unit: "length", ...shape, method: `Canoe-body draft Tc, ${floated}`, provenance: synthetic ? dimProv("tc") : combineProvenance("measured", dispProv) });
  put("volume", { value: form.float.volumeM3, unit: "volume", ...shape, method: `Displaced volume ∇, ${floated} (ρ ${RHO_SEA} kg/m³)`, provenance: dispProv });
  put("displacement", { value: form.float.massKg, unit: "mass", ...shape, method: `Displacement Δ, ${floated} (ρ ${RHO_SEA} kg/m³)`, provenance: dispProv });
  const hp = combineProvenance(shape.provenance, dispProv);
  put("wsa", { value: h.wsaCanoeM2, unit: "area", ...shape, method: "Wetted surface of the canoe body (the immersed transom left out)", provenance: hp });
  put("aw", { value: h.awM2, unit: "area", ...shape, method: "Waterplane area Aw", provenance: hp });
  put("lcb", { value: (h.lcb - mid) / h.lwl, unit: "percent", ...shape, method: "LCB, % of LWL from mid-LWL (+ forward)", provenance: hp });
  put("lcf", { value: fin(h.lcf) ? (h.lcf - mid) / h.lwl : null, unit: "percent", ...shape, method: "LCF, % of LWL from mid-LWL (+ forward)", provenance: hp, why: "no waterplane centroid" });
  put("cb", { value: h.cb, unit: "ratio", ...shape, method: "Block coefficient Cb = ∇/(LWL·BWL·Tc)", provenance: hp, why: "not computed" });
  put("cp", { value: h.cp, unit: "ratio", ...shape, method: "Prismatic coefficient Cp = ∇/(Ax·LWL), Ax the largest section", provenance: hp, why: "not computed" });
  put("cm", { value: h.cm, unit: "ratio", ...shape, method: "Midship coefficient Cm = Ax/(BWL·Tc)", provenance: hp, why: "not computed" });
  put("cw", { value: h.cw, unit: "ratio", ...shape, method: "Waterplane coefficient Cw = Aw/(LWL·BWL)", provenance: hp, why: "not computed" });
  put("halfEntrance", { value: h.halfEntranceDeg, unit: "angle", ...shape, method: "Half angle of entrance, at 10% of LWL from the bow", provenance: hp, why: "no section there" });
  put("dL", { value: dLOf(form.float.massKg, h.lwl), unit: "ratio", method: "D/L = Δ (long tons) / (0.01·LWL ft)³", cite: CITE.ratios, provenance: hp });
  put("slenderness", { value: h.lwl / Math.cbrt(form.float.volumeM3), unit: "ratio", method: "Slenderness LWL/∇^⅓", cite: CITE.ratios, provenance: hp });

  // ── stability: KMt (limiting KG), KN off the table
  put("kmt", { value: h.kmt, unit: "length", ...shape, method: `KMt upright, above the hull's lowest point: the limiting KG for GMt > 0 (${floated})`, cite: `${shape.cite}; ${CITE.kmt}`, provenance: hp, why: "no waterplane second moment" });
  const map = rigToTable(statics.table, form);
  for (const heel of KN_HEELS) {
    let value = null, why = null;
    if (!map.available) why = `the table can't be lined up with the floated hull (${map.reason})`;
    else {
      const r = rightingAt(statics.table, { volumeM3: form.float.volumeM3, G: map.map([h.lcb, 0, 0]) }, { heelDeg: heel, trimDeg: map.trimDeg });
      if (r.available) value = r.kn;
      else why = `outside the table's coverage at ${heel}° (${r.reason}): never extrapolated`;
    }
    put(`kn${heel}`, { value, unit: "length", method: `KN at ${heel}°, fixed trim, about the table's K`, cite: tableFrom, provenance: hp, why });
  }

  // ── resistance: upright R at Froude numbers, with the method's envelope
  const res = hullOnly ? bareResistance(form) : n.design.ok ? { model: resistanceOf(n.design), weightN: n.design.massKg * GRAV } : null;
  const hullParams = dsyhsParamsOf(h);
  for (const fn of RESIST_FN) {
    const V = fn * Math.sqrt(GRAV * h.lwl);
    const id = Math.round(fn * 100);
    if (!res) {
      const why = `needs the design's performance model (${n.design.why})`;
      put(`r${id}`, { value: null, unit: "force", method: `Resistance upright at Fn ${fn}`, cite: DSYHS_RESIDUARY_SOURCE, provenance: hp, why });
      put(`rw${id}`, { value: null, unit: "ratio", method: `R/W upright at Fn ${fn}`, cite: DSYHS_RESIDUARY_SOURCE, provenance: hp, why });
      continue;
    }
    const at = res.model.at(V, 0, 0);
    const params = [...hullParams, { label: "Fn (DSYHS table)", value: fn, min: DSYHS_FN.min, max: DSYHS_FN.max }];
    if (at.planingWeight > 0 && at.savitsky) params.push(...savitskyParams(at.savitsky));
    const g = gradeParams(params);
    const method = `${hullOnly ? "Bare hull" : "Hull, keel and rudder"} upright at Fn ${fn} (${(V / 0.514444).toFixed(2)} kn): ITTC-57 friction + DSYHS residuary${at.planingWeight > 0 ? `, blended with Savitsky planing (weight ${at.planingWeight.toFixed(2)})` : ""}`;
    const cite = at.planingWeight > 0 ? `${DSYHS_RESIDUARY_SOURCE} ${SAVITSKY_SOURCE}` : DSYHS_RESIDUARY_SOURCE;
    const prov = hullOnly ? hp : combineProvenance(hp, massProv(n));
    put(`r${id}`, { value: at.total, unit: "force", method, cite, envelope: g.envelope, outOfRange: g.outOfRange, provenance: prov });
    put(`rw${id}`, { value: at.total / res.weightN, unit: "ratio", method: `R/W: ${method}`, cite, envelope: g.envelope, outOfRange: g.outOfRange, provenance: prov });
  }

  if (!hullOnly) designFigures(n, put, { hp, tableFrom, hullParams });
  return { ok: true, methodVersion: METHOD_VERSION, kind: hullOnly ? "hull" : "design", figures, warnings, tableSource: statics.source };
}

function fail(kind, why) {
  return { ok: false, methodVersion: METHOD_VERSION, kind, figures: {}, warnings: [], why };
}

/** DSYHS's eight hull parameters against Keuning & Katgert's Table 1, as gradeParams takes them. */
export function dsyhsParamsOf(h) {
  const p = dsyhsParams(dsyhsHull(h));
  return DSYHS_ENVELOPE.map((e) => ({ label: e.label, value: p[e.id], min: e.min, max: e.max }));
}

/** Savitsky's fitted range (C_V ≥ 1, 2° ≤ τ ≤ 15°, λ ≤ 4), one-sided bounds graded on the bound's own size. */
export function savitskyParams(s) {
  return [
    { label: "Savitsky C_V", value: s.cv, min: 1, max: Infinity, scale: 1 },
    { label: "Savitsky trim τ (°)", value: s.tau, min: 2, max: 15 },
    { label: "Savitsky λ (beams)", value: s.lambda, min: 0, max: 4 },
  ];
}

/** A hull alone: no foils, upright; planes if its D/L lets it, with its LCG over its LCB. */
function bareResistance(form) {
  const h = form.hydro;
  const W = form.float.massKg * GRAV;
  const dl = dLOf(form.float.massKg, h.lwl);
  const dr = deadriseOf(form);
  const model = resistanceModel({
    hull: dsyhsHull(h),
    foils: [],
    draftT: h.tc,
    keelTaper: 0.5,
    planing: { capability: planingCapability(dl), weightN: W, beam: h.bwl, deadriseDeg: dr ? dr.deg : 10, lcg: h.lcb - h.xAft },
  });
  return { model, weightN: W };
}

/** The design's mass roll-up: estimated if any item in it is. */
function massProv(n) {
  const items = n.analysis?.mass?.items ?? [];
  return items.some((i) => i.estimated) ? "estimated" : "given";
}

function rowOf(n, id) {
  for (const s of n.sections) for (const r of s.rows) if (r.id === id) return r;
  return null;
}

function designFigures(n, put, { hp, tableFrom, hullParams }) {
  const a = n.analysis;
  const mp = combineProvenance(hp, massProv(n));
  const D = n.design;
  // particulars only a design has
  put("draft", { value: D.ok ? D.draftT : -(n.hull.draftZ ?? NaN), unit: "length", method: "Draft T, canoe body or the deepest foil", cite: "naval/src/naval/foils.js appendagesOf", provenance: combineProvenance(hp, provFromRow(rowOf(n, "draftOverall")?.prov)), why: "not computed" });
  const saD = rowOf(n, "saD");
  put("saD", { value: n.ratios.saDDesigner, unit: "ratio", method: "SA/D, designer's sail area (main + 100% foretriangle) over ∇^⅔", cite: CITE.ratios, provenance: combineProvenance(hp, provFromRow(saD?.prov)), why: "not computed" });
  const br = rowOf(n, "ballastRatio");
  put("ballastRatio", { value: n.ratios.ballast, unit: "percent", method: "Ballast / displacement", cite: CITE.ratios, provenance: combineProvenance(hp, provFromRow(br?.prov)), why: "no ballast or displacement" });

  // stability with the mass roll-up
  const st = a.stab;
  const r = st?.readouts;
  const noCurve = !a.mass ? "no displacement to float her at" : st ? null : "the table can't be lined up with the floated hull";
  const curve = (id, value, unit, label, whyNull) =>
    put(id, { value: noCurve ? null : value, unit, method: `${label}, the design's loading`, cite: `${CITE.stability}; table: ${tableFrom}`, provenance: mp, why: noCurve ?? whyNull });
  curve("gm", st?.gmTable ?? a.gm?.GM ?? null, "length", "GMt upright from the table", "not computed");
  curve("gzMax", r?.gzMax ?? null, "length", "GZ max", r?.notes?.join("; ") || "not reached");
  curve("heelAtMax", r?.heelAtMaxDeg ?? null, "angle", "Heel at GZ max", r?.notes?.join("; ") || "not reached");
  curve("avs", r?.avsDeg ?? null, "angle", "Angle of vanishing stability", r?.notes?.join("; ") || "not reached");
  curve("area30", r?.area30 ?? null, "lengthRad", "Area under GZ to 30°", "the curve doesn't reach 30°");
  curve("area40", r?.area40 ?? null, "lengthRad", "Area under GZ to 40°", "the curve doesn't reach 40°");
  curve("rm30", st?.rm30 ?? null, "moment", "RM at 30° (crew as set)", "the curve doesn't reach 30°");
  curve("sheerImmersion", r?.sheerImmersionDeg ?? null, "angle", "Heel at which the sheer goes under", r?.notes?.find((x) => /sheer/.test(x)) ?? "no deck-edge markers in the table");

  // balance
  const lead = rowOf(n, "lead");
  put("lead", { value: a.balance.lead, unit: "percent", method: `Lead of the designer's CE over the CLR, % of LWL (${a.balance.clrMethod})`, cite: LE_SOURCE, provenance: combineProvenance(hp, provFromRow(lead?.prov)), why: "no CE or CLR" });

  // the VPP: the reference point and the VMGs at its true wind
  const hullGrade = gradeParams(hullParams);
  const ref = n.reference;
  const pointFig = (id, label, p, value, unit) => {
    if (!D.ok) return put(id, { value: null, unit, method: label, cite: CITE.vpp, provenance: mp, why: D.why });
    const flags = (p?.flags ?? []).filter((f) => f.id !== "dsyhs").map((f) => f.text);
    const env = worstEnvelope(hullGrade.envelope, p?.hollow ? "far" : "inside");
    put(id, {
      value: p?.ok ? value : null,
      unit,
      method: label,
      cite: `${CITE.vpp}; ${DSYHS_RESIDUARY_SOURCE}`,
      envelope: env,
      outOfRange: env === "inside" ? [] : hullGrade.outOfRange,
      provenance: mp,
      why: "no equilibrium at this point",
      note: flags.length ? flags.join("; ") : undefined,
    });
  };
  const c = n.doc.conditions.reference;
  const at = `${(c.tws / 0.514444).toFixed(0)} kn true, ${c.twa}°`;
  pointFig("refSpeed", `Boat speed at ${at} (VPP)`, ref, ref?.speed, "speed");
  pointFig("refHeel", `Heel at ${at} (VPP)`, ref, ref?.heel, "angle");
  pointFig("refHelm", `Rudder angle at ${at}, + weather (VPP)`, ref, ref?.rudder, "angle");
  const pol = D.ok ? runPolar(D, { tws: [c.tws] }) : null;
  pointFig("beatVmg", `Best upwind VMG at ${(c.tws / 0.514444).toFixed(0)} kn true (VPP)`, pol?.beat[0], pol?.beat[0]?.vmg, "speed");
  pointFig("runVmg", `Best downwind VMG at ${(c.tws / 0.514444).toFixed(0)} kn true (VPP)`, pol?.run[0], pol?.run[0] ? -pol.run[0].vmg : null, "speed");
}

export { PLANING_FN };
