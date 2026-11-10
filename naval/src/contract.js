// The rig aid's output: extras.rig, format "patchwork-rig" v1
// (contract/v1/specification.md). Pure: built from a doc and what
// computeNumbers worked out for it (with the hydrostatic table in hand) and
// the VPP's polar for its design. The GLB (glb-rig.js) is drawn from this
// object, so what the scene shows and what the contract states agree.
//
// Everything here is read from the modules that compute it (the sail plan,
// foils, mass roll-up, stability, design, VPP); the few figures made here
// are the hardware geometry fit-out needs and no analysis reads: the
// standing rigging's ends and spreaders, the chainplates, the jib lead
// tracks, the mainsheet band, the halyard exits, the rudder stock's axis, the
// gyradii and the lumped sail for today's sailing. Each one's rule is stated
// next to it and in the spec (§3.8–§3.10).

import { FORMAT, VERSION, AXES, RULES } from "../contract/v1/types.js";
import { DEFAULT_FRAME, normalizeFrame, frameMatrix, glbToFrameMatrix } from "./naval/hull-frame.js";
import { rigSails, rigSpan, coeffTable, tableOf, SAIL_KINDS, INTERACTION, FLAT_MIN, SPAN_FACTOR, CN_EXP } from "./naval/sails.js";
import { combineCE } from "./naval/sailplan.js";
import { resistanceOf } from "./naval/vpp.js";
import { CLARKE_SOURCE } from "./naval/design.js";
import { froudeOf, PLANING_FN, FN_MAX_DISPLACEMENT, RESIDUARY_FN, RESIDUARY_A, HEEL_FN, HEEL_U, TE_UPRIGHT } from "./naval/resistance.js";
import { NU_SEA } from "./naval/foils.js";
import { RHO_AIR } from "./naval/stability.js";
import { G } from "./naval/ratios.js";
import { KNOT, RHO_SEA, formatText } from "./naval/units.js";

export const GENERATOR = "patchwork rig-design 0.1.0";
const RAD = Math.PI / 180;
const fin = (v) => Number.isFinite(v);
const numOrNull = (v) => (fin(v) ? v : null);
/** [x, z] of the profile plane → [x, 0, z]. */
export const lift = (p) => (p ? [p[0], 0, p[1]] : null);
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);

// ───────────────────────────────── rules the contract states (§3.8–§3.10)

/** The chainplates' half-breadth: 0.9 × the hull's half-breadth at the mast (the loads' base). */
export const CHAINPLATE_FRAC = 0.9;
/** The spreaders: one pair, halfway up to the hounds, each reaching the chainplate's half-breadth. */
export const SPREADER_FRAC = 0.5;
/** The headsail's furl range the lead track covers: 0 to 30% (more if the doc's furl is more). */
export const FURL_RANGE = [0, 0.1, 0.2, 0.3];
/** The traveller's half-width: 0.8 × the half-breadth at the boom end (clamped onto the hull). */
export const TRAVELLER_FRAC = 0.8;
/** The mainsheet's boom attachment: this fraction of E aft of the gooseneck (end-boom sheeting). */
export const MAINSHEET_AT_E = 0.95;
/** The lumped sail's CE height up its luff: sailing's CE_HEIGHT (physics.js), copied. */
export const LUMPED_CE_HEIGHT = 0.38;
/** The lightship's own radii of gyration, rules of thumb (to verify): roll 0.35·beam, pitch and yaw 0.25·LOA. */
export const LIGHTSHIP_K = { roll: 0.35, pitchYaw: 0.25 };
/** Default resistance grid: heels and the Froude number axis. */
export const RESISTANCE_HEELS = [0, 5, 10, 15, 20, 25, 30, 35];
export const RESISTANCE_FN_STEP = 0.025;

/** The hull's glTF → contract frame, and its inverse for points (the rig GLB is drawn in the hull's glTF coordinates). */
export function frameOf(doc, form) {
  const glbAxes = doc.hull.link ? normalizeFrame(doc.hull.link.frame) : { ...DEFAULT_FRAME };
  const shift = [0, 0, form.shiftZ];
  const R = frameMatrix(glbAxes);
  // frame = R·glb − shift  ⇒  glb = Rᵀ·(frame + shift)
  const toGlb = (p) => {
    const q = [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];
    return [0, 1, 2].map((j) => R[0][j] * q[0] + R[1][j] * q[1] + R[2][j] * q[2]);
  };
  const dirToGlb = (v) => [0, 1, 2].map((j) => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]);
  return { glbAxes, glbToFrame: glbToFrameMatrix(glbAxes, shift), toGlb, dirToGlb, R, shift };
}

