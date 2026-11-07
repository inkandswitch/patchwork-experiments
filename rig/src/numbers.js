// The numbers the tool shows, composed from the doc: the sail plan laid on
// the hull, the ratios, the hull as floated and its statics, each with its
// band and its provenance. Pure (no DOM), so the panels, the tests and (later)
// the contract read the same figures.
//
// The hull: a linked hull's mesh (the tool acquires it and passes it in as
// ctx.linked), or, with no link, a synthetic mesh from the principal
// dimensions (naval/synthetic-hull.js); either is floated at the stated
// displacement (naval/hull-form.js) and the rig stands on its stem and sheer.
// While a linked hull is loading, or when it can't be floated, the rig stands
// on a box outline from the principal dimensions and a warning says why.

import { buildSailPlan, hasForetriangle } from "./naval/sailplan.js";
import { computeRatios, bandOf, BANDS } from "./naval/ratios.js";
import { displacementOf, isEstimated, pathKey, OPTIONAL_DIMS } from "./doc.js";
import { floatHull, syntheticForm, datumOf, MODEL_LOA_M, modelWarning } from "./naval/hull-form.js";
import { toHullFrame, frameLabel } from "./naval/hull-frame.js";
import { analyse } from "./analysis.js";
import { LE_SOURCE } from "./naval/balance.js";
import { RHO_AIR, C_HEEL, CH_BETA } from "./naval/stability.js";
import { KNOT } from "./naval/units.js";
import { buildDesign, CLARKE_SOURCE } from "./naval/design.js";
import { referencePoint, helmVerdict, HELM_BAND } from "./naval/vpp.js";
import { envelopeText, envelopeGrade, DSYHS_RESIDUARY_SOURCE, SAVITSKY_SOURCE } from "./naval/resistance.js";
import { approximately } from "./naval/sails.js";

export { MODEL_LOA_M };

/** Labels for doc paths, used when saying what a figure was derived from. */
export const FIELD_LABELS = {
  "hull.dims.loa": "LOA",
  "hull.dims.lwl": "LWL",
  "hull.dims.beam": "beam",
  "hull.dims.bwl": "BWL",
  "hull.dims.tc": "canoe-body draft Tc",
  "hull.dims.draft": "draft",
  "hull.dims.freeboard": "freeboard",
  "hull.dims.displacementKg": "displacement",
  "hull.dims.cp": "Cp",
  "hull.dims.cm": "Cm",
  "hull.dims.lcbFrac": "LCB",
  "rig.I": "I",
  "rig.P": "P",
  "rig.E": "E",
  "rig.BAS": "BAS",
  "rig.ISP": "ISP",
  "rig.mast.aftOfStem": "mast position",
  "rig.mast.rakeDeg": "rake",
  "rig.forestayAftOfStem": "forestay tack",
  "rig.main.roach": "roach",
  "rig.headsail.LP": "LP",
  "rig.headsail.clewHeight": "headsail clew height",
  "rig.staysail.LP2": "staysail LP",
  "rig.staysail.clewHeight": "staysail clew height",
  "loading.ballast.kg": "ballast",
  "loading.displacement.kg": "displacement",
  "loading.crew.count": "crew",
  "loading.lightship.kg": "lightship",
  ...Object.fromEntries(
    ["keel", "rudder"].flatMap((f) =>
      [["aftOfStem", "position"], ["span", "span"], ["rootChord", "root chord"], ["tipChord", "tip chord"], ["sweepDeg", "sweep"], ["tc", "t/c"]].map(([k, l]) => [`appendages.${f}.${k}`, `${f} ${l}`]),
    ),
  ),
};

/** The box outline's datum and shape for principal dimensions. */
export function boxHull(dims) {
  const loa = dims.loa > 0 ? dims.loa : 0;
  const lwl = dims.lwl > 0 ? Math.min(dims.lwl, loa || dims.lwl) : 0;
  return {
    kind: "box",
    loa,
    lwl,
    stem: [loa / 2, dims.freeboard],
    stern: [-loa / 2, dims.freeboard],
    dwl: [-lwl / 2, lwl / 2],
    canoeBottomZ: -Math.max(0, dims.tc),
    draftZ: -Math.max(0, dims.draft),
    datum: { stemX: loa / 2, stemZ: dims.freeboard, sheerZ: dims.freeboard, sternX: -loa / 2, sternZ: dims.freeboard },
  };
}

/**
 * A figure's provenance from the doc paths it was derived from.
 * @returns {{ prov: "given"|"estimated"|"derived"|"from-estimated", from?: string[] }}
 */
function provOf(doc, paths, { derived = true, extraEstimated = [] } = {}) {
  const est = paths.filter((p) => isEstimated(doc, p)).map((p) => FIELD_LABELS[pathKey(p)] ?? pathKey(p));
  const from = [...est, ...extraEstimated];
  if (!derived) return from.length ? { prov: "estimated" } : { prov: "given" };
  return from.length ? { prov: "from-estimated", from } : { prov: "derived" };
}

const P = (s) => s.split(".");
const RIG_PATHS = ["rig.I", "rig.P", "rig.E", "rig.BAS", "rig.mast.aftOfStem", "rig.mast.rakeDeg", "rig.forestayAftOfStem"].map(P);

// ───────────────────────────────── the hull form, memoised

const MAX_FORMS = 8;
const forms = new Map(); // key → form, oldest first
const meshIds = new WeakMap();
let nextMeshId = 1;
const meshId = (m) => {
  if (!meshIds.has(m)) meshIds.set(m, nextMeshId++);
  return meshIds.get(m);
};
function memo(key, make) {
  if (forms.has(key)) {
    const f = forms.get(key);
    forms.delete(key);
    forms.set(key, f);
    return f;
  }
  const f = make();
  forms.set(key, f);
  while (forms.size > MAX_FORMS) forms.delete(forms.keys().next().value);
  return f;
}

