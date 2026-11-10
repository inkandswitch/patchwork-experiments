// Mass and stability: what she weighs and where, how hard she stands up, how
// hard the wind lays her over, where those meet, and the rig loads that
// follow. Pure, no DOM.
//
// Frame: the rig frame (x forward, y port, z up, m; the floated waterplane at
// z = 0). A Chartroom table in another frame is reached through `toTable`
// (hull-form.js rigToTable).
//
// What this module states (and the contract spec will repeat):
//
// Mass roll-up. Items: rig (mast, boom, standing rigging, sails), ballast,
// non-ballast foils (rudder, centreboard, daggerboard), crew, and the
// lightship (hull, deck, fit-out). The total is the displacement the hull
// floats at. With no lightship given, the lightship is the remainder
// (displacement − everything else), estimated. With one given, whatever the
// roll-up misses is an "unaccounted" item on the DWL above the LCB, and a
// warning says how much. The lightship's LCG is set so that she floats at
// her design trim: the statics table is read at fixed trim, so trim is not
// modelled here.
//
// Estimates (each marked estimated where shown, to be replaced by given
// figures or camber's weight sheet):
// - mast kg/m = 0.025·L² (L the mast's length, step to masthead): a rule fitted
//   by eye to typical aluminium sections (about 1 kg/m at 6.4 m, 5.6 kg/m at
//   15 m). To verify;
// - boom 0.6 × the mast's kg/m over E; standing rigging 25% of the mast's
//   mass at mid-mast (none on a cat rig, taken as unstayed); sails 0.30 kg/m²
//   at their centres;
// - lightship VCG: the hull's mid-depth (sheer to canoe bottom) at the LCB, a
//   shell's surface centroid.
// - crew stations by mode, at the half-breadth b of the hull at the station
//   (0.2·LWL aft of the LCB): sitting in 0.6·b and at the sheer; on the rail
//   b + 0.15 m and 0.35 m above the sheer; hiking b + 0.45 m, 0.25 m above;
//   trapeze b + 1.0 m, 0.6 m above. A given arm replaces these.
//
// Righting. The table is the canoe body only. The canoe body is immersed to
// ∇ − ∇_app (the appendages' volume) and the appendages' buoyancy is added
// as a rigid body: GZ = (∇_c·GZ_c + ∇_app·GZ_app)/∇. The crew is in G on the
// centreline at their height; their windward shift adds m_c·g·arm·cos φ:
//   RM(φ) = Δ·g·GZ(φ) + m_c·g·arm·cos φ.
// Appendages are taken as always immersed (true until the keel lifts out,
// near 90°).
//
// Heeling. The stability view's wind heeling moment is the classical form
// (Skene's; Marchaj):
//   HM(φ) = ½·ρ_air·AWS²·A·C_H·h·cos²φ,  ρ_air = 1.225 kg/m³,
// A the sail area set and h the height of its CE above the whole underwater
// profile's centroid (the geometric CLR). C_H is the sail model's (sails.js)
// heeling-force coefficient for that set trimmed for drive close-hauled, at
// an apparent wind of CH_BETA = 30°, not flattened (a set without one falls
// back to the old stand-in C_H = 1.0). Winds are apparent. The VPP
// (vpp.js) solves the heel properly, with the sails trimmed and flattened. Steady heel: the first φ where RM = HM, up to the heel of
// maximum RM. Reef wind: the AWS at which a sail set reaches the heel limit,
// AWS = √(2·RM(φ_lim) / (ρ_air·A·C_H·h·cos²φ_lim)).
//
// Dellenbaugh angle (Skene's Elements of Yacht Design): the heel under a
// 1 lb/ft² (47.88 Pa) wind pressure on the designer's sail area, by the
// small-angle GM: φ_D = 57.3·SA·HA·47.88/(Δ·g·GM).
//
// Loads (static, no safety factor, no rig pretension):
// - RM30, the righting moment at 30° with the crew as set;
// - windward chainplates' vertical load RM30/b, b = 0.9 × the half-breadth at
//   the mast (estimated chainplate base); the mast's compression is the same;
// - sheet loads by Harken's rule, lb = SA ft² × AWS kn² × 0.00431 (Harken
//   catalogue, as widely reproduced; riggingdoctor.com gives it with mph,
//   which would be 1.32× lower), at the reef wind; the main's version is the
//   same rule on the main's area × (1 + roach) (Harken's note on roach),
//   the load at the clew. Halyard loads: no rule found; not estimated.
// - rudder-stock torque at hull speed, the larger of: at stall (CL_max on
//   the MAC's quarter chord) and stalled at maxDeg (normal-force coefficient
//   1.1 at 0.40 of the MAC, estimated), about a stock stockFrac of the MAC
//   aft of its leading edge.