/** Gyradii about G from the mass items: point masses, the mast and boom as rods, the lightship with its own k (§3.4). */
export function gyradii(items, G, { beam, loa }, rods = {}) {
  const I = [0, 0, 0];
  let m = 0;
  for (const it of items) {
    const d = sub3(it.atM ?? it.at, G);
    const mk = it.massKg;
    m += mk;
    I[0] += mk * (d[1] * d[1] + d[2] * d[2]);
    I[1] += mk * (d[0] * d[0] + d[2] * d[2]);
    I[2] += mk * (d[0] * d[0] + d[1] * d[1]);
    const rod = rods[it.id];
    if (rod && rod.lengthM > 0) {
      // a thin rod along unit u: its own inertia mL²/12·(1 − u_i²) about each axis
      const k = (mk * rod.lengthM * rod.lengthM) / 12;
      for (let i = 0; i < 3; i++) I[i] += k * (1 - rod.u[i] * rod.u[i]);
    }
    if (it.kind === "lightship" && it.id === "lightship") {
      const kr = LIGHTSHIP_K.roll * beam, kp = LIGHTSHIP_K.pitchYaw * loa;
      I[0] += mk * kr * kr;
      I[1] += mk * kp * kp;
      I[2] += mk * kp * kp;
    }
  }
  return m > 0 ? I.map((v) => Math.sqrt(Math.max(0, v) / m)) : [0, 0, 0];
}

/** Where the line from a through b first meets the deck (z = deckAt(x)), beyond b. */
function toDeck(a, b, deckAt) {
  const d = sub3(b, a);
  const f = (s) => {
    const p = add3(a, mul3(d, s));
    const z = deckAt(p[0]);
    return p[2] - (fin(z) ? z : 0);
  };
  let lo = 1, hi = 1;
  if (!(f(lo) > 0)) return add3(a, d); // b is at or below the deck already
  for (let i = 0; i < 40 && f(hi) > 0; i++) hi *= 1.5;
  if (f(hi) > 0) return add3(a, mul3(d, hi));
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return add3(a, mul3(d, (lo + hi) / 2));
}

/** A headsail's clew rolled to `furl` (a fraction of LP): the clew slides toward the luff along the LP line. */
export function furledClew(tack, head, clew, furl) {
  const l = sub3(head, tack);
  const t = ((clew[0] - tack[0]) * l[0] + (clew[1] - tack[1]) * l[1] + (clew[2] - tack[2]) * l[2]) / (len3(l) ** 2 || 1);
  const foot = add3(tack, mul3(l, t));
  return add3(foot, mul3(sub3(clew, foot), 1 - furl));
}

/**
 * A headsail's sheet lead on deck for a clew: the line from the luff's
 * midpoint through the clew, carried down to the deck (the rule of thumb
 * that the sheet bisects the clew), at the sail kind's least sheeting angle
 * off the tack (the VPP's limit), to port or starboard.
 */
export function leadFor({ tack, head, clew }, deckAt, minDeg) {
  const mid = mul3(add3(tack, head), 0.5);
  const p = toDeck(mid, clew, deckAt);
  const y = Math.max(0, tack[0] - p[0]) * Math.tan(minDeg * RAD);
  return { port: [p[0], y, p[2]], starboard: [p[0], -y, p[2]] };
}

/**
 * The contract.
 * @param {{ doc: object, n: object, polar?: object|null, source?: object, options?: { coeffStepDeg?: number, resistanceHeels?: number[], resistanceFnStep?: number, resistanceFnTop?: number, trimmed?: boolean } }} x
 *   n: computeNumbers(doc, { linked, statics }) with the table ready; polar: vpp.polar(n.design)
 * @returns {{ ok: true, contract: object } | { ok: false, why: string }}
 */