/** The dims keys marked estimated (or left empty, for the optional coefficients). */
export const estimatedDims = (doc) => [
  ...Object.keys(doc.hull.dims).filter((k) => isEstimated(doc, ["hull", "dims", k])),
  ...OPTIONAL_DIMS.filter((k) => doc.hull.dims[k] == null),
];

/**
 * The floated hull for a doc: the linked mesh's when one is linked and in
 * hand, else the synthetic hull's. Memoised, so a rig drag never refloats it.
 * @param {object} doc normalized
 * @param {{ status?: string, mesh?: { triangles: Float64Array }, error?: string }} [linked] the tool's linked-hull state
 * @returns {{ form: object|null, state: "synthetic"|"linked"|"loading"|"pending"|"error", error?: string }}
 */
export function hullFormFor(doc, linked) {
  const link = doc.hull.link;
  const g = doc.loading.displacement;
  const given = g.from === "given" && Number.isFinite(g.kg) && g.kg > 0 ? g.kg : null;
  if (link) {
    if (linked?.status !== "ready" || !linked.mesh) return { form: null, state: linked?.status === "error" ? "error" : linked?.status === "pending" ? "pending" : "loading", error: linked?.error };
    const key = `L|${meshId(linked.mesh)}|${link.frame.bow}|${link.frame.up}|${given ?? "design"}`;
    const form = memo(key, () =>
      floatHull(toHullFrame(linked.mesh.triangles, link.frame), { massKg: given, kind: "mesh", label: linked.chip || "linked hull" }),
    );
    return { form, state: "linked" };
  }
  const est = estimatedDims(doc);
  const mass = displacementOf(doc).kg;
  const key = `S|${JSON.stringify(doc.hull.dims)}|${est.join(",")}|${mass}`;
  return { form: memo(key, () => syntheticForm(doc.hull.dims, { estimated: est, massKg: mass })), state: "synthetic" };
}

/** The hull the rig stands on, for the drawing and the sail plan's datum. */
function standOn(doc, form) {
  if (!form?.ok) return { ...boxHull(doc.hull.dims), form: null };
  const h = form.hydro;
  return {
    kind: form.kind,
    form,
    loa: form.loa,
    lwl: h.lwl,
    stem: form.stem,
    stern: form.stern,
    dwl: [h.xAft, h.xFwd],
    canoeBottomZ: form.keelZ,
    draftZ: form.kind === "synthetic" ? Math.min(form.keelZ, -Math.max(0, doc.hull.dims.draft)) : form.keelZ,
    datum: datumOf(form, doc.rig.mast.aftOfStem),
  };
}

/**
 * Everything the Numbers panel and the drawing need.
 * @param {ReturnType<import("./doc.js").normalize>} doc a normalized doc
 * @param {{ linked?: object, statics?: { status: string, table?: object, curve?: object[], readouts?: object, km?: object, source?: string, error?: string }, polar?: object, dragging?: boolean }} [ctx]
 *   linked: the tool's linked-hull state; statics: the worker's table and what was read off it;
 *   dragging: a handle is moving, so the sails' trimmed tables may be borrowed (the result says approximate)
 */
export function computeNumbers(doc, ctx = {}) {
  // mid-drag: borrow the last trimmed sail table rather than re-trim every frame (sails.js)
  if (ctx.dragging) return { ...approximately(() => numbersOf(doc, ctx)), approximate: true };
  return numbersOf(doc, ctx);
}