import { RHO_SEA, FT, KNOT, LBF, qty } from "./units.js";
import { G as GRAV } from "./ratios.js";
import { rotationRows } from "./mesh-hydro.js";
import { rightingCurve, curveReadouts, uprightKM } from "./statics.js";
import { combineCE } from "./sailplan.js";
import { FOIL_DENSITY } from "./foils.js";

export const RHO_AIR = 1.225;
export const C_HEEL = 1.0;
/** The apparent wind angle the stability view's C_H is read at, degrees. */
export const CH_BETA = 30;
export const SAIL_KG_M2 = 0.3;
export const BOOM_KG_FRAC = 0.6;
export const RIGGING_FRAC = 0.25;
export const PSF = LBF / (FT * FT); // 47.880 Pa
export const HARKEN_SHEET = 0.00431; // lb per (ft² · kn²)
export const STALLED_CN = 1.1;
export const STALLED_CP = 0.4;

const RAD = Math.PI / 180;
const fin = (v) => Number.isFinite(v);

/** Mast kg/m for a mast of length L (m), estimated. */
export const mastKgPerM = (L) => 0.025 * L * L;

/** Crew station rules by mode: [arm beyond the half-breadth (or × it), height above the sheer]. */
export const CREW_STATIONS = {
  none: null,
  sitting: { armOf: (b) => 0.6 * b, dz: 0 },
  rail: { armOf: (b) => b + 0.15, dz: 0.35 },
  hiking: { armOf: (b) => b + 0.45, dz: 0.25 },
  trapeze: { armOf: (b) => b + 1.0, dz: 0.6 },
};

/** The crew: mass, station and arm. */
export function crewOf(crewDoc, { x, sheerZ, halfBreadth }) {
  const st = CREW_STATIONS[crewDoc.mode];
  const massKg = st ? Math.max(0, crewDoc.count) * Math.max(0, crewDoc.kgEach) : 0;
  if (!st || !(massKg > 0)) return { massKg: 0, arm: 0, at: [x, 0, sheerZ], mode: crewDoc.mode, armGiven: false };
  const given = fin(crewDoc.arm) && crewDoc.arm >= 0;
  return { massKg, arm: given ? crewDoc.arm : st.armOf(halfBreadth), armGiven: given, at: [x, 0, sheerZ + st.dz], mode: crewDoc.mode };
}

/**
 * The rig's mass items from a laid-out sail plan.
 * @param {object} plan buildSailPlan's
 * @param {{ kgPerM: number|null, stepZ: number, type: string }} o stepZ: where the mast's heel is (partners for deck-stepped)
 */
