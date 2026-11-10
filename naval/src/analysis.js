// The lateral plane, the masses and the stability of a design, composed from
// the doc, the sail plan and the floated hull. Pure (no DOM): numbers.js turns
// it into readouts, profile.js draws it, and later the contract carries it.

import { qty } from "./naval/units.js";
import { appendagesOf } from "./naval/foils.js";
import { balanceOf } from "./naval/balance.js";
import {
  massRollup,
  uprightGM,
  stabilityCurve,
  sailSets,
  heelingMoment,
  steadyHeel,
  windForHeel,
  dellenbaugh,
  harkenSheetN,
  rudderTorque,
  curveAt,
} from "./naval/stability.js";
import { sideAt } from "./naval/mesh-hydro.js";
import { DEFAULT_HEELS, tableIndex, interpolate } from "./naval/statics.js";
import { rigToTable } from "./naval/hull-form.js";
import { hullSpeed } from "./naval/ratios.js";
import { isEstimated } from "./doc.js";
import { rigSails, rigSpan, tableOf, rigForces } from "./naval/sails.js";
import { CH_BETA } from "./naval/stability.js";

/** A sail set's heeling-force coefficient from the sail model, close-hauled at CH_BETA. */
export function heelCoefficient(plan, reef) {
  const sails = rigSails(plan, { reef });
  if (!sails.length) return null;
  const span = rigSpan(plan, sails);
  const t = tableOf({ sails, are: span.are });
  // q = ½·ρ·AWS² = 1 with ρ = 2, AWS = 1: the force per unit area is the coefficient
  return rigForces(t, { aws: 1, awaDeg: CH_BETA, heelDeg: 0, flat: 1, rho: 2 }).heelForce / t.areaM2;
}

/** Heels for the stability curve: every 2.5° to 90°, then 5° (the table's own grid when built here). */
export const STABILITY_HEELS = DEFAULT_HEELS;

/** The hull, as the lateral plane and the mass model need it: a floated mesh's, or the box's. */
export function hullGeometry(doc, hull, form) {
  const stemX = hull.datum.stemX;
  if (form) {
    const view = form.view;
    const h = form.hydro;
    const bottomAt = (x) => sideAt(view, x, "zMin");
    const sheerAt = (x) => form.sheerAt(x) ?? form.stem[1];
    const half = (x) => {
      const p = sideAt(view, x, "yPort");
      const s = sideAt(view, x, "yStbd");
      return p != null && s != null ? (p - s) / 2 : form.beam / 2;
    };
    const mastX = stemX - doc.rig.mast.aftOfStem;
    return {
      stemX,
      lwl: h.lwl,
      lcb: h.lcb,
      bottomZ: form.keelZ,
      bottomAt,
      sheerAt,
      halfBreadthAt: half,
      midDepthZ: (sheerAt(h.lcb) + (bottomAt(h.lcb) ?? form.keelZ)) / 2,
      mastStepZ: bottomAt(mastX) ?? form.keelZ,
      lateral: form.lateral,
    };
  }
  const d = doc.hull.dims;
  const inside = (x) => x >= hull.stern[0] && x <= hull.stem[0];
  return {
    stemX,
    lwl: d.lwl,
    lcb: 0,
    bottomZ: hull.canoeBottomZ,
    bottomAt: (x) => (inside(x) ? hull.canoeBottomZ : null),
    sheerAt: () => d.freeboard,
    halfBreadthAt: () => d.beam / 2,
    midDepthZ: (d.freeboard + hull.canoeBottomZ) / 2,
    mastStepZ: hull.canoeBottomZ,
    lateral: d.lwl > 0 && d.tc > 0 ? { areaM2: d.lwl * d.tc, centroid: [0, -d.tc / 2], polygon: [] } : null,
  };
}

const tableMaps = new WeakMap();
/** rigToTable for a Chartroom table, memoised per (table, form). */
function toTableFor(table, form, source) {
  if (source !== "chartroom") return { available: true, map: (p) => p, trimDeg: 0 };
  let m = tableMaps.get(table);
  if (!m) tableMaps.set(table, (m = new WeakMap()));
  if (!m.has(form)) m.set(form, rigToTable(table, form));
  return m.get(form);
}

/**
 * @param {{ doc: object, hull: object, form: object|null, plan: object, displacementKg: number,
 *           statics?: { status: string, table?: object, source?: string } }} x
 */