function numbersOf(doc, ctx) {
  const dims = doc.hull.dims;
  const { form, state, error: linkError } = hullFormFor(doc, ctx.linked);
  const hull = standOn(doc, form);
  const linkedOk = state === "linked" && form?.ok;
  const plan = buildSailPlan(doc.rig, hull.datum);
  const disp = linkedOk
    ? { kg: form.float.massKg, from: form.float.from === "given" ? "given" : "hull" }
    : state === "synthetic"
      ? displacementOf(doc)
      : doc.loading.displacement.from === "given" && doc.loading.displacement.kg > 0
        ? { kg: doc.loading.displacement.kg, from: "given" }
        : { kg: NaN, from: "hull" };
  const hydro = form?.ok ? form.hydro : null;
  const lwl = linkedOk ? hydro.lwl : dims.lwl;
  const bwl = linkedOk ? hydro.bwl : dims.bwl;
  const tc = linkedOk ? hydro.tc : dims.tc;
  const ratios = computeRatios({
    saDesignerM2: plan.designer.areaM2,
    saActualM2: plan.actual.areaM2,
    displacementKg: disp.kg,
    lwl,
    bwl,
    tc,
    ballastKg: doc.loading.ballast.kg,
  });

  const a = analyse({ doc, hull, form: form?.ok ? form : null, plan, displacementKg: disp.kg, statics: ctx.statics });
  const appBottom = Math.min(...a.app.foils.map((f) => f.bottomZ));
  if (a.app.foils.length) hull.draftZ = Math.min(hull.canoeBottomZ, appBottom);
  hull.hasKeel = !!a.app.keel;

  const warnings = [...plan.warnings];
  if (doc.hull.link) {
    if (state === "loading") warnings.push("Reading the linked hull… the rig stands on a box from the principal dimensions until it arrives.");
    else if (state === "pending") warnings.push(`The linked hull isn't built yet: ${linkError ?? "its render has no GLB"}.`);
    else if (state === "error") warnings.push(`The linked hull can't be read here: ${linkError ?? "unknown error"}.`);
  }
  if (form && !form.ok) warnings.push(`The hull can't be floated: ${form.error}.`);
  if (form?.ok) warnings.push(...form.warnings);
  // the designer's stated LOA counts too, even where the synthetic hull had to stretch to the LWL
  if (!linkedOk && dims.loa > 0 && dims.loa < MODEL_LOA_M && !warnings.some((w) => /model, not a boat/.test(w))) warnings.push(modelWarning(dims.loa));
  if (!doc.hull.link && dims.lwl > dims.loa) warnings.push("LWL is longer than LOA.");
  if (doc.rig.mast.aftOfStem > (form?.ok ? form.loa : dims.loa)) warnings.push("The mast is aft of the stern.");
  warnings.push(...a.warnings);

  const dispPath = disp.from === "given" ? P("loading.displacement.kg") : P("hull.dims.displacementKg");
  const main = plan.sails.find((s) => s.id === "main");
  const jib = plan.sails.find((s) => s.id === "jib");
  const stay = plan.sails.find((s) => s.id === "staysail");
  const stem = hull.datum.stemX;
  const aft = (x) => (Number.isFinite(x) ? stem - x : NaN);
  const est = plan.estimated;
  const ft = hasForetriangle(plan.type);
  // a figure read off a linked mesh is "from mesh", whatever the doc's dims say
  const meshProv = { prov: "mesh" };
  const hullProv = (paths) => (linkedOk ? meshProv : provOf(doc, paths));

  /** @type {{ id: string, title: string, note?: string, rows: object[] }[]} */
  const sections = [];
  const row = (id, label, value, dim, extra = {}) => ({ id, label, value, dim, ...extra });

  const sp = [];
  sp.push(row("mainRule", "Main, ½·P·E", plan.rule.mainM2, "area", provOf(doc, [P("rig.P"), P("rig.E")])));
  if (ft) sp.push(row("foretriangle", "Foretriangle, ½·I·J", plan.rule.foretriangleM2, "area", provOf(doc, [P("rig.I"), P("rig.mast.aftOfStem"), P("rig.forestayAftOfStem")])));
  sp.push(row("saDesigner", "Sail area, designer's (main + 100% foretriangle)", plan.designer.areaM2, "area", provOf(doc, RIG_PATHS)));
  if (main) sp.push(row("mainActual", `Main with ${Math.round(plan.sails[0].roach * 100)}% roach`, main.areaM2, "area", provOf(doc, [P("rig.P"), P("rig.E"), P("rig.main.roach"), P("rig.mast.rakeDeg")])));
  if (jib)
    sp.push(
      row("headsail", `${jib.kind === "genoa" ? "Genoa" : jib.kind === "self-tacking" ? "Self-tacking jib" : "Jib"}, LP ${Math.round(jib.lpPercent)}%`, jib.areaM2, "area", provOf(doc, [...RIG_PATHS, P("rig.headsail.LP")])),
    );
  if (stay) sp.push(row("staysail", "Staysail", stay.areaM2, "area", provOf(doc, [P("rig.staysail.LP2")], { extraEstimated: est.filter((e) => e.startsWith("staysail")) })));
  sp.push(row("saActual", "Sail area, actual sails", plan.actual.areaM2, "area", provOf(doc, [...RIG_PATHS, P("rig.main.roach"), P("rig.headsail.LP")], { extraEstimated: est })));
  if (ft) sp.push(row("J", "J (forestay to mast)", plan.J, "length", provOf(doc, [P("rig.mast.aftOfStem"), P("rig.forestayAftOfStem")])));
  sp.push(row("mastHeight", "Mast above sheer", plan.mast.heightM, "length", provOf(doc, RIG_PATHS)));
  sp.push(row("mastheadAboveDWL", "Masthead above DWL", plan.mast.aboveDatumZ, "length", provOf(doc, [...RIG_PATHS, P("hull.dims.freeboard")])));
  for (const r of main?.reefs ?? [])
    sp.push(row(`reef${Math.round(r.fraction * 100)}`, `Main, reefed ${Math.round(r.fraction * 100)}% of P`, r.areaM2, "area", provOf(doc, [P("rig.P"), P("rig.E"), P("rig.main.roach")])));
  const sailplanSection = { id: "sailplan", title: "Sail plan", rows: sp };

  const ce = [];
  const ceProv = provOf(doc, [...RIG_PATHS, P("hull.dims.freeboard")]);
  ce.push(row("ceDesignerAft", "CE, designer's: aft of stem", aft(plan.designer.ce?.[0]), "length", ceProv));
  ce.push(row("ceDesignerHeight", "CE, designer's: above DWL", plan.designer.ce?.[1], "length", ceProv));
  const actProv = provOf(doc, [...RIG_PATHS, P("hull.dims.freeboard"), P("rig.main.roach"), P("rig.headsail.LP")], { extraEstimated: est });
  ce.push(row("ceActualAft", "CE, actual sails: aft of stem", aft(plan.actual.ce?.[0]), "length", actProv));
  ce.push(row("ceActualHeight", "CE, actual sails: above DWL", plan.actual.ce?.[1], "length", actProv));
  if (main) ce.push(row("ceMainHeight", "Main CE above the partners", main.ceAbovePartnersM, "length", provOf(doc, RIG_PATHS)));
  if (lwl > 0 && plan.designer.ce) {
    const mid = hydro ? (hydro.xAft + hydro.xFwd) / 2 : 0;
    ce.push(
      row("ceDesignerFromMidLWL", "CE, designer's: forward of mid-LWL", plan.designer.ce[0] - mid, "length", {
        ...(linkedOk ? meshProv : provOf(doc, [...RIG_PATHS, P("hull.dims.loa"), P("hull.dims.lwl")])),
      }),
    );
  }
  const ceSection = { id: "ce", title: "Centres of effort", rows: ce };

  const rt = [];
  const dispProv = linkedOk && disp.from === "hull" ? meshProv : provOf(doc, [dispPath], { derived: false });
  const dispLabel = disp.from === "given" ? "Displacement (given)" : linkedOk ? "Displacement (at the hull's design waterline)" : "Displacement (hull)";
  rt.push(row("displacement", dispLabel, disp.kg, "mass", dispProv));
  rt.push(row("volume", "Displaced volume ∇", ratios.volumeM3, "volume", linkedOk && disp.from === "hull" ? meshProv : provOf(doc, [dispPath])));
  const band = (id, v) => bandOf(id, v);
  rt.push(row("saD", "SA/D, designer's", ratios.saDDesigner, "ratio", { ...provOf(doc, [...RIG_PATHS, dispPath]), band: band("saD", ratios.saDDesigner), source: BANDS.saD.source }));
  rt.push(row("saDActual", "SA/D, actual sails", ratios.saDActual, "ratio", { ...provOf(doc, [...RIG_PATHS, dispPath, P("rig.main.roach"), P("rig.headsail.LP")], { extraEstimated: est }), band: band("saD", ratios.saDActual), source: BANDS.saD.source }));
  rt.push(row("dL", "D/L", ratios.dL, "ratio", { ...hullProv([dispPath, P("hull.dims.lwl")]), band: band("dL", ratios.dL), source: BANDS.dL.source }));
  rt.push(row("ballastRatio", "Ballast / displacement", ratios.ballast, "percent", { ...provOf(doc, [dispPath, P("loading.ballast.kg")]), band: band("ballast", ratios.ballast), source: BANDS.ballast.source }));
  rt.push(row("lwlBwl", "LWL / BWL", ratios.lwlBwl, "ratio", { ...hullProv([P("hull.dims.lwl"), P("hull.dims.bwl")]), band: band("lwlBwl", ratios.lwlBwl), source: BANDS.lwlBwl.source }));
  rt.push(row("bwlTc", "BWL / Tc", ratios.bwlTc, "ratio", { ...hullProv([P("hull.dims.bwl"), P("hull.dims.tc")]), band: band("bwlTc", ratios.bwlTc), source: BANDS.bwlTc.source }));
  rt.push(row("slenderness", "LWL / ∇^⅓", ratios.slenderness, "ratio", { ...hullProv([P("hull.dims.lwl"), dispPath]), band: band("slenderness", ratios.slenderness), source: BANDS.slenderness.source }));
  rt.push(row("hullSpeed", "Hull speed, 1.34·√LWL(ft)", ratios.hullSpeedMs, "speed", { ...hullProv([P("hull.dims.lwl")]), note: "Fn ≈ 0.40. A rule of thumb, not a prediction: Performance has the predicted speeds." }));
  const ratiosSection = { id: "ratios", title: "Ratios", rows: rt };
  // the performance model: one design object; the reference point now, the polar in the worker
  const design = buildDesign({ doc, n: { form: form?.ok ? form : null, analysis: a, plan } });
  let reference = null, helm = null;
  if (design.ok) {
    try {
      reference = referencePoint(design);
      helm = helmVerdict(design, reference);
    } catch (err) {
      reference = null;
      helm = { id: "unknown", text: `the reference point failed: ${err?.message ?? err}` };
    }
  }
  const grade = design.ok ? envelopeGrade(design.hull.envelope) : null;
  // what a drag changes first: the sails, then the balance and the performance they give; the rest after
  sections.push(sailplanSection);
  sections.push(balanceSection(doc, a, plan, stem, linkedOk, { design, reference, helm }));
  sections.push(performanceSection(doc, { design, reference, helm, polar: ctx.polar, grade }));
  sections.push(ceSection, ratiosSection);
  if (form?.ok) sections.push(hullSection(doc, form, linkedOk, stem, disp));
  sections.push(foilsSection(doc, a));
  if (a.mass) sections.push(massSection(doc, a, stem));
  const st = stabilitySection(form?.ok ? form : null, ctx.statics, a, doc, plan);
  if (st) sections.push(st);
  if (a.loads) sections.push(loadsSection(doc, a, plan));

  const glance = glanceOf(doc, a, { design, reference, helm, grade });
  return { doc, hull, form: form?.ok ? form : null, hullState: state, plan, ratios, displacement: disp, sections, warnings, analysis: a, design, reference, helm, glance };
}

