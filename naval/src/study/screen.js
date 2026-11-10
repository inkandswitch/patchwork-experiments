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
// Envelopes. A figure is graded only where its method states a fitted
// range: the resistance (DSYHS's hull parameters and Froude range,
// Savitsky's when it planes) and the VPP's points (the same hull
// parameters, and "far" on a flagged point). Everything else (the
// particulars, KMt, KN, the stability curve's readings, the ratios, the
// lead) is "ungraded": geometry and definitions have no fitted range, and
// nothing here checks a mesh's convergence or a table's resolution. The
// lead carries its design band instead, where one is quoted.
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
export const METHOD_VERSION = 3; // 2: a hull with its own Chartroom table takes its upright figures from that table (hull-form.js tableUpright); 3: a figure nothing grades is "ungraded", not "inside", and the lead carries its design band

/** The Froude numbers the resistance figures are read at. */
export const RESIST_FN = [0.25, 0.35, 0.45];
/** The heels KN is read at. */
export const KN_HEELS = [30, 60, 90];
/** The DSYHS residuary table's Froude range (Keuning & Katgert 2008, Table 2). */
export const DSYHS_FN = { min: 0.15, max: 0.75 };

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const CITE = {
  mesh: "naval/src/naval/mesh-hydro.js uprightHydrostatics: the immersed mesh integrated exactly (Chartroom hydrostatic-table v1 definitions)",
  table: "naval/src/naval/hull-form.js tableUpright: the table read at the floated waterplane, upright at its reference trim (Chartroom hydrostatic-table v1 §4, §5)",
  meshUnderTable: "naval/src/naval/mesh-hydro.js uprightHydrostatics: the hull's mesh, cut at the waterplane its hydrostatic table floats it at",
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

  // One statics engine per hull (hull-form.js): a hull floated by its own table reads from it every upright
  // figure it carries, and each figure says where it came from: `part` adds the source to a figure's method
  // and cite. On the mesh engine (and a synthetic hull) it adds nothing.
  const own = h.engine === "chartroom";
  const src = (key) => (own ? h.from[key] : "mesh");
  /** A figure made of others: the mesh's when all of them are, else mixed. */
  const mixOf = (...keys) => (keys.every((k) => src(k) === "mesh") ? "mesh" : "mixed");
  const NO_FIELD = "off the mesh: a hydrostatic table has no field for it";
  const NOT_HERE = "off the mesh: the hull's table doesn't supply it here";
  const NO_REF = "off the mesh at its design waterline: the table states no reference waterplane";
  const pick = (how, k) => (typeof how === "string" ? how : how?.[k]);
  /**
   * @param {string} from "table" | "mesh" | "mixed" | "given"
   * @param {string|{ mesh?: string, mixed?: string }} [how] for "mesh": why the table didn't give it; for "mixed": what is mixed
   */
  const part = (id, from, f, how) => {
    let tag = "", cite = shape.cite;
    if (own && from === "table") [tag, cite] = [` (${tableFrom})`, `${tableFrom}; ${CITE.table}`];
    else if (own && from === "mixed") [tag, cite] = [` (${pick(how, "mixed") ?? "the table's ∇ over the mesh's lengths and sections"})`, `${tableFrom}; ${CITE.table}; ${CITE.meshUnderTable}`];
    else if (own && from === "given") [tag, cite] = ["", `the stated displacement; the waterplane it floats at is ${tableFrom}'s`];
    else if (own) [tag, cite] = [` (${pick(how, "mesh") ?? NOT_HERE})`, CITE.meshUnderTable];
    put(id, { ...shape, ...f, method: `${f.method}${tag}`, cite: f.cite ? `${f.cite}; ${cite}` : cite });
  };

  // ── particulars
  const mid = (h.xAft + h.xFwd) / 2;
  const overLwl = "the table's centre, as a fraction of the mesh's waterline";
  const overMesh = "the table's ∇ over the mesh's lengths and sections";
  const atPlane = "∇ over the mesh's lengths and sections, cut at the table's waterplane";
  const volHow = { mixed: src("volumeM3") === "given" ? atPlane : overMesh, mesh: NO_REF };
  part("loa", "mesh", { value: form.loa, unit: "length", method: "Length overall, the hull's drawn extent", provenance: synthetic ? dimProv("loa") : "measured" }, NO_FIELD);
  part("lwl", src("lwl"), { value: h.lwl, unit: "length", method: `Waterline length, ${floated}`, provenance: synthetic ? dimProv("lwl") : combineProvenance("measured", dispProv) }, NO_FIELD);
  part("bwl", src("bwl"), { value: h.bwl, unit: "length", method: `Waterline beam, ${floated}`, provenance: synthetic ? dimProv("bwl") : combineProvenance("measured", dispProv) }, NO_FIELD);
  part("tc", src("tc"), { value: h.tc, unit: "length", method: `Canoe-body draft Tc, ${floated}`, provenance: synthetic ? dimProv("tc") : combineProvenance("measured", dispProv) }, NO_FIELD);
  part("volume", src("volumeM3"), { value: form.float.volumeM3, unit: "volume", method: `Displaced volume ∇, ${floated} (ρ ${RHO_SEA} kg/m³)`, provenance: dispProv }, NO_REF);
  part("displacement", src("volumeM3"), { value: form.float.massKg, unit: "mass", method: `Displacement Δ, ${floated} (ρ ${RHO_SEA} kg/m³)`, provenance: dispProv }, NO_REF);
  const hp = combineProvenance(shape.provenance, dispProv);
  part("wsa", src("wsaCanoeM2"), { value: h.wsaCanoeM2, unit: "area", method: "Wetted surface of the canoe body (the immersed transom left out)", provenance: hp }, { mixed: "the table's wetted area less the mesh's immersed transom", mesh: "off the mesh: the hull's table states no wetted area" });
  part("aw", src("awM2"), { value: h.awM2, unit: "area", method: "Waterplane area Aw", provenance: hp });
  part("lcb", src("lcb") === "table" ? "mixed" : "mesh", { value: (h.lcb - mid) / h.lwl, unit: "percent", method: "LCB, % of LWL from mid-LWL (+ forward)", provenance: hp }, { mixed: overLwl, mesh: "off the mesh: the table is slid onto the mesh by its LCB (nothing says the two share an origin)" });
  part("lcf", src("lcf") === "table" ? "mixed" : "mesh", { value: fin(h.lcf) ? (h.lcf - mid) / h.lwl : null, unit: "percent", method: "LCF, % of LWL from mid-LWL (+ forward)", provenance: hp, why: "no waterplane centroid" }, { mixed: overLwl });
  part("cb", src("cb"), { value: h.cb, unit: "ratio", method: "Block coefficient Cb = ∇/(LWL·BWL·Tc)", provenance: hp, why: "not computed" }, volHow);
  part("cp", src("cp"), { value: h.cp, unit: "ratio", method: "Prismatic coefficient Cp = ∇/(Ax·LWL), Ax the largest section", provenance: hp, why: "not computed" }, volHow);
  part("cm", src("cm"), { value: h.cm, unit: "ratio", method: "Midship coefficient Cm = Ax/(BWL·Tc)", provenance: hp, why: "not computed" }, NO_FIELD);
  part("cw", src("cw"), { value: h.cw, unit: "ratio", method: "Waterplane coefficient Cw = Aw/(LWL·BWL)", provenance: hp, why: "not computed" }, { mixed: "the table's Aw over the mesh's waterline" });
  part("halfEntrance", src("halfEntranceDeg"), { value: h.halfEntranceDeg, unit: "angle", method: "Half angle of entrance, at 10% of LWL from the bow", provenance: hp, why: "no section there" }, NO_FIELD);
  const ratioFrom = mixOf("volumeM3");
  const ratioHow = { mixed: src("volumeM3") === "given" ? "the stated ∇ over the mesh's LWL, cut at the table's waterplane" : "the table's ∇ over the mesh's LWL", mesh: NO_REF };
  part("dL", ratioFrom, { value: dLOf(form.float.massKg, h.lwl), unit: "ratio", method: "D/L = Δ (long tons) / (0.01·LWL ft)³", cite: CITE.ratios, provenance: hp }, ratioHow);
  part("slenderness", ratioFrom, { value: h.lwl / Math.cbrt(form.float.volumeM3), unit: "ratio", method: "Slenderness LWL/∇^⅓", cite: CITE.ratios, provenance: hp }, ratioHow);

  // ── stability: KMt (limiting KG), KN off the table
  part("kmt", src("kmt"), { value: h.kmt, unit: "length", method: `KMt upright, above ${own ? "the table's K reference" : "the hull's lowest point"}: the limiting KG for GMt > 0 (${floated})`, cite: CITE.kmt, provenance: hp, why: "no waterplane second moment" }, { mixed: "the table's KB with the mesh's BMt" });
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
  const lb = a.balance.leadBand;
  put("lead", {
    value: a.balance.lead,
    unit: "percent",
    method: `Lead of the designer's CE over the CLR, % of LWL (${a.balance.clrMethod})`,
    cite: LE_SOURCE,
    provenance: combineProvenance(hp, provFromRow(lead?.prov)),
    why: "no CE or CLR",
    band: lb.range ? { min: lb.range[0] / 100, max: lb.range[1] / 100, label: `lead ${lb.range[0]}–${lb.range[1]}% of LWL for this keel and rig (a rule of thumb, secondhand)` } : null,
    note: lb.range ? undefined : `${lb.label[0].toUpperCase()}${lb.label.slice(1)}.`,
  });

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