export function buildContract({ doc, n, polar = null, source = {}, options = {} }) {
  const form = n.form;
  if (!form) return { ok: false, why: "no hull floated: the contract needs the hull's form" };
  const a = n.analysis;
  if (!a.mass) return { ok: false, why: "no displacement: the contract needs her weight" };
  const D = n.design;
  const plan = n.plan;
  const geo = a.geo;
  const h = form.hydro;
  const fr = frameOf(doc, form);
  const deckAt = (x) => geo.sheerAt(x);
  const half = (x) => geo.halfBreadthAt(x);

  // ── frame
  const frame = {
    axes: AXES,
    units: "m",
    originDescription:
      form.kind === "synthetic"
        ? "The synthetic hull's frame: x from mid-LWL of the hull as built, y port, z up, the floated waterplane at z = 0."
        : "The linked hull's own frame after the bow/up choice, lowered so the floated waterplane is z = 0: x and y keep the hull's own origin.",
    glbToFrame: fr.glbToFrame,
    glbAxes: fr.glbAxes,
    design: { heelDeg: 0, trimDeg: 0, waterplaneZM: 0, sourceWaterplaneZM: form.shiftZ, displacementKg: form.float.massKg, volumeM3: form.float.volumeM3, rhoWaterKgM3: form.float.rho },
  };

  // ── hull
  const dsy = D.ok ? D.hull : null;
  const hull = {
    loaM: form.loa,
    beamM: form.beam,
    lwlM: h.lwl,
    bwlM: h.bwl,
    tcM: h.tc,
    xFwdM: h.xFwd,
    xAftM: h.xAft,
    volumeM3: h.volumeM3,
    wsaM2: h.wsaCanoeM2,
    transomWetM2: h.transomWetM2,
    awM2: h.awM2,
    lcbM: h.lcb,
    lcfM: numOrNull(h.lcf),
    vcbM: h.vcb,
    cp: h.cp,
    cm: h.cm,
    cb: h.cb,
    zMetacentreM: fin(h.bmt) ? h.vcb + h.bmt : null,
    halfEntranceDeg: numOrNull(h.halfEntranceDeg),
    stemheadM: lift(form.stem),
    sternM: lift(form.stern),
    keelZM: form.keelZ,
    lateral: { areaM2: form.lateral.areaM2, centroidM: lift(form.lateral.centroid) },
    sideForce: D.ok
      ? { yv: D.hullSide.yv, nv: D.hullSide.nv, lwlM: D.hullSide.lwl, xMidM: D.hullSide.xMid, atM: lift(D.hullSide.at), source: CLARKE_SOURCE }
      : null,
    dsyhs: dsy
      ? { lwlM: dsy.lwl, bwlM: dsy.bwl, tcM: dsy.tc, volumeM3: dsy.volumeM3, awM2: dsy.awM2, cp: dsy.cp, cm: dsy.cm, lcbFppM: dsy.lcbFpp, lcfFppM: numOrNull(dsy.lcfFpp), lcbPct: dsy.lcbPct, wsaM2: dsy.wsaM2 }
      : null,
    envelope: (dsy?.envelope ?? []).map((e) => ({ param: e.id, label: e.label, value: numOrNull(e.value), min: e.min, max: e.max })),
    prov: form.kind === "synthetic" ? "synthetic" : "mesh",
  };

  // ── loading
  const mass = a.mass;
  const mastItem = mass.items.find((i) => i.id === "mast");
  const boomItem = mass.items.find((i) => i.id === "boom");
  const rods = {};
  if (mastItem) {
    const u = sub3(lift(plan.mast.head), lift(mastItem.step));
    const L = len3(u);
    rods.mast = { lengthM: mastItem.lengthM, u: L > 0 ? mul3(u, 1 / L) : [0, 0, 1] };
  }
  if (boomItem && plan.boom) rods.boom = { lengthM: Math.abs(plan.boom.gooseneck[0] - plan.boom.end[0]), u: [1, 0, 0] };
  const items = mass.items.map((i) => ({ id: i.id, name: i.name, kind: i.kind, massKg: i.massKg, atM: [...i.at], estimated: !!i.estimated }));
  const crew = mass.crew;
  const crewDoc = doc.loading.crew;
  const rm = D.ok ? D.rm : null;
  const loading = {
    massKg: mass.massKg,
    cgM: [...mass.G],
    gyradiiM: gyradii(items, mass.G, { beam: form.beam, loa: form.loa }, rods),
    gyradiiBasis: `estimated: each item a point mass, the mast and boom thin rods, the lightship with its own k_roll = ${LIGHTSHIP_K.roll}·beam and k_pitch = k_yaw = ${LIGHTSHIP_K.pitchYaw}·LOA (rules of thumb, to verify)`,
    items,
    crew: {
      count: crewDoc.count,
      kgEach: crewDoc.kgEach,
      mode: crewDoc.mode,
      massKg: crew.massKg,
      armM: crew.arm,
      armGiven: !!crew.armGiven,
      stations: crew.massKg > 0 ? [{ side: "windward", atM: [crew.at[0], crew.arm, crew.at[2]] }] : [],
    },
    righting: rm
      ? { source: rm.source, heelsDeg: [...rm.heels], boatNm: [...rm.boat], crewNm: [...rm.crew], wettedAreaM2: rm.wsa ? [...rm.wsa] : null }
      : { source: "gm", heelsDeg: [], boatNm: [], crewNm: [], wettedAreaM2: null },
    heelLimitDeg: doc.conditions.heelLimitDeg,
  };

  // ── appendages
  const appendages = a.app.foils.map((f) => {
    const out = {
      id: f.id,
      kind: f.kind,
      cornersM: { rootLE: lift(f.corners.rootLE), rootTE: lift(f.corners.rootTE), tipLE: lift(f.corners.tipLE), tipTE: lift(f.corners.tipTE) },
      spanM: f.span,
      rootChordM: f.rootChord,
      tipChordM: f.tipChord,
      sweepDeg: f.sweepDeg,
      sweepHalfDeg: f.sweepHalfDeg,
      tc: f.tc,
      taper: f.taper,
      areaM2: f.areaM2,
      macM: f.mac,
      macFromRootM: f.macFromRoot,
      qcM: lift(f.qc),
      arGeom: f.arGeom,
      endPlateFactor: f.endPlateFactor,
      arEff: f.arEff,
      liftSlope: f.liftSlope,
      stallDeg: f.stallDeg,
      clMax: f.clMax,
      volumeM3: f.volumeM3,
      volumeCentroidM: lift(f.volumeCentroid),
      bulb: f.bulb ? { lengthM: f.bulb.length, diameterM: f.bulb.diameter, centreM: lift(f.bulb.centre), volumeM3: f.bulb.volumeM3 } : null,
      stock: null,
    };
    if (f.id === "rudder") out.stock = stockOf(f, doc.appendages.rudder, deckAt);
    return out;
  });

  // ── sails
  const full = rigSails(plan);
  const step = options.coeffStepDeg ?? 2.5;
  const headsail = doc.rig.headsail;
  const furls = [...new Set([...FURL_RANGE, Math.min(0.6, Math.max(0, headsail?.furl ?? 0))])].sort((x, y) => x - y);
  const sails = plan.sails.map((s) => {
    const rs = full.find((r) => r.id === s.id);
    const model = { family: rs.kind, ...structuredClone(SAIL_KINDS[rs.kind]) };
    const poly = s.polygon.map(lift);
    const [tack, head, clew] = sailCorners(s, plan);
    const out = {
      id: s.id,
      kind: s.kind,
      model,
      polygonM: poly,
      areaM2: s.areaM2,
      ceM: lift(s.ce),
      tackM: tack,
      headM: head,
      clewM: clew,
      luffM: rs.luffM,
      footM: s.footM ?? len3(sub3(clew, tack)),
      ar: rs.ar,
      liftSlope: rs.slope,
      reefs: (s.reefs ?? []).map((r) => ({ fraction: r.fraction, areaM2: r.areaM2, ceM: lift(r.ce), luffM: rs.luffM * (1 - r.fraction), polygonM: r.polygon.map(lift) })),
      furl: s.id === "jib" ? (headsail?.furl ?? 0) : 0,
      sheeting: { minDeg: model.sheet[0], maxDeg: model.sheet[1], wing: model.wing ?? null, boom: null, lead: null },
      coeffs: coeffTable(rs, { stepDeg: step }),
    };
    if (s.id === "main" && plan.boom) out.sheeting.boom = { gooseneckM: lift(plan.boom.gooseneck), endM: lift(plan.boom.end), lengthM: Math.abs(plan.boom.gooseneck[0] - plan.boom.end[0]) };
    if (s.id !== "main") out.sheeting.lead = leadFor({ tack, head, clew }, deckAt, model.sheet[0]);
    return out;
  });
  const sailModel = { rhoAirKgM3: RHO_AIR, interaction: structuredClone(INTERACTION), flatMin: FLAT_MIN, spanFactor: SPAN_FACTOR, cnExp: CN_EXP };

  // ── sail sets (full, then each reef of the main)
  const sets = [];
  const mainReefs = plan.sails.find((s) => s.id === "main")?.reefs ?? [];
  for (let reef = -1; reef < mainReefs.length; reef++) {
    const ss = rigSails(plan, { reef });
    if (!ss.length) continue;
    const span = rigSpan(plan, ss);
    const id = reef < 0 ? "full" : `reef${reef + 1}`;
    // the VPP's own trimmed table for the set (each sail at its best sheet at each whole degree of β_e, §6.3)
    const dSet = D.ok ? D.sets.find((x) => x.id === id) : null;
    const t = dSet && options.trimmed !== false ? tableOf(dSet) : null;
    const trimmed = t ? { betaDeg: t.rows.map((r) => r.beta), cl: t.rows.map((r) => r.cl), cdv: t.rows.map((r) => r.cdv), sheetsDeg: Object.fromEntries(Object.entries(t.sheets).map(([k, v]) => [k, [...v]])) } : null;
    sets.push({ id, reef, sails: ss.map((x) => x.id), areaM2: span.areaM2, ceM: lift(combineCE(ss).ce), heM: span.he, are: span.are, trimmed });
  }

  // ── the rig and its hardware
  const rigOut = rigGeometry({ doc, plan, mastItem, deckAt, half, form, sails });

  // ── resistance
  const resistance = resistanceTable(D, options);

  // ── hardpoints
  const rudder = appendages.find((x) => x.id === "rudder");
  const boom = plan.boom;
  let mainsheet = null;
  if (boom) {
    const E = Math.abs(boom.gooseneck[0] - boom.end[0]);
    const bx = boom.gooseneck[0] - MAINSHEET_AT_E * E;
    const tx = Math.max(bx, form.stern[0]);
    const hb = TRAVELLER_FRAC * half(tx);
    const tz = deckAt(tx) ?? form.stern[1];
    mainsheet = { boomM: [bx, 0, boom.gooseneck[1]], travellerM: [[tx, hb, tz], [tx, -hb, tz]] };
  }
  const jibLeads = [];
  for (const s of sails) {
    if (s.id === "main") continue;
    const leads = furls.map((f) => {
      const c = furledClew(s.tackM, s.headM, s.clewM, f);
      return { furl: f, ...leadFor({ tack: s.tackM, head: s.headM, clew: c }, deckAt, s.sheeting.minDeg) };
    });
    for (const side of ["port", "starboard"]) {
      const pts = leads.map((l) => l[side]);
      const xs = pts.map((p) => p[0]);
      const iFwd = xs.indexOf(Math.max(...xs)), iAft = xs.indexOf(Math.min(...xs));
      jibLeads.push({ sail: s.id, side, trackFromM: pts[iFwd], trackToM: pts[iAft], leads: leads.map((l) => ({ furl: l.furl, atM: l[side] })) });
    }
  }
  const halyardExits = sails.map((s) => ({ sail: s.id, atM: s.id === "main" ? rigOut.mainHeadAtMastM : s.headM }));
  const hardpoints = {
    mastStepM: rigOut.mast.stepM,
    mastPartnersM: rigOut.mast.partnersM,
    mastheadM: rigOut.mast.headM,
    stemheadM: lift(form.stem),
    forestayTackM: plan.forestay ? lift(plan.forestay.tack) : null,
    innerForestayTackM: sails.find((s) => s.id === "staysail")?.tackM ?? null,
    backstayPlateM: rigOut.standing.find((s) => s.id === "backstay")?.toM ?? null,
    chainplates: rigOut.chainplates,
    rudderStock: rudder?.stock ? { axisM: rudder.stock.axisM, bearingM: rudder.stock.bearingM, deckM: rudder.stock.deckM } : null,
    mainsheet,
    jibLeads,
    halyardExits,
    crewStations: loading.crew.stations.map((s) => ({ ...s, mode: crewDoc.mode })),
  };

  // ── loads
  const L = a.loads;
  const loads = L
    ? {
        basis: "RM30",
        rm30Nm: L.rm30,
        chainplateBaseM: numOrNull(L.chainplateBaseM),
        chainplatesN: Object.fromEntries(rigOut.chainplates.map((c) => [c.id, numOrNull(L.chainplateN)])),
        mastCompressionN: numOrNull(L.chainplateN),
        atAwsMs: numOrNull(L.atAws),
        sheetN: Object.fromEntries(sails.map((s) => [s.id, s.id === "main" ? numOrNull(L.mainClewN) : s.id === "jib" ? numOrNull(L.jibSheetN) : null])),
        halyardN: Object.fromEntries(sails.map((s) => [s.id, null])),
        rudderTorqueNm: L.rudder ? L.rudder.nm : null,
        rudderAtSpeedMs: L.rudder ? L.rudder.speedMs : null,
        notes:
          "Static, no safety factor, no rig pretension. Chainplates: RM30 over the chainplate base (each is the windward one on its tack). Sheets: Harken's rule at the reef wind (the main's on its triangle × (1 + roach)); the staysail's isn't estimated. Halyards aren't estimated: no rule found to cite. Rudder: the larger of the torque at stall and stalled at maxDeg, at hull speed.",
      }
    : null;

  // ── predictions
  const predicted = predictedOf(D, n, polar, doc);

  // ── the lumped sail for today's sailing (the GLB carries it as extras.sail.plan, in its own coordinates)
  const lumpedSail = lumpedOf(plan);

  const contract = {
    format: FORMAT,
    version: VERSION,
    name: doc.title,
    frame,
    source: {
      generator: GENERATOR,
      rigDoc: source.rigDoc ?? null,
      rigHeads: source.rigHeads ?? null,
      hull: {
        kind: doc.hull.link ? "linked" : "synthetic",
        url: doc.hull.link?.url ?? null,
        path: source.hull?.path ?? null,
        label: form.label || (doc.hull.link ? "linked hull" : "synthetic hull from principal dimensions"),
        heads: source.hull?.heads ?? null,
        glbKey: source.hull?.glbKey ?? null,
      },
      statics: source.statics === "chartroom" ? "chartroom-table" : rm?.source === "table" ? "mesh" : "gm",
    },
    hull,
    loading,
    appendages,
    sails,
    sailModel,
    sets,
    rig: rigOut.rig,
    resistance,
    hardpoints,
    loads,
    predicted,
    lumpedSail,
    warnings: n.warnings.map((w) => formatText(w, "metric")),
    rules: RULES,
  };
  return { ok: true, contract };
}