const helmWords = (deg) => (Math.abs(deg) < 0.5 ? "neutral helm" : `${deg > 0 ? "weather" : "lee"} helm ${Math.abs(deg).toFixed(1)}°`);

/**
 * The few figures a designer watches while moving the rig, for the strip under
 * the drawing: helm and its verdict, speed, VMG, heel, the sail set, the lead,
 * and one line when the lead rule and the VPP's helm disagree.
 */
function glanceOf(doc, a, { design, reference: r, helm, grade }) {
  const c = doc.conditions.reference;
  const b = a.balance;
  const range = b.leadBand?.range ?? null;
  const pct = Number.isFinite(b.lead) ? b.lead * 100 : NaN;
  const lead = { pct, label: b.leadBand?.label ?? "", out: !!b.leadBand?.out, range };
  const out = { at: `${knOf(c.tws)} kn true, ${c.twa}°`, lead, ok: !!(design?.ok && r), why: design?.ok ? (r ? null : "the reference point failed") : design?.why ?? null };
  if (!out.ok) return out;
  out.helm = helm ? { deg: helm.deg ?? r.rudder, text: helm.text, out: !!helm.out, id: helm.id } : null;
  out.speed = r.speed;
  out.vmg = r.speed != null ? r.vmg : null;
  out.heel = r.heel;
  out.sails = r.reef >= 0 ? `reef ${r.reef + 1}${r.flat < 0.995 ? `, flat ${r.flat.toFixed(2)}` : ""}` : r.flat < 0.995 ? `full sail, flat ${r.flat.toFixed(2)}` : "full sail";
  out.regime = r.regimeText;
  out.extrapolated = grade && grade.level !== "inside" ? grade : null;
  out.inDoubt = r.flags.filter((f) => f.id !== "dsyhs").map((f) => f.text);
  const leadSays = !Number.isFinite(pct) || !range ? null : pct < range[0] ? "weather" : pct > range[1] ? "lee" : "balanced";
  const d = out.helm?.deg;
  const helmSays = !Number.isFinite(d) ? null : d < -0.5 ? "lee" : d > HELM_BAND.max ? "weather" : "balanced";
  if (leadSays && helmSays && leadSays !== helmSays) {
    const leadText = leadSays === "balanced" ? "within its band" : leadSays === "weather" ? "below its band (toward weather helm)" : "above its band (toward lee helm)";
    out.disagree = `The lead rule and the VPP disagree: lead ${pct.toFixed(1)}% is ${leadText}, but the VPP gives ${helmWords(d)}. The band is a secondhand rule of thumb; the VPP leaves out the hull's heel-induced yaw (it reads toward lee helm).`;
  }
  return out;
}

