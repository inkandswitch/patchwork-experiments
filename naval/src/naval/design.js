// One design object, plain data, from the doc and everything computeNumbers
// worked out: the hull's DSYHS particulars and the planing bottom, the foils
// as the VPP reads them, the righting curve, the sail sets with their
// trimmed coefficient tables, and the conditions. The VPP (vpp.js), the
// worker and (later) the contract all read this one object, so what the
// tool shows, what the polar says and what the contract carries agree.
// Structured-cloneable: no functions, no typed arrays. A sail set's trimmed
// coefficient table is derived from it on demand (sails.js tableOf).

import { dsyhsHull, envelope, planingCapability } from "./resistance.js";
import { rigSails, rigSpan, SAIL_KINDS } from "./sails.js";
import { combineCE } from "./sailplan.js";
import { sectionAt, sideAt } from "./mesh-hydro.js";
import { G } from "./ratios.js";
import { RHO_SEA } from "./units.js";

const RAD = Math.PI / 180;
const fin = (v) => Number.isFinite(v);

/**
 * The planing bottom's deadrise from the hull's section 20% of the
 * waterline forward of its aft end: for a section of beam B, depth T and
 * area A, tan β = 4·(B·T − A)/B² (exact for a V; 0 for a box).
 */
export function deadriseOf(form) {
  const h = form.hydro;
  const x = h.xAft + 0.2 * h.lwl;
  const s = sectionAt(form.mesh, { heelDeg: 0, trimDeg: 0, h: 0 }, x);
  const zMin = sideAt(form.view, x, "zMin");
  if (!(s.areaM2 > 0) || s.yPort == null || s.yStbd == null || zMin == null) return null;
  const B = s.yPort - s.yStbd;
  const T = -zMin;
  if (!(B > 0 && T > 0)) return null;
  const t = Math.max(0, (4 * (B * T - s.areaM2)) / (B * B));
  return { deg: Math.atan(t) / RAD, atX: x, beamM: B };
}

export const CLARKE_SOURCE =
  "Clarke, Gedling & Hine (1983), 'The application of manoeuvring criteria in hull design using linear theory', Trans. RINA 125: Y'v = −π(T/L)²(1 + 0.40·Cb·B/T), N'v = −π(T/L)²(0.5 + 2.4·T/L), as reproduced in a Mathcad worksheet on ptcusercommunity.com (retrieved 2026-11-06); the paper was not checked. A regression on ships, applied to the canoe body: an extrapolation.";

/** The canoe body's linear sway derivatives (Clarke), magnitudes. */
export function hullDerivatives(h, lateralCentroid) {
  const tl = h.tc / h.lwl;
  return {
    lwl: h.lwl,
    yv: Math.PI * tl * tl * (1 + 0.4 * h.cb * (h.bwl / h.tc)),
    nv: Math.PI * tl * tl * (0.5 + 2.4 * tl),
    xMid: (h.xFwd + h.xAft) / 2,
    at: lateralCentroid ?? [h.lcb, -h.tc / 2],
  };
}

/** The foil numbers the VPP needs (the heel-dependent ones it recomputes). */
const foilData = (f, extra = {}) =>
  f && {
    id: f.id,
    kind: f.kind,
    areaM2: f.areaM2,
    arGeom: f.arGeom,
    endPlateFactor: f.endPlateFactor,
    sweepHalfDeg: f.sweepHalfDeg,
    qc: f.qc,
    stallDeg: f.stallDeg,
    mac: f.mac,
    tc: f.tc,
    taper: f.taper,
    bulb: f.bulb ? { length: f.bulb.length, diameter: f.bulb.diameter } : null,
    ...extra,
  };

/**
 * @param {{ doc: object, n: object }} x n: computeNumbers(doc, ctx)
 * @returns {object} the design, or { ok: false, why }
 */