/** A sail's tack, head and clew, lifted. */
function sailCorners(s, plan) {
  if (s.id === "main") {
    const [gooseneck] = s.triangle.polygon;
    return [lift(gooseneck), lift(s.triangle.polygon[1]), lift(s.triangle.polygon[2])];
  }
  return [lift(s.polygon[0]), lift(s.polygon[1]), lift(s.polygon[2])];
}

/**
 * The rudder stock: the straight line through each section's point at
 * stockFrac of its chord aft of the leading edge (so through the MAC's
 * balance point the torque uses), from the blade's tip up to the deck.
 */
function stockOf(f, rudderDoc, deckAt) {
  const k = rudderDoc.stockFrac;
  const c = f.corners;
  const root = [c.rootLE[0] - k * f.rootChord, 0, c.rootLE[1]];
  const tip = [c.tipLE[0] - k * f.tipChord, 0, c.tipLE[1]];
  const d = sub3(root, tip);
  const deckZ = (x) => deckAt(x);
  // up the axis from the root to where it meets the deck
  const dz = d[2] || 1e-9;
  let p = root;
  for (let i = 0; i < 8; i++) {
    const z = deckZ(p[0]);
    if (!fin(z)) break;
    const s = (z - root[2]) / dz;
    p = add3(root, mul3(d, s));
  }
  return { axisM: [tip, p], bearingM: root, deckM: p, balanceFrac: k, maxDeg: rudderDoc.maxDeg };
}

