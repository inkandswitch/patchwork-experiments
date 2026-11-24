// Geometric balance: the centre of lateral resistance three ways, and the
// lead of the centre of effort over it, against cited bands. Pure, no DOM.
//
// Lead is (x_CE − x_CLR) / LWL, + when the CE is forward of the CLR, with the
// designer's CE (main triangle + 100% foretriangle), which is what lead
// tables are written for.
//
// The three CLRs:
// - Larsson & Eliasson's "extended keel": the keel's quarter-chord line
//   extended up to the waterline, and the point on it at 0.45 of its depth
//   below the waterline (our reading of the secondhand description). The
//   lead bands below are for this CLR. A long keel, and a boat with no fin,
//   use the canoe body + keel centroid instead.
// - The whole underwater profile's centroid: canoe body, keel, bulb and
//   rudder, by area. The traditional CLR, and the bottom of the heeling arm.
// - The foils' hydrodynamic centre: keel and rudder quarter-chord points
//   weighted by lift slope × area, the rudder's slope reduced by the keel's
//   downwash (1 − dε/dα). The canoe body is left out: its side force and
//   Munk moment are the VPP's (design.js hullDerivatives).
//
// None of these is the helm. The helm (the rudder angle that balances yaw)
// needs the sail and hull forces: it is the VPP's (vpp.js), read at the
// reference point (numbers.js).

import { combineCE } from "./sailplan.js";

export const LE_SOURCE =
  "Estimated, secondhand: Larsson & Eliasson, Principles of Yacht Design, ch. 8 (balance), lead of the designer's CE over the extended-keel CLR, % of LWL, as quoted on boatdesign.net (\"A question of lead…\", Ja guar, 2014-11-14; \"lead of CE over CLR\", vic bauwens, 2013-09-08), retrieved 2026-11-06. The book was not checked. Only the fractional fin-keel band, 3–7%, is the quote's; the masthead fin-keel (5–9%) and long-keel (masthead 12–16%, fractional 10–14%) bands are rules of thumb from the same threads that were not traced to a quote here. No figure was found for a cat or a cutter. A lead rule absorbs what a force model leaves out (this one: the hull's heel-induced yaw), so it and the VPP's helm can disagree.";

/** [lo, hi] % of LWL, by keel family and rig type. All estimated (see LE_SOURCE). */
export const LEAD_BANDS = {
  fin: { masthead: [5, 9], fractional: [3, 7] },
  long: { masthead: [12, 16], fractional: [10, 14] },
};

export const keelFamily = (kind) => (kind === "long" ? "long" : kind === "none" ? null : "fin");

/** The band for a rig type and keel kind, and where a lead (fraction) sits on it. */
export function leadBand(rigType, keelKind, lead) {
  const fam = keelFamily(keelKind);
  const b = fam ? LEAD_BANDS[fam][rigType] : null;
  if (!b) {
    const why = !fam ? "no keel" : rigType === "cat" ? "a cat rig" : rigType === "cutter" ? "a cutter" : rigType;
    return { label: `no band quoted for ${why}`, range: null };
  }
  const pct = lead * 100;
  const range = `${b[0]}–${b[1]}% (${fam === "fin" ? "fin keel" : "long keel"}, ${rigType}; est.)`;
  if (!Number.isFinite(pct)) return { label: range, range: b };
  // too little lead (the CE nearly over the CLR) carries weather helm; too much, lee helm
  if (pct < b[0]) return { label: `below ${range}: toward weather helm`, range: b, out: true };
  if (pct > b[1]) return { label: `above ${range}: toward lee helm`, range: b, out: true };
  return { label: `within ${range}`, range: b };
}

/** Where the keel's quarter-chord line, extended to the waterline, is at 0.45 of its depth. */
export function extendedKeelCLR(keel) {
  const { rootLE, tipLE } = keel.corners;
  const a = [rootLE[0] - keel.rootChord / 4, rootLE[1]];
  const b = [tipLE[0] - keel.tipChord / 4, tipLE[1]];
  const depth = -b[1];
  if (!(depth > 0) || Math.abs(b[1] - a[1]) < 1e-9) return null;
  const z = -0.45 * depth;
  const t = (z - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), z];
}

/**
 * @param {{ plan: object, lateral: { areaM2: number, centroid: number[]|null }, app: ReturnType<import("./foils.js").appendagesOf>,
 *           lwl: number, rigType: string }} x
 */
export function balanceOf({ plan, lateral, app, lwl, rigType }) {
  const canoe = lateral?.areaM2 > 0 && lateral.centroid ? { areaM2: lateral.areaM2, ce: lateral.centroid } : null;
  const keel = app.keel;
  const rudder = app.rudder;
  const parts = (withRudder) => [
    canoe,
    keel && { areaM2: keel.areaM2, ce: keel.centroid },
    keel?.bulb && { areaM2: keel.bulb.lateralAreaM2, ce: keel.bulb.centre },
    withRudder && rudder && { areaM2: rudder.areaM2, ce: rudder.centroid },
  ];
  const whole = combineCE(parts(true));
  const noRudder = combineCE(parts(false));

  const fam = keelFamily(keel?.kind ?? "none");
  let le = null, leMethod;
  if (keel && fam === "fin") {
    le = extendedKeelCLR(keel);
    leMethod = "extended keel";
  }
  if (!le) {
    le = noRudder.ce;
    leMethod = keel ? "canoe body and keel" : "canoe body alone";
  }

  // foils' hydrodynamic centre
  let hc = null, dEps = 0;
  if (keel || rudder) {
    dEps = keel ? keel.liftSlope / (Math.PI * keel.arEff) : 0;
    const w = [];
    if (keel) w.push({ areaM2: keel.liftSlope * keel.areaM2, ce: keel.qc });
    if (rudder) w.push({ areaM2: rudder.liftSlope * rudder.areaM2 * Math.max(0, 1 - dEps), ce: rudder.qc });
    hc = combineCE(w).ce;
  }

  const ceD = plan.designer.ce;
  const ceA = plan.actual.ce;
  const lead = (ce, clr) => (ce && clr && lwl > 0 ? (ce[0] - clr[0]) / lwl : NaN);
  const leadLE = lead(ceD, le);
  return {
    clrLE: le,
    clrMethod: leadMethodText(leMethod),
    clrWhole: whole.ce,
    lateralAreaM2: whole.areaM2,
    clrNoRudder: noRudder.ce,
    hc,
    downwashGradient: dEps,
    lead: leadLE,
    leadBand: leadBand(rigType, keel?.kind ?? "none", leadLE),
    leadWhole: lead(ceD, whole.ce),
    leadActualWhole: lead(ceA, whole.ce),
    rudderShare: rudder && whole.areaM2 > 0 ? rudder.areaM2 / whole.areaM2 : 0,
  };
}

const leadMethodText = (m) =>
  m === "extended keel"
    ? "Larsson & Eliasson's extended keel: the keel's quarter-chord line extended to the waterline, at 0.45 of its depth"
    : m === "canoe body and keel"
      ? "centroid of the canoe body and keel (no fin to extend)"
      : "centroid of the canoe body (no keel)";