export function analyse({ doc, hull, form, plan, displacementKg, statics }) {
  const geo = hullGeometry(doc, hull, form);
  const app = appendagesOf(doc.appendages, { stemX: geo.stemX, hullBottomAt: geo.bottomAt });
  const lwl = geo.lwl;
  const balance = balanceOf({ plan, lateral: geo.lateral, app, lwl, rigType: plan.type });
  const warnings = [];
  const notes = [];
  const est = (path) => isEstimated(doc, path.split("."));
  const mass = Number.isFinite(displacementKg) && displacementKg > 0 ? massRollup({ doc, plan, app, displacementKg, hull: geo, isEstimated: est }) : null;
  if (mass) warnings.push(...mass.warnings);
  if (mass && mass.appVolumeM3 > 0 && !(mass.volumeM3 - mass.appVolumeM3 > 0))
    warnings.push(
      `The keel and rudder displace ${qty(mass.appVolumeM3, "volume", 3)}, as much as the whole boat (${qty(mass.volumeM3, "volume", 3)} at ${qty(mass.massKg, "mass")}): there is no stability curve. Size the appendages for this hull, or float it at a larger displacement.`,
    );
  const gm = mass && form ? uprightGM(form.hydro, mass, app) : null;
  const clrZ = balance.clrWhole?.[1] ?? -(doc.hull.dims.tc / 2);
  const sets = sailSets(plan).map((s) => ({ ...s, ch: heelCoefficient(plan, s.id === "full" ? -1 : Number(s.id.slice(4)) - 1) ?? undefined }));
  const heelLimit = doc.conditions.heelLimitDeg;

  let stab = null;
  if (mass && form && statics?.status === "ready" && statics.table) {
    const map = toTableFor(statics.table, form, statics.source);
    if (map.available) {
      const { heels } = tableIndex(statics.table);
      const lo = Math.min(...heels), hi = Math.max(...heels);
      const want = STABILITY_HEELS.filter((h) => h >= lo && h <= hi);
      const c = stabilityCurve(statics.table, { toTable: map.map, trimDeg: map.trimDeg, mass, app, heels: want.length ? want : heels });
      // the canoe body's wetted skin at each heel, for the resistance (undefined where the table doesn't say)
      for (const p of c.points) if (p.available) p.wsa = interpolate(statics.table, { heelDeg: p.heelDeg, trimDeg: p.trimDeg ?? map.trimDeg, h: p.h }).wettedAreaM2;
      const winds = doc.conditions.aws.map((aws) => {
        const full = sets[0];
        const hm = (phi) => heelingMoment(aws, phi, full, clrZ);
        return { aws, ...steadyHeel(c.points, hm), hm };
      });
      const reef = sets.map((s) => ({ ...s, aws: windForHeel(c.points, heelLimit, s, clrZ) }));
      const rm30 = curveAt(c.points, 30);
      const rmLimit = curveAt(c.points, heelLimit);
      const crewLimit = curveAt(c.points, heelLimit, "crewRm");
      stab = { ...c, winds, reef, rm30, rm1: curveAt(c.points, 1), crewShare: rmLimit > 0 ? crewLimit / rmLimit : null, source: statics.source };
    } else notes.push(`The hull's Chartroom table can't be lined up with the floated hull: ${map.reason}.`);
  }

  // loads
  let loads = null;
  if (stab) {
    const mastX = plan.mast.partners[0];
    const b = 0.9 * geo.halfBreadthAt(mastX);
    const reefAws = stab.reef[0]?.aws ?? null;
    const main = plan.sails.find((s) => s.id === "main");
    const jib = plan.sails.find((s) => s.id === "jib");
    const rudderDoc = doc.appendages.rudder;
    const vH = hullSpeed(lwl);
    loads = {
      rm30: stab.rm30,
      chainplateBaseM: plan.type === "cat" ? null : b,
      chainplateN: plan.type !== "cat" && stab.rm30 > 0 && b > 0 ? stab.rm30 / b : null,
      atAws: reefAws,
      jibSheetN: jib && reefAws ? harkenSheetN(jib.areaM2, reefAws) : null,
      mainClewN: main && reefAws ? harkenSheetN(main.triangle.areaM2, reefAws) * (1 + main.roach) : null,
      rudder: rudderTorque(app.rudder, { speedMs: vH, stockFrac: rudderDoc.stockFrac, maxDeg: rudderDoc.maxDeg }),
    };
  }

  const designerSet = { areaM2: plan.designer.areaM2, ce: plan.designer.ce };
  const heelingArm = designerSet.ce ? designerSet.ce[1] - clrZ : NaN;
  const dell = mass && gm ? dellenbaugh({ saM2: designerSet.areaM2, heelingArmM: heelingArm, massKg: mass.massKg, gm: stab?.gmTable ?? gm.GM }) : null;

  return { geo, app, balance, mass, gm, clrZ, sets, heelLimit, stab, loads, heelingArm, dellenbaugh: dell, warnings, notes };
}