/** The mast, boom, spreaders, standing rigging and chainplates. */
function rigGeometry({ doc, plan, mastItem, deckAt, half, form, sails }) {
  const partners = lift(plan.mast.partners);
  const head = lift(plan.mast.head);
  const step = mastItem ? lift(mastItem.step) : partners;
  const th = plan.rakeDeg * RAD;
  const u = [-Math.sin(th), 0, Math.cos(th)];
  const along = (hgt) => add3(partners, mul3(u, hgt));
  const stayed = plan.type !== "cat";
  const mx = partners[0];
  const b = CHAINPLATE_FRAC * half(mx);
  const cz = deckAt(mx) ?? partners[2];
  const chainplates = stayed ? [{ id: "port", atM: [mx, b, cz] }, { id: "starboard", atM: [mx, -b, cz] }] : [];
  const standing = [];
  const spreaders = [];
  if (stayed) {
    if (plan.forestay) standing.push({ id: "forestay", fromM: lift(plan.forestay.tack), toM: lift(plan.forestay.head), viaM: [] });
    if (plan.backstay) standing.push({ id: "backstay", fromM: lift(plan.backstay.from), toM: lift(plan.backstay.to), viaM: [] });
    const st = sails.find((s) => s.id === "staysail");
    if (st) standing.push({ id: "inner-forestay", fromM: st.tackM, toM: st.headM, viaM: [] });
    const capTop = plan.I > 0 ? along(plan.I) : head;
    const capH = plan.I > 0 ? plan.I : plan.mast.heightM;
    const hs = SPREADER_FRAC * capH;
    const root = along(hs);
    const tips = { port: [root[0], b, root[2]], starboard: [root[0], -b, root[2]] };
    spreaders.push({ heightM: hs, rootM: root, tipsM: [tips.port, tips.starboard], lengthM: b });
    for (const c of chainplates) {
      standing.push({ id: `cap-shroud-${c.id}`, fromM: capTop, toM: c.atM, viaM: [tips[c.id]] });
      standing.push({ id: `lower-shroud-${c.id}`, fromM: root, toM: c.atM, viaM: [] });
    }
  }
  const main = plan.sails.find((s) => s.id === "main");
  const rig = {
    type: plan.type,
    I: plan.I,
    J: plan.J,
    P: plan.P,
    E: plan.E,
    BAS: plan.BAS,
    ISP: plan.ISP,
    LP: doc.rig.headsail?.LP ?? null,
    rakeDeg: plan.rakeDeg,
    mast: {
      stepM: step,
      partnersM: partners,
      headM: head,
      heightM: plan.mast.heightM,
      lengthM: mastItem?.lengthM ?? plan.mast.heightM,
      massKg: mastItem?.massKg ?? null,
      kgPerM: mastItem?.kgPerM ?? null,
      stepped: doc.rig.mast.stepped,
      stayed,
      sectionM: mastSection(mastItem?.lengthM ?? plan.mast.heightM),
    },
    boom: plan.boom ? { gooseneckM: lift(plan.boom.gooseneck), endM: lift(plan.boom.end), lengthM: Math.abs(plan.boom.gooseneck[0] - plan.boom.end[0]) } : null,
    standing,
    spreaders,
    designer: { areaM2: plan.designer.areaM2, ceM: lift(plan.designer.ce) },
    actual: { areaM2: plan.actual.areaM2, ceM: lift(plan.actual.ce) },
  };
  return { rig, mast: rig.mast, standing, chainplates, mainHeadAtMastM: main ? along(plan.BAS + plan.P) : head };
}