/** "Hull as floated": the mesh's own figures at the stated displacement. */
function hullSection(doc, form, linkedOk, stemX, disp) {
  const h = form.hydro;
  const est = estimatedDims(doc);
  const prov = linkedOk
    ? { prov: "mesh" }
    : { prov: "synthetic", from: est.length ? est.map((k) => FIELD_LABELS[`hull.dims.${k}`] ?? k) : undefined };
  const rows = [];
  const row = (id, label, value, dim, extra = {}) => {
    if (value == null || !Number.isFinite(value)) return;
    rows.push({ id, label, value, dim, ...prov, ...extra });
  };
  row("hullLoa", "LOA, mesh", form.loa, "length");
  row("hullBeam", "Beam, mesh", form.beam, "length");
  row("floatVolume", "∇ as floated", form.float.volumeM3, "volume");
  row("lwlFloat", "LWL", h.lwl, "length");
  row("bwlFloat", "BWL", h.bwl, "length");
  row("tcFloat", "Tc, canoe body", h.tc, "length");
  row("wsa", "Wetted area, canoe body", h.wsaCanoeM2, "area", h.transomWetM2 > 0 ? { note: "Skin only; the immersed transom is apart." } : {});
  if (h.transomWetM2 > 1e-6 * h.wsaM2) row("transomWet", "Immersed transom", h.transomWetM2, "area");
  row("aw", "Waterplane area Aw", h.awM2, "area");
  row("lcbAft", "LCB aft of stem", stemX - h.lcb, "length");
  row("lcbPct", "LCB from mid-LWL (+ forward)", (h.lcb - (h.xAft + h.xFwd) / 2) / h.lwl, "percent");
  row("lcfAft", "LCF aft of stem", h.lcf != null ? stemX - h.lcf : null, "length");
  row("kb", "KB", h.kb, "length", { note: "K is the canoe body's lowest point." });
  row("bmt", "BMt", h.bmt, "length");
  row("kmt", "KMt", h.kmt, "length");
  row("cp", "Cp (on the largest section)", h.cp, "ratio");
  row("cm", "Cm (largest section)", h.cm, "ratio");
  row("cb", "Cb", h.cb, "ratio");
  row("cw", "Cw", h.cw, "ratio");
  row("amax", "Largest section Ax", h.amaxM2, "area");
  row("halfEntrance", "Half-angle of entrance", h.halfEntranceDeg, "angle");
  row("lateralArea", "Lateral profile area, canoe body", form.lateral.areaM2, "area");
  if (form.lateral.centroid) {
    row("lateralAft", "Lateral profile centroid aft of stem", stemX - form.lateral.centroid[0], "length");
    row("lateralDepth", "Lateral profile centroid below DWL", -form.lateral.centroid[1], "length");
  }
  row("freeboardMin", "Lowest sheer above DWL", form.freeboardMin, "length");
  const where = linkedOk ? `the linked hull, ${frameLabel(doc.hull.link.frame)}` : "a synthetic hull built from the principal dimensions";
  const floated = disp.from === "given" ? "floated at the given displacement" : linkedOk ? "at its own design waterline (z = 0)" : "floated at its own displacement";
  return { id: "hull", title: "Hull as floated", note: `From ${where}, ${floated}. Canoe body only: the keel and rudder are under Keel and rudder.${form.notes.length ? ` ${form.notes.join(" ")}` : ""}`, rows };
}

const APP_GEOM = ["aftOfStem", "span", "rootChord", "tipChord", "sweepDeg", "tc"];
const appPaths = (id, keys = APP_GEOM) => keys.map((k) => ["appendages", id, k]);
const knOf = (aws) => Math.round((aws / KNOT) * 10) / 10;

/** Rows that skip a missing value (NaN or null) unless `keep` says it means something. */
function rowsBuilder() {
  const rows = [];
  const row = (id, label, value, dim, extra = {}) => {
    if ((value == null || !Number.isFinite(value)) && !extra.keep) return;
    const { keep, ...rest } = extra;
    rows.push({ id, label, value: value ?? NaN, dim, ...rest });
  };
  return { rows, row };
}