export function rigItems(plan, { kgPerM = null, stepZ, type }) {
  const [px, pz] = plan.mast.partners;
  const [hx, hz] = plan.mast.head;
  const above = Math.hypot(hx - px, hz - pz);
  if (!(above > 0)) return [];
  const u = [(hx - px) / above, (hz - pz) / above];
  const below = Math.max(0, (pz - stepZ) / u[1]);
  const L = above + below;
  const step = [px - u[0] * below, pz - u[1] * below];
  const kgm = fin(kgPerM) && kgPerM > 0 ? kgPerM : mastKgPerM(L);
  const est = !(fin(kgPerM) && kgPerM > 0);
  const mid = [(step[0] + hx) / 2, (step[1] + hz) / 2];
  const items = [
    { id: "mast", name: `Mast, ${L.toFixed(2)} m at ${kgm.toFixed(2)} kg/m`, kind: "rig", massKg: kgm * L, at: [mid[0], 0, mid[1]], estimated: est, lengthM: L, kgPerM: kgm, step },
  ];
  if (plan.boom) {
    const g = plan.boom.gooseneck, e = plan.boom.end;
    items.push({ id: "boom", name: "Boom", kind: "rig", massKg: BOOM_KG_FRAC * kgm * Math.abs(g[0] - e[0]), at: [(g[0] + e[0]) / 2, 0, g[1]], estimated: true });
  }
  if (type !== "cat") items.push({ id: "rigging", name: "Standing rigging", kind: "rig", massKg: RIGGING_FRAC * kgm * L, at: [(px + hx) / 2, 0, (pz + hz) / 2], estimated: true });
  for (const s of plan.sails) items.push({ id: `sail-${s.id}`, name: `Sail: ${s.id}`, kind: "rig", massKg: SAIL_KG_M2 * s.areaM2, at: [s.ce[0], 0, s.ce[1]], estimated: true });
  return items;
}

/**
 * The mass roll-up.
 * @param {{ doc: object, plan: object, app: object, displacementKg: number,
 *           hull: { lcb: number, lwl: number, bottomZ: number, mastStepZ: number, sheerAt: (x:number)=>number, halfBreadthAt: (x:number)=>number, midDepthZ: number },
 *           isEstimated?: (path: string) => boolean }} x
 */