/** The mast's drawn diameter (drawing only, not a scantling): 0.0055·L + 0.01 m. */
export const mastSection = (L) => 0.0055 * L + 0.01;

/** R(V, φ) sampled for the contract (§6.5), from the design's own model. */
function resistanceTable(D, options) {
  if (!D.ok) return { status: "not-computed", why: D.why, model: "ITTC57+DSYHS+Savitsky", speedsMs: [], heelsDeg: [], hullN: [], frictionN: [], heelResiduaryN: [], residuaryN: [], planingN: [], planingWeight: [], appendagesN: [], regime: [] };
  const m = resistanceOf(D);
  const lwl = D.hull.lwl;
  const cap = D.planing.capability;
  const fnTop = options.resistanceFnTop ?? (cap >= 0.5 ? 1.2 : FN_MAX_DISPLACEMENT);
  const fnStep = options.resistanceFnStep ?? RESISTANCE_FN_STEP;
  const speedsMs = [];
  for (let k = 1; k * fnStep <= fnTop + 1e-9; k++) speedsMs.push(k * fnStep * Math.sqrt(G * lwl));
  const heelsDeg = options.resistanceHeels ?? RESISTANCE_HEELS;
  const at = heelsDeg.map((ph) => speedsMs.map((V) => m.at(V, ph, 0)));
  const up = at[heelsDeg.indexOf(0)] ?? speedsMs.map((V) => m.at(V, 0, 0));
  return {
    status: "computed",
    why: null,
    model: "ITTC57+DSYHS+Savitsky",
    rhoWaterKgM3: RHO_SEA,
    nuM2s: NU_SEA,
    speedsMs,
    fn: speedsMs.map((V) => froudeOf(V, lwl)),
    heelsDeg: [...heelsDeg],
    hullN: at.map((row) => row.map((r) => r.hull)),
    frictionN: at.map((row) => row.map((r) => r.friction)),
    heelResiduaryN: at.map((row) => row.map((r) => r.heel)),
    residuaryN: up.map((r) => r.residuary),
    planingN: up.map((r) => numOrNull(r.planing)),
    planingWeight: up.map((r) => r.planingWeight),
    appendagesN: up.map((r) => r.appendages),
    regime: up.map((r) => r.regime),
    induced: { draftM: D.draftT, keelTaper: D.keelTaper, rule: "§6.5.5" },
    // §6.5's regression tables, so a consumer can evaluate the formulas from the contract alone
    coefficients: { residuaryFn: [...RESIDUARY_FN], residuaryA: RESIDUARY_A.map((r) => [...r]), heelFn: [...HEEL_FN], heelU: HEEL_U.map((r) => [...r]), teUpright: [...TE_UPRIGHT] },
    planing: { capability: cap, dL: D.planing.dL, weightN: D.planing.weightN, beamM: D.planing.beam, deadriseDeg: D.planing.deadriseDeg, deadriseFrom: D.planing.deadriseFrom, lcgFromAftM: D.planing.lcg, fnBlend: [...PLANING_FN] },
    fnMax: FN_MAX_DISPLACEMENT,
    formFactor: 0,
  };
}