/** "Keel and rudder": planforms and coefficients. */
function foilsSection(doc, a) {
  const { rows, row } = rowsBuilder();
  const NAME = { keel: "Keel", rudder: "Rudder" };
  for (const f of a.app.foils) {
    const L = NAME[f.id];
    const geo = provOf(doc, appPaths(f.id));
    row(`${f.id}Area`, `${L} area`, f.areaM2, "area", geo);
    row(`${f.id}Span`, `${L} span`, f.span, "length", provOf(doc, appPaths(f.id, ["span"]), { derived: false }));
    row(`${f.id}Mac`, `${L} mean aerodynamic chord`, f.mac, "length", geo);
    row(`${f.id}ArGeom`, `${L} aspect ratio, geometric b²/S`, f.arGeom, "ratio", geo);
    row(`${f.id}ArEff`, `${L} aspect ratio, effective`, f.arEff, "ratio", {
      ...geo,
      note: f.endPlate ? "2 × geometric: the hull is its end plate." : `1 × geometric: no end plate (${f.rootNote}).`,
    });
    row(`${f.id}Slope`, `${L} lift slope, per radian`, f.liftSlope, "ratio", {
      ...geo,
      note: `Helmbold with ${f.sweepHalfDeg.toFixed(1)}° half-chord sweep. Stalls at ${f.stallDeg}° (CL max ${f.clMax.toFixed(2)}).`,
    });
    row(`${f.id}Volume`, `${L} volume`, f.volumeM3, "volume", geo);
    if (f.bulb) row("bulbVolume", "Bulb volume", f.bulb.volumeM3, "volume", { prov: "derived", note: "A prolate spheroid of the bulb's length and diameter." });
  }
  if (a.app.keel && a.app.rudder) {
    row("downwashGradient", "Keel downwash on the rudder, dε/dα", a.balance.downwashGradient, "ratio", { ...provOf(doc, appPaths("keel")), note: "The rudder sees α(1 − dε/dα)." });
    row("rudderShare", "Rudder, share of the lateral plane", a.balance.rudderShare, "percent", provOf(doc, [...appPaths("keel"), ...appPaths("rudder")]));
  }
  row("appVolume", "Appendages' displacement", a.app.buoyancyKg, "mass", { ...provOf(doc, [...appPaths("keel"), ...appPaths("rudder")]), note: "Added to the canoe body's buoyancy in the stability." });
  const bottom = Math.min(...a.app.foils.map((f) => f.bottomZ));
  row("draftOverall", "Draft, keel down", Number.isFinite(bottom) ? -Math.min(bottom, a.geo.bottomZ) : -a.geo.bottomZ, "length", provOf(doc, appPaths("keel")));
  const note = a.app.keel
    ? "Each foil hangs from the canoe body's underside. Effective AR and lift slope are upright; heel reduces the end-plate credit."
    : "No keel: the canoe body alone resists leeway. Choose a keel to draw one.";
  return { id: "foils", title: "Keel and rudder", note, rows };
}

/** "Balance": the CLRs and the lead. */
function balanceSection(doc, a, plan, stemX, linkedOk, perf = {}) {
  const { rows, row } = rowsBuilder();
  const b = a.balance;
  if (perf.helm && perf.reference) {
    const r = doc.conditions.reference;
    row("helm", `Helm at ${knOf(r.tws)} kn true, ${r.twa}° (rudder, + weather)`, perf.reference.rudder, "angle", {
      prov: "derived",
      band: { label: perf.helm.text, out: perf.helm.out || undefined },
      source: HELM_BAND.source,
      note: "The rudder angle that balances yaw at the reference point (Performance). Band: a rule of thumb, 0–5° of weather helm.",
    });
  } else if (perf.design && !perf.design.ok) row("helm", "Helm at the reference point", NaN, "angle", { prov: "derived", keep: true, note: `Not yet: ${perf.design.why}.` });
  const aft = (p) => (p ? stemX - p[0] : NaN);
  const prov = provOf(doc, [...RIG_PATHS, ...appPaths("keel"), ...appPaths("rudder")], { extraEstimated: linkedOk ? [] : estimatedDims(doc).map((k) => FIELD_LABELS[`hull.dims.${k}`] ?? k) });
  row("clrLeAft", "CLR for the lead, aft of stem", aft(b.clrLE), "length", { ...prov, note: `${b.clrMethod}.` });
  row("lead", "Lead, designer's CE over that CLR (% of LWL)", b.lead, "percent", {
    ...prov,
    band: b.leadBand.range || b.leadBand.out ? { label: b.leadBand.label, out: b.leadBand.out } : { label: b.leadBand.label },
    source: LE_SOURCE,
  });
  row("clrWholeAft", "CLR, whole underwater profile: aft of stem", aft(b.clrWhole), "length", { ...prov, note: "Canoe body, keel, bulb and rudder, by area." });
  row("clrWholeDepth", "CLR, whole underwater profile: below DWL", b.clrWhole ? -b.clrWhole[1] : NaN, "length", prov);
  row("leadWhole", "Lead, designer's CE over the whole profile's CLR", b.leadWhole, "percent", prov);
  row("leadActual", "Lead, actual sails' CE over the whole profile's CLR", b.leadActualWhole, "percent", prov);
  row("hcAft", "Foils' hydrodynamic centre, aft of stem", aft(b.hc), "length", { ...prov, note: "Keel and rudder quarter chords by lift slope × area, the rudder in the keel's downwash. The canoe body's side force comes with the performance model." });
  row("lateralAreaTotal", "Lateral area, whole profile", b.lateralAreaM2, "area", prov);
  return {
    id: "balance",
    title: "Balance",
    note: "Geometric balance: where the CE sits over the lateral plane, a rule of thumb (its bands are secondhand, est.). The helm is the performance model's: the rudder angle that balances yaw at the reference point. The model leaves out the hull's heel-induced yaw, so its helm reads toward lee as she heels.",
    rows,
  };
}