export function massRollup({ doc, plan, app, displacementKg, hull, isEstimated = () => false }) {
  const warnings = [];
  const items = [];
  const L = doc.loading;
  // where her buoyancy is, appendages included: the lightship's LCG puts G over it
  const Vt = displacementKg / RHO_SEA;
  const Va = Math.min(app.volumeM3, Vt);
  const lcbTotal = Vt > 0 ? ((Vt - Va) * hull.lcb + Va * (app.volumeCentroid?.[0] ?? hull.lcb)) / Vt : hull.lcb;

  items.push(...rigItems(plan, { kgPerM: doc.rig.mast.kgPerM, stepZ: doc.rig.mast.stepped === "keel" ? hull.mastStepZ : plan.mast.partners[1], type: plan.type }));

  // ballast
  const bk = Math.max(0, L.ballast.kg);
  if (bk > 0) {
    let at = L.ballast.at;
    const keel = app.keel;
    let where = null, how = "";
    if (at === "bulb" && keel?.bulb) [where, how] = [keel.bulb.centre, "in the bulb"];
    else if ((at === "bulb" || at === "keel") && keel?.volumeCentroid) [where, how] = [keel.volumeCentroid, "in the keel"];
    else [where, how] = [[lcbTotal, hull.bottomZ + 0.1], "inside the hull, at the bottom"];
    if (at === "bulb" && !keel?.bulb) warnings.push(`Ballast is set to the bulb, but the keel has none: it is taken ${how}.`);
    items.push({ id: "ballast", name: `Ballast, ${how}`, kind: "ballast", massKg: bk, at: [where[0], 0, where[1]], estimated: isEstimated("loading.ballast.kg") });
  }

  // non-ballast foils
  for (const f of app.foils) {
    const ballastFoil = f.id === "keel" && (f.kind === "fin" || f.kind === "fin-bulb" || f.kind === "long");
    if (ballastFoil || !f.volumeCentroid) continue;
    items.push({ id: `${f.id}-structure`, name: `${f.id === "keel" ? "Board" : "Rudder"} (structure)`, kind: "appendage", massKg: FOIL_DENSITY * f.volumeM3, at: [f.volumeCentroid[0], 0, f.volumeCentroid[1]], estimated: true });
  }

  // crew
  const cx = lcbTotal - 0.2 * hull.lwl;
  const crew = crewOf(L.crew, { x: cx, sheerZ: hull.sheerAt(cx), halfBreadth: hull.halfBreadthAt(cx) });
  if (crew.massKg > 0) items.push({ id: "crew", name: `Crew, ${L.crew.count} × ${L.crew.kgEach} kg (${L.crew.mode})`, kind: "crew", massKg: crew.massKg, at: crew.at, estimated: isEstimated("loading.crew.count") });

  // lightship, or what's unaccounted
  const parts = items.reduce((s, i) => s + i.massKg, 0);
  const lsGiven = fin(L.lightship.kg) && L.lightship.kg > 0;
  const lsZ = fin(L.lightship.vcg) ? L.lightship.vcg : hull.midDepthZ;
  const lsZest = !fin(L.lightship.vcg);
  let lightship;
  if (lsGiven) {
    lightship = { id: "lightship", name: "Lightship (hull, deck, fit-out), given", kind: "lightship", massKg: L.lightship.kg, at: [lcbTotal, 0, lsZ], estimated: lsZest };
    items.push(lightship);
    const rest = displacementKg - parts - L.lightship.kg;
    if (Math.abs(rest) > 0.01 * displacementKg) {
      warnings.push(
        rest > 0
          ? `The mass roll-up is ${qty(rest, "mass")} short of the displacement she floats at; it is carried as "unaccounted" on the DWL above the LCB.`
          : `The mass roll-up is ${qty(-rest, "mass")} heavier than the displacement she floats at: raise the displacement or check the masses.`,
      );
    }
    if (Math.abs(rest) > 1e-9) items.push({ id: "unaccounted", name: "Unaccounted (displacement − roll-up)", kind: "lightship", massKg: rest, at: [lcbTotal, 0, 0], estimated: true });
  } else {
    const m = displacementKg - parts;
    if (m < 0) warnings.push(`Ballast, rig, crew and foils weigh ${qty(parts, "mass")}, more than the ${qty(displacementKg, "mass")} displacement: there is nothing left for the hull.`);
    lightship = { id: "lightship", name: "Lightship (hull, deck, fit-out): the remainder", kind: "lightship", massKg: m, at: [lcbTotal, 0, lsZ], estimated: true };
    items.push(lightship);
  }
  // put G over the buoyancy: the lightship's LCG takes up the difference
  const others = items.filter((i) => i !== lightship);
  const mOthers = others.reduce((s, i) => s + i.massKg, 0);
  const mxOthers = others.reduce((s, i) => s + i.massKg * i.at[0], 0);
  if (Math.abs(lightship.massKg) > 1e-6) lightship.at[0] = (displacementKg * lcbTotal - mxOthers) / lightship.massKg;
  else if (Math.abs(mxOthers / (mOthers || 1) - lcbTotal) > 0.01 * hull.lwl) warnings.push("With no lightship mass to move, G isn't over the LCB: she would trim, which the fixed-trim table doesn't show.");

  const massKg = items.reduce((s, i) => s + i.massKg, 0);
  const G = [0, 1, 2].map((k) => items.reduce((s, i) => s + i.massKg * i.at[k], 0) / (massKg || 1));
  // the crew sits on the centreline in G; their arm is applied separately
  return { items, massKg, G, crew, lightship, lcbTotal, volumeM3: Vt, appVolumeM3: Va, warnings, riggedMassKg: items.filter((i) => i.kind === "rig").reduce((s, i) => s + i.massKg, 0) };
}

/**
 * Upright GM from the floated hull's hydrostatics with the appendages added.
 * @param {object} hydro uprightHydrostatics (canoe body at the full displacement)
 */
export function uprightGM(hydro, mass, app) {
  const V = mass.volumeM3;
  const Va = mass.appVolumeM3;
  const zB = V > 0 ? ((V - Va) * hydro.vcb + Va * (app.volumeCentroid?.[1] ?? 0)) / V : NaN;
  const IT = hydro.bmt * hydro.volumeM3;
  const BM = IT / V;
  return { zB, BM, zM: zB + BM, GM: zB + BM - mass.G[2], KG: mass.G[2] - hydro.kRefZ, vcg: mass.G[2] };
}