/** A VPP point (vpp.js describe) as the contract states it. */
export function pointOf(p) {
  if (!p) return null;
  return {
    twsMs: p.tws,
    twsKn: p.tws / KNOT,
    twaDeg: p.twa,
    ok: !!p.ok,
    speedMs: numOrNull(p.speed),
    VMs: numOrNull(p.V),
    heelDeg: numOrNull(p.heel),
    leewayDeg: numOrNull(p.leeway),
    rudderDeg: numOrNull(p.rudder),
    flat: p.flat,
    set: p.set,
    reef: p.reef,
    sheetsDeg: { ...p.sheets },
    awsMs: numOrNull(p.aws),
    awaDeg: numOrNull(p.awa),
    fn: numOrNull(p.fn),
    regime: p.regime,
    planingWeight: p.planingWeight,
    vmgMs: numOrNull(p.vmg),
    residual: numOrNull(p.residual),
    flags: p.flags.map((f) => ({ id: f.id, text: f.text })),
    hollow: !!p.hollow,
  };
}

function predictedOf(D, n, polar, doc) {
  const c = doc.conditions;
  const conditions = { twsMs: [...c.tws], twaDeg: [...c.twa], reference: { twsMs: c.reference.tws, twaDeg: c.reference.twa } };
  if (!D.ok) return { status: "not-computed", why: D.why, conditions, reference: null, helm: null, points: [], beat: [], run: [] };
  const helm = n.helm ? { id: n.helm.id, text: n.helm.text, rudderDeg: numOrNull(n.helm.deg) } : null;
  if (!polar) return { status: "not-computed", why: "the polar wasn't computed for this export", conditions, reference: pointOf(n.reference), helm, points: [], beat: [], run: [] };
  return { status: "computed", why: null, conditions, reference: pointOf(n.reference), helm, points: polar.points.map(pointOf), beat: polar.beat.map(pointOf), run: polar.run.map(pointOf) };
}