const massEstimated = (a) => a.mass.items.filter((i) => i.estimated).map((i) => i.name.toLowerCase().replace(/\s*\(.*$/, "").replace(/,.*$/, ""));

/** "Mass": the roll-up. */
function massSection(doc, a, stemX) {
  const { rows, row } = rowsBuilder();
  const m = a.mass;
  row("massTotal", "Displacement, rolled up", m.massKg, "mass", { prov: "derived" });
  for (const i of m.items) row(`mass-${i.id}`, i.name, i.massKg, "mass", { prov: i.estimated ? "estimated" : "given" });
  row("rigMass", "Rig in all", m.riggedMassKg, "mass", { prov: m.items.some((i) => i.kind === "rig" && i.estimated) ? "estimated" : "given" });
  const est = massEstimated(a);
  const p = est.length ? { prov: "from-estimated", from: est } : { prov: "derived" };
  row("vcg", "VCG, above DWL", m.G[2], "length", p);
  row("kg", "KG, above the canoe body's lowest point", m.G[2] - a.geo.bottomZ, "length", p);
  row("lcgAft", "LCG, aft of stem", stemX - m.G[0], "length", { ...p, note: "Over the LCB with the appendages: she floats at her design trim." });
  if (m.crew.massKg > 0)
    row("crewArm", "Crew's arm to windward", m.crew.arm, "length", m.crew.armGiven ? { prov: "given" } : { prov: "estimated", note: `By mode (${m.crew.mode}), from the hull's half-breadth.` });
  const ls = doc.loading.lightship;
  const note = Number.isFinite(ls.kg) && ls.kg > 0
    ? "The lightship is given; anything the roll-up misses is carried as unaccounted."
    : "The lightship is the remainder: the displacement less everything else. Give it (Loading) to check the roll-up against the displacement.";
  return { id: "mass", title: "Mass", note, rows };
}

/** "Stability": RM, HM, steady heel, reef wind; the GZ readouts. */
function stabilitySection(form, statics, a, doc, plan) {
  if (!form || !a.mass) return null;
  const { rows, row } = rowsBuilder();
  const est = massEstimated(a);
  const derived = est.length ? { prov: "from-estimated", from: est } : { prov: "derived" };
  row("gmUpright", "GM upright, from the hull as floated", a.gm?.GM, "length", derived);
  row("heelArm", "Heeling arm, designer's CE above the CLR", a.heelingArm, "length", { prov: "derived" });
  row("dellenbaugh", "Dellenbaugh angle", a.dellenbaugh, "angle", {
    ...derived,
    note: "Heel under 1 lb/ft² on the designer's area, by GM (Skene's). For comparing boats of a type.",
  });
  const s = a.stab;
  if (!s) {
    const why = !statics || statics.status === "none" ? null : statics.status === "error" ? `The statics couldn't be built: ${statics.error}.` : "Building the hydrostatic table from the hull…";
    return { id: "stability", title: "Stability", note: [why, ...a.notes].filter(Boolean).join(" "), rows };
  }
  const r = s.readouts;
  const table = { prov: "table" };
  row("gmTable", "GM, from the table", s.gmTable, "length", table);
  row("gzMax", "GZ max", r.gzMax, "length", table);
  row("heelAtGzMax", "Heel at GZ max", r.heelAtMaxDeg, "angle", table);
  row("avs", "Angle of vanishing stability", r.avsDeg, "angle", table);
  row("sheerImmersion", "Sheer-immersion angle", r.sheerImmersionDeg, "angle", table);
  row("gzArea30", "Area under GZ to 30°", r.area30, "lengthRad", table);
  row("gzArea40", "Area under GZ to 40°", r.area40, "lengthRad", table);
  row("rm1", "RM at 1°, crew as set", s.rm1, "moment", derived);
  row("rm30", "RM at 30°, crew as set", s.rm30, "moment", derived);
  row("crewShare", `Crew's share of RM at ${a.heelLimit}°`, s.crewShare, "percent", derived);
  for (const w of s.winds) {
    const kn = knOf(w.aws);
    const note = w.state === "upright" ? "Held upright by the crew." : w.state === "overpowered" ? "Overpowered: the wind lays her past her greatest righting moment." : w.state === "unknown" ? "Beyond the table's coverage." : undefined;
    row(`heel${String(kn).replace(".", "_")}`, `Steady heel at ${kn} kn apparent, full sail`, w.heelDeg, "angle", { ...derived, keep: true, ...(note ? { note } : {}) });
  }
  s.reef.forEach((set, i) =>
    row(i === 0 ? "reefWind" : `reefWind${i}`, `${set.label}: up to (heel ${a.heelLimit}°)`, set.aws, "speed", { ...derived, keep: true, ...(set.aws == null ? { note: "Beyond the table's coverage." } : {}) }),
  );
  const src = s.source === "chartroom" ? "the hull's own Chartroom table" : "a Chartroom-shaped table built from the mesh";
  const notes = [
    `From ${src} at fixed trim, with G from the mass roll-up and the keel's and rudder's buoyancy added.`,
    `Heeling moment ½·ρ·AWS²·A·C_H·h·cos²φ, ρ ${RHO_AIR} kg/m³, C_H ${a.sets[0]?.ch != null ? a.sets[0].ch.toFixed(2) : C_HEEL} (the sail model's, trimmed for drive at ${CH_BETA}° apparent, not flattened). Winds are apparent. The Performance section solves heel with the sails trimmed and flattened.`,
    ...(r.notes ?? []),
    ...a.notes,
  ];
  return {
    id: "stability",
    title: "Stability",
    note: notes.join(" "),
    rows,
    curve: s.points,
    stability: { points: s.points, winds: s.winds, heelLimit: a.heelLimit },
  };
}

/** "Loads": static design loads for fit-out. */
function loadsSection(doc, a, plan) {
  const { rows, row } = rowsBuilder();
  const L = a.loads;
  const p = { prov: "derived" };
  row("loadRm30", "RM30, the rig's design moment", L.rm30, "moment", p);
  if (L.chainplateN != null) {
    row("chainplateN", "Windward chainplates, vertical", L.chainplateN, "force", { prov: "estimated", note: "RM30 over a chainplate base of 0.9 × the half-breadth at the mast." });
    row("mastCompressionN", "Mast compression", L.chainplateN, "force", { prov: "estimated", note: "The same, before rig tension." });
  }
  row("loadAws", "At the reef wind (apparent)", L.atAws, "speed", p);
  row("jibSheetN", "Headsail sheet", L.jibSheetN, "force", { prov: "estimated", note: "Harken's rule: lb = ft² × kn² × 0.00431." });
  row("mainClewN", "Main, load at the clew", L.mainClewN, "force", { prov: "estimated", note: "The same rule on the main, × (1 + roach)." });
  if (L.rudder) row("rudderTorque", "Rudder-stock torque", L.rudder.nm, "moment", { prov: "estimated", note: `At hull speed, ${(L.rudder.speedMs / KNOT).toFixed(1)} kn: the larger of at stall and stalled at the rudder's limit.` });
  return { id: "loads", title: "Loads", note: "Static, no safety factor, no rig pretension. Halyard loads aren't estimated: no rule found to cite.", rows };
}

/** Plain words for the model's scope and the hull's place in it. */
function performanceNotes(design) {
  const notes = [
    "Static VPP: flat water, steady wind with no gradient, fixed trim, no windage, no spinnaker, no heel-induced hull yaw. Sails trimmed to their best angle of attack and flattened or reefed to keep within the heel limit.",
  ];
  if (!design.ok) return notes;
  const p = design.planing;
  notes.push(
    p.capability > 0
      ? `Planing: D/L ${p.dL.toFixed(0)}, so she can plane (capability ${p.capability.toFixed(2)}); past Fn 0.55 the resistance blends into Savitsky's planing surface (deadrise ${p.deadriseDeg.toFixed(1)}°, ${p.deadriseFrom}; beam = BWL, estimated).`
      : `Planing: D/L ${p.dL.toFixed(0)}, too heavy to plane in this model; past Fn 0.75 a point is "beyond model".`,
  );
  notes.push(...design.notes);
  return notes;
}

/** "Performance": the reference point now, the polar and its table when the worker has them. */
function performanceSection(doc, { design, reference, helm, polar, grade }) {
  const { rows, row } = rowsBuilder();
  const c = doc.conditions;
  const sources = [DSYHS_RESIDUARY_SOURCE, SAVITSKY_SOURCE, CLARKE_SOURCE].join(" ");
  if (!design.ok) return { id: "performance", title: "Performance", note: `Not computed: ${design.why}.`, rows };
  const r = reference;
  const at = `${knOf(c.reference.tws)} kn true at ${c.reference.twa}°`;
  const extrap = grade && grade.level !== "inside" ? grade : null;
  if (r) {
    // the DSYHS caveat is the hull's: said once, in the banner and its details, not under every row
    const flags = r.flags.filter((f) => f.id !== "dsyhs").map((f) => f.text).join(" ");
    const p = { prov: "derived", ...(flags ? { note: flags } : {}) };
    const speedBand = extrap ? { band: { label: `DSYHS extrapolated (${extrap.count} of ${extrap.of})`, out: extrap.level === "far" || undefined } } : {};
    row("refSpeed", `Boat speed, ${at}`, r.speed ?? NaN, "speed", { ...p, ...speedBand, keep: true, source: sources });
    row("refVmg", "VMG", r.speed != null ? r.vmg : NaN, "speed", { prov: "derived", keep: true });
    row("refHeel", "Heel", r.heel, "angle", { prov: "derived" });
    row("refLeeway", "Leeway", r.leeway, "angle", { prov: "derived" });
    row("refHelm", "Rudder (+ weather helm)", r.rudder, "angle", { prov: "derived", band: { label: helm.text, out: helm.out || undefined }, source: HELM_BAND.source });
    row("refAws", "Apparent wind", r.aws, "speed", { prov: "derived" });
    row("refAwa", "Apparent wind angle", r.awa, "angle", { prov: "derived" });
    row("refFlat", "Flat (1 = full power)", r.flat, "ratio", { prov: "derived", note: r.reef >= 0 ? `Reef ${r.reef + 1}.` : "Full sail." });
    row("refFn", "Froude number", r.fn, "ratio", { prov: "derived", note: r.regimeText });
  }
  const notes = performanceNotes(design);
  let perf = null;
  const key = designKey(design);
  if (polar?.result) perf = { polar: polar.result, stale: polar.key !== key || polar.status === "computing" };
  const status = !polar ? "" : polar.key !== key || polar.status === "computing" ? "Computing the polar…" : polar.status === "error" ? `The polar couldn't be computed: ${polar.error}.` : "";
  const banner = extrap ? { level: extrap.level, text: extrap.text, details: envelopeText(design.hull.envelope) } : null;
  return { id: "performance", title: "Performance", note: [status, ...notes].filter(Boolean).join(" "), rows, performance: perf, stale: !!perf?.stale || (!perf && !!status), banner };
}

/** A design's identity for the polar: equal keys, equal polars. */
export const designKey = (design) => (design?.ok ? JSON.stringify(design) : "");