const rot = (R, v) => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/**
 * The righting curve with the appendages and the crew.
 * @param {object} table Chartroom hydrostatic-table v1
 * @param {{ toTable?: (p: number[]) => number[], trimDeg?: number, mass: ReturnType<typeof massRollup>, app: object, heels: number[] }} o
 * @returns {{ points: object[], readouts: object, gmTable: number|null }}
 */
export function stabilityCurve(table, { toTable = (p) => p, trimDeg = 0, mass, app, heels }) {
  const V = mass.volumeM3;
  const Va = mass.appVolumeM3;
  const Vc = V - Va;
  const G = toTable(mass.G);
  // the keel and rudder displacing the whole boat (a full-size keel under a model-sized hull): nothing left for the canoe body
  if (!(Vc > 0)) {
    const reason = `the keel and rudder displace ${qty(Va, "volume", 3)}, as much as the whole boat (${qty(V, "volume", 3)})`;
    const points = heels.map((heelDeg) => ({ heelDeg, trimDeg, available: false, reason }));
    return { points, readouts: curveReadouts(points), gmTable: null };
  }
  const Ba = app.volumeCentroid ? toTable([app.volumeCentroid[0], 0, app.volumeCentroid[1]]) : null;
  const canoe = rightingCurve(table, { volumeM3: Vc, G }, heels, { trimDeg });
  const W = mass.massKg * GRAV;
  const crewW = mass.crew.massKg * GRAV;
  const points = canoe.map((p) => {
    if (!p.available) return p;
    let gz = p.gz;
    if (Ba && Va > 0) {
      const R = rotationRows(p.heelDeg, p.trimDeg ?? trimDeg);
      const q = rot(R, [Ba[0] - G[0], Ba[1] - G[1], Ba[2] - G[2]]);
      gz = (Vc * p.gz + Va * -q[1]) / V;
    }
    const crewRm = crewW * mass.crew.arm * Math.cos(p.heelDeg * RAD);
    const rmBoat = W * gz;
    return { ...p, gz, gzCanoe: p.gz, rmBoat, crewRm, rm: rmBoat + crewRm };
  });
  // GM from the table: KB + I/V of the canoe body at Vc, with the appendages
  let gm = null;
  const km = uprightKM(table, Vc, { trimDeg });
  if (km.available && fin(km.kmt)) {
    const K = table.frame.knReferenceM;
    const zBc = K[2] + km.kb;
    const IT = (km.kmt - km.kb) * Vc;
    const zB = (Vc * zBc + Va * (Ba?.[2] ?? zBc)) / V;
    gm = zB + IT / V - G[2];
  }
  return { points, readouts: curveReadouts(points), gmTable: gm };
}

/** Linear interpolation of RM (or any key) on a curve's available run from 0. */
export function curveAt(points, heelDeg, key = "rm") {
  let prev = null;
  for (const p of points) {
    if (!p.available) return null;
    if (p.heelDeg === heelDeg) return p[key];
    if (p.heelDeg > heelDeg) return prev ? prev[key] + ((p[key] - prev[key]) * (heelDeg - prev.heelDeg)) / (p.heelDeg - prev.heelDeg) : null;
    prev = p;
  }
  return null;
}

/** A set of sails: the full plan, or the main reefed (the headsail as set). */
export function sailSets(plan) {
  const sets = [{ id: "full", label: "Full sail", areaM2: plan.actual.areaM2, ce: plan.actual.ce }];
  const main = plan.sails.find((s) => s.id === "main");
  const rest = plan.sails.filter((s) => s.id !== "main");
  (main?.reefs ?? []).forEach((r, i) => {
    const c = combineCE([{ areaM2: r.areaM2, ce: r.ce }, ...rest]);
    sets.push({ id: `reef${i + 1}`, label: `Reef ${i + 1} (${Math.round(r.fraction * 100)}% of P)`, areaM2: c.areaM2, ce: c.ce });
  });
  return sets.filter((s) => s.areaM2 > 0 && s.ce);
}