/**
 * The lumped sail sailing's physics flies today (extras.sail.plan): one
 * foil of the actual sails' whole area whose CE (LUMPED_CE_HEIGHT up its
 * luff from the tack, a third of its foot aft) is their combined CE. The
 * sim swings that CE about the tack with the boom, so the foot is three
 * times the sails' area-weighted swing arm: each sail's CE aft of its own
 * pivot (the gooseneck for the main, the tack for a headsail). The tack is
 * then a third of the foot forward of the CE, at the boom's height.
 */
export function lumpedOf(plan) {
  const ce = plan.actual.ce;
  const area = plan.actual.areaM2;
  if (!ce || !(area > 0)) return null;
  let arm = 0;
  for (const s of plan.sails) {
    const pivotX = s.id === "main" ? (plan.boom?.gooseneck[0] ?? plan.mast.partners[0]) : s.polygon[0][0];
    arm += s.areaM2 * Math.max(0, pivotX - s.ce[0]);
  }
  arm /= area;
  const foot = Math.max(0.3, 3 * arm);
  const tz0 = plan.boom ? plan.boom.gooseneck[1] : plan.mast.partners[1];
  const luff = Math.max(1, (ce[1] - tz0) / LUMPED_CE_HEIGHT);
  return { tackM: [ce[0] + foot / 3, 0, ce[1] - LUMPED_CE_HEIGHT * luff], luffM: luff, footM: foot, areaM2: area, ceM: [ce[0], 0, ce[1]], ceHeightFrac: LUMPED_CE_HEIGHT };
}