export function buildDesign({ doc, n }) {
  const form = n.form;
  const a = n.analysis;
  if (!form) return { ok: false, why: "no hull floated yet: the performance model needs the hull's form" };
  if (!a.mass) return { ok: false, why: "no displacement: the performance model needs her weight" };
  const notes = [];
  const h = form.hydro;
  const hull = dsyhsHull(h);
  const env = envelope(hull);

  // righting: the table's curve, else upright GM (approximate)
  const stab = a.stab;
  let rm;
  if (stab?.points?.length) {
    const run = [];
    for (const p of stab.points) {
      if (!p.available || p.heelDeg > 90) break;
      run.push(p);
    }
    rm = { source: "table", heels: run.map((p) => p.heelDeg), boat: run.map((p) => p.rmBoat), crew: run.map((p) => p.crewRm) };
    const wsa = run.map((p) => p.wsa);
    rm.wsa = wsa.every(fin) ? wsa : null;
  } else {
    const gm = a.gm?.GM;
    if (!(gm > 0)) return { ok: false, why: "no positive upright GM: she isn't stable upright" };
    const W = a.mass.massKg * G;
    const heels = Array.from({ length: 13 }, (_, i) => i * 2.5);
    rm = {
      source: "gm",
      heels,
      boat: heels.map((d) => W * gm * Math.sin(d * RAD)),
      crew: heels.map((d) => a.mass.crew.massKg * G * a.mass.crew.arm * Math.cos(d * RAD)),
      wsa: null,
    };
    notes.push("Righting moment from the upright GM (sin φ) until the hydrostatic table is built.");
  }
  if (!rm.wsa) notes.push("Wetted area upright at every heel until the hydrostatic table is built.");

  // planing bottom
  const W = a.mass.massKg * G;
  const dGiven = doc.hull.dims.deadriseDeg;
  const dr = fin(dGiven) ? { deg: dGiven, given: true } : deadriseOf(form);
  const lcg = a.mass.G[0] - h.xAft;
  const lt = a.mass.massKg / 1016.0469088;
  const dL = lt / (0.01 * (h.lwl / 0.3048)) ** 3;
  const planing = {
    capability: planingCapability(dL),
    dL,
    weightN: W,
    beam: h.bwl,
    deadriseDeg: dr ? dr.deg : 10,
    deadriseFrom: dr?.given ? "given" : dr ? "estimated from the hull's section 20% of LWL forward of its aft end" : "estimated, 10° (no section to read)",
    lcg,
  };

  // foils
  const app = a.app;
  const keel = foilData(app.keel);
  const rudder = foilData(app.rudder, { maxDeg: doc.appendages.rudder.maxDeg });
  const bottom = Math.min(form.keelZ, ...app.foils.map((f) => f.bottomZ));
  const draftT = -bottom;

  // sail sets: full, then each reef of the main
  const plan = n.plan;
  const mainReefs = plan.sails.find((s) => s.id === "main")?.reefs ?? [];
  const sets = [];
  for (let reef = -1; reef < mainReefs.length; reef++) {
    const sails = rigSails(plan, { reef });
    if (!sails.length) continue;
    const span = rigSpan(plan, sails);
    const ce = combineCE(sails).ce;
    sets.push({
      id: reef < 0 ? "full" : `reef${reef + 1}`,
      label: reef < 0 ? "Full sail" : `Reef ${reef + 1}`,
      reef,
      areaM2: span.areaM2,
      ce,
      he: span.he,
      are: span.are,
      sails: sails.map((s) => ({ id: s.id, kind: s.kind, areaM2: s.areaM2, ce: s.ce, luffM: s.luffM, ar: s.ar, slope: s.slope, sheet: SAIL_KINDS[s.kind].sheet })),
    });
  }
  if (!sets.length) return { ok: false, why: "no sails" };

  const c = doc.conditions;
  return {
    ok: true,
    title: doc.title,
    hull: { ...hull, xFwd: h.xFwd, xAft: h.xAft, lcbX: h.lcb, lateral: form.lateral.centroid, envelope: env },
    massKg: a.mass.massKg,
    G: a.mass.G,
    rhoWater: RHO_SEA,
    rm,
    planing,
    draftT,
    keelTaper: keel?.taper ?? 0.5,
    keel,
    rudder,
    downwash: a.balance.downwashGradient,
    hullSide: hullDerivatives(h, form.lateral.centroid),
    sets,
    heelLimitDeg: c.heelLimitDeg,
    conditions: { tws: [...c.tws], twa: [...c.twa], reference: { ...c.reference } },
    notes,
  };
}