/** Wind heeling moment (N·m) at an apparent wind (m/s) and heel, for a sail set over a CLR height (C_H the set's, else 1.0). */
export function heelingMoment(awsMs, heelDeg, set, clrZ, ch = set.ch ?? C_HEEL) {
  const h = set.ce[1] - clrZ;
  return 0.5 * RHO_AIR * awsMs * awsMs * set.areaM2 * ch * h * Math.cos(heelDeg * RAD) ** 2;
}

/**
 * Steady heel where RM(φ) = HM(φ), searched up to the heel of maximum RM.
 * @returns {{ heelDeg: number|null, state: "upright"|"steady"|"overpowered"|"unknown" }}
 */
export function steadyHeel(points, hm) {
  const run = [];
  for (const p of points) {
    if (!p.available) break;
    run.push(p);
  }
  if (run.length < 2) return { heelDeg: null, state: "unknown" };
  let iMax = 0;
  for (let i = 1; i < run.length; i++) if (run[i].rm > run[iMax].rm) iMax = i;
  const f = (p) => p.rm - hm(p.heelDeg);
  if (run[0].heelDeg === 0 && f(run[0]) >= 0) return { heelDeg: 0, state: "upright" };
  for (let i = 1; i <= iMax; i++) {
    const a = run[i - 1], b = run[i];
    const fa = f(a), fb = f(b);
    if (fa < 0 && fb >= 0) {
      // refine on the linear RM between the two points against the exact HM
      let lo = a.heelDeg, hi = b.heelDeg;
      const rmAt = (d) => a.rm + ((b.rm - a.rm) * (d - a.heelDeg)) / (b.heelDeg - a.heelDeg);
      for (let k = 0; k < 50; k++) {
        const m = (lo + hi) / 2;
        if (rmAt(m) - hm(m) < 0) lo = m;
        else hi = m;
      }
      return { heelDeg: (lo + hi) / 2, state: "steady" };
    }
  }
  return { heelDeg: null, state: iMax === run.length - 1 && run.length < points.length ? "unknown" : "overpowered" };
}

/** The apparent wind at which a sail set reaches a heel (m/s), or null. */
export function windForHeel(points, heelDeg, set, clrZ) {
  const rm = curveAt(points, heelDeg);
  const hmUnit = heelingMoment(1, heelDeg, set, clrZ);
  if (!(rm > 0) || !(hmUnit > 0)) return null;
  return Math.sqrt(rm / hmUnit);
}

/** Dellenbaugh angle, degrees. */
export function dellenbaugh({ saM2, heelingArmM, massKg, gm }) {
  if (!(gm > 0) || !(massKg > 0)) return null;
  return (180 / Math.PI) * ((saM2 * heelingArmM * PSF) / (massKg * GRAV * gm));
}

/** Harken's sheet-load rule, N, for an area (m²) and apparent wind (m/s). */
export const harkenSheetN = (areaM2, awsMs) => (areaM2 / (FT * FT)) * (awsMs / KNOT) ** 2 * HARKEN_SHEET * LBF;

/** Rudder-stock torque (N·m) at a water speed: the larger of at stall and stalled at maxDeg. */
export function rudderTorque(rudder, { speedMs, stockFrac, maxDeg }) {
  if (!rudder) return null;
  const q = 0.5 * RHO_SEA * speedMs * speedMs;
  const atStall = q * rudder.areaM2 * rudder.clMax * (0.25 - stockFrac) * rudder.mac;
  const stalled = maxDeg > rudder.stallDeg ? q * rudder.areaM2 * STALLED_CN * (STALLED_CP - stockFrac) * rudder.mac : -Infinity;
  const nm = Math.max(atStall, stalled);
  return { nm, atStallNm: atStall, stalledNm: Number.isFinite(stalled) ? stalled : null, speedMs };
}
