// The rig-design document: authored design only, SI, nothing derived stored.
// Every number the tool shows is recomputed from this on each change.
//
// RigDesignDoc v1 (each field has a default in normalize()):
//
// {
//   version: 1,
//   title: string,
//   hull: {
//     link: { url, frame: { bow: "+X"|"-X"|"+Z"|"-Z", up: "+Y"|"+Z" } } | null,
//                                          // a linked hull (scene render, GLB file, or any doc a
//                                          // scene:source can build), used at its own size; the
//                                          // frame says which GLB axes are bow and up
//     dims: { loa, lwl, beam, bwl, tc, draft, freeboard, displacementKg,
//             cp: number|null, cm: number|null, lcbFrac: number|null,
//             deadriseDeg: number|null },     // the planing bottom's; null = estimated from the hull's sections
//   },                                     //   m, m, m, m, m (canoe body), m (overall), m, kg;
//                                          //   null = estimated by the synthetic hull. With no
//                                          //   link, dims build a synthetic hull mesh.
//   rig: {
//     type: "masthead"|"fractional"|"cat"|"cutter",
//     mast: { aftOfStem, rakeDeg, stepped: "deck"|"keel", kgPerM: number|null },   // the mast's front at the sheer; J follows from it
//     I, P, E, BAS, ISP: number|null,       // ISP null = the mast top
//     forestayAftOfStem: 0,                 // negative = a bowsprit
//     main: { roach, reefs: [fraction of P, ...] },
//     headsail: { kind: "jib"|"genoa"|"self-tacking", LP, clewHeight: number|null, furl: 0 } | null,
//     staysail: { I2, J2, LP2, clewHeight: number|null } | null,   // cutter
//   },
//   appendages: {
//     keel: { kind: "fin"|"fin-bulb"|"centreboard"|"daggerboard"|"long"|"none",
//             aftOfStem, span, rootChord, tipChord, sweepDeg, tc,     // root leading edge aft of the stem; LE sweep, + = tip aft
//             bulb: { length, diameter } | null },                     // fin-bulb only
//     rudder: { kind: "spade"|"skeg"|"transom-hung"|"kick-up",
//               aftOfStem, span, rootChord, tipChord, sweepDeg, tc,
//               maxDeg, stockFrac },                                   // stock: fraction of the MAC aft of its LE
//   },                                     // a foil's root is at the canoe body's underside (naval/foils.js)
//   loading: {
//     displacement: { from: "hull"|"given", kg: number|null },  // "hull": the hull's (dims') displacement
//     ballast: { kg, at: "bulb"|"keel"|"hull" },
//     lightship: { kg: number|null, vcg: number|null },  // null kg: the remainder of the displacement (estimated)
//     crew: { count, kgEach, mode: "none"|"sitting"|"rail"|"hiking"|"trapeze", arm: number|null },  // arm null: by mode
//   },
//   conditions: { aws: [m/s, ...], heelLimitDeg,      // apparent winds for the stability view; the heel to reef at
//                 tws: [m/s, ...], twa: [deg, ...],  // the performance polar's true winds and angles
//                 reference: { tws: m/s, twa: deg } },   // the point the helm verdict is read at
//   prov: { [path]: "estimated" },          // a field with no entry was given by the designer
//   sources: [{ what, cite, retrieved? }],  // where given figures came from
// }
//
// Positions are in the hull's frame (x forward, y port, z up, metres); rig
// longitudinals are distances aft of the stemhead, the ISO/ORC convention.

import { RIG_TYPES, HEADSAIL_KINDS } from "./naval/sailplan.js";
import { normalizeFrame } from "./naval/hull-frame.js";
import { KEEL_KINDS, RUDDER_KINDS } from "./naval/foils.js";
import { KNOT } from "./naval/units.js";

export const DOC_VERSION = 1;
export const CREW_MODES = ["none", "sitting", "rail", "hiking", "trapeze"];
export const STEPPED = ["deck", "keel"];
export const BALLAST_AT = ["bulb", "keel", "hull"];
/** The stability view's default apparent winds: 8, 12, 16, 20, 25 kn. */
export const DEFAULT_AWS = [8, 12, 16, 20, 25].map((k) => k * KNOT);
/** The polar's default true winds, ORC certificate style: 6, 8, 10, 12, 14, 16, 20 kn. */
export const DEFAULT_TWS = [6, 8, 10, 12, 14, 16, 20].map((k) => k * KNOT);
/** The polar's default true wind angles, degrees. */
export const DEFAULT_TWA = [40, 45, 52, 60, 70, 75, 90, 110, 120, 135, 150, 165, 180];
/** Where the helm verdict is read: 12 kn true at 45°. */
export const DEFAULT_REFERENCE = Object.freeze({ tws: 12 * KNOT, twa: 45 });

/**
 * The stock 12 m sloop: sailing's SLOOP (sailing/src/hull-model.js, copied
 * figures, not imported) written as a rig. SLOOP is one lumped sail of 55 m²
 * with luff 13 m, foot 4.5 m and its tack 4.8 m aft of the bow and 1.4 m above
 * the waterline (freeboard 1.2 m). Read as a rig: P = 13, E = 4.5, the mast
 * 4.8 m aft of the stem, BAS = 1.4 − 1.2 = 0.2, and I chosen so the
 * designer's area ½PE + ½IJ is SLOOP's 55 m², which puts the hounds at 3/4 of
 * the mast: a fractional sloop. SLOOP's keel (2.5 m², 1.2 m deep below the
 * box's 1.9 m draft) is drawn as a fin from the canoe body (Tc 0.6) to the
 * 1.9 m draft, and its rudder (0.6 m², 5.2 m aft of mid-LOA) as a spade:
 * the areas are SLOOP's, the planforms and the keel's position are estimated
 * (placed for a lead inside the fractional fin-keel band). Everything SLOOP
 * doesn't state is estimated.
 */
export const STOCK_SLOOP = Object.freeze({
  version: DOC_VERSION,
  title: "12 m sloop (stock)",
  hull: {
    link: null,
    dims: { loa: 12, lwl: 10.5, beam: 3.8, bwl: 3.04, tc: 0.6, draft: 1.9, freeboard: 1.2, displacementKg: 8000, cp: null, cm: null, lcbFrac: null, deadriseDeg: null },
  },
  rig: {
    type: "fractional",
    mast: { aftOfStem: 4.8, rakeDeg: 0, stepped: "keel", kgPerM: null },
    I: (2 * (55 - 0.5 * 13 * 4.5)) / 4.8,
    P: 13,
    E: 4.5,
    BAS: 0.2,
    ISP: null,
    forestayAftOfStem: 0,
    main: { roach: 0.12, reefs: [0.15, 0.3] },
    headsail: { kind: "jib", LP: 4.8, clewHeight: null, furl: 0 },
    staysail: null,
  },
  appendages: {
    keel: { kind: "fin", aftOfStem: 4.65, span: 1.3, rootChord: 2.3, tipChord: 1.55, sweepDeg: 8, tc: 0.12, bulb: null },
    rudder: { kind: "spade", aftOfStem: 10.85, span: 1.0, rootChord: 0.7, tipChord: 0.5, sweepDeg: 5, tc: 0.12, maxDeg: 35, stockFrac: 0.2 },
  },
  loading: {
    displacement: { from: "hull", kg: null },
    ballast: { kg: 2800, at: "keel" },
    lightship: { kg: null, vcg: null },
    crew: { count: 4, kgEach: 80, mode: "sitting", arm: null },
  },
  conditions: { aws: DEFAULT_AWS, heelLimitDeg: 25, tws: DEFAULT_TWS, twa: DEFAULT_TWA, reference: { ...DEFAULT_REFERENCE } },
  prov: {
    "hull.dims.lwl": "estimated",
    "hull.dims.bwl": "estimated",
    "hull.dims.tc": "estimated",
    "rig.I": "estimated",
    "rig.main.roach": "estimated",
    "rig.headsail.LP": "estimated",
    "loading.ballast.kg": "estimated",
    "loading.crew.count": "estimated",
    ...Object.fromEntries(
      ["aftOfStem", "span", "rootChord", "tipChord", "sweepDeg", "tc"].flatMap((k) => [
        [`appendages.keel.${k}`, "estimated"],
        [`appendages.rudder.${k}`, "estimated"],
      ]),
    ),
  },
  sources: [
    {
      what: "LOA, beam, draft, freeboard, displacement, P, E, mast position, BAS, keel and rudder areas, rudder position",
      cite: "sailing/src/hull-model.js SLOOP (patchwork-experiments), copied",
    },
  ],
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const fin = (v, d) => (Number.isFinite(v) ? v : d);
const finOrNull = (v) => (Number.isFinite(v) ? v : null);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const str = (v, d) => (typeof v === "string" ? v : d);

function normalizeHeadsail(h, d) {
  if (h === null) return null;
  if (!isObj(h)) return d ? clone(d) : null;
  return {
    kind: oneOf(h.kind, HEADSAIL_KINDS, "jib"),
    LP: fin(h.LP, d?.LP ?? 0),
    clewHeight: finOrNull(h.clewHeight),
    furl: fin(h.furl, 0),
  };
}

function normalizeStaysail(s) {
  if (!isObj(s)) return null;
  return { I2: fin(s.I2, 0), J2: fin(s.J2, 0), LP2: fin(s.LP2, 0), clewHeight: finOrNull(s.clewHeight) };
}

function normalizeFoil(f, d, kinds) {
  const o = isObj(f) ? f : {};
  return {
    kind: oneOf(o.kind, kinds, d.kind),
    aftOfStem: fin(o.aftOfStem, d.aftOfStem),
    span: Math.max(0, fin(o.span, d.span)),
    rootChord: Math.max(0, fin(o.rootChord, d.rootChord)),
    tipChord: Math.max(0, fin(o.tipChord, d.tipChord)),
    sweepDeg: fin(o.sweepDeg, d.sweepDeg),
    tc: Math.max(0, fin(o.tc, d.tc)),
  };
}

function normalizeBulb(b) {
  if (!isObj(b)) return null;
  return { length: Math.max(0, fin(b.length, 0)), diameter: Math.max(0, fin(b.diameter, 0)) };
}

/** The dims that may be null (estimated by the synthetic hull). */
export const OPTIONAL_DIMS = ["cp", "cm", "lcbFrac"];
/** Dims that may be null: the synthetic hull's coefficients and the planing deadrise. */
export const NULLABLE_DIMS = [...OPTIONAL_DIMS, "deadriseDeg"];

function normalizeLink(l) {
  if (!isObj(l) || typeof l.url !== "string" || !l.url) return null;
  return { url: l.url, frame: normalizeFrame(l.frame) };
}

/**
 * A complete, plain copy of a doc: every field present, nothing undefined,
 * anything malformed replaced by the stock sloop's value. Never writes.
 * normalize(normalize(x)) deep-equals normalize(x).
 */
export function normalize(raw) {
  const r = isObj(raw) ? raw : {};
  const D = STOCK_SLOOP;
  const hull = isObj(r.hull) ? r.hull : {};
  const dims = isObj(hull.dims) ? hull.dims : {};
  const rig = isObj(r.rig) ? r.rig : {};
  const mast = isObj(rig.mast) ? rig.mast : {};
  const main = isObj(rig.main) ? rig.main : {};
  const loading = isObj(r.loading) ? r.loading : {};
  const disp = isObj(loading.displacement) ? loading.displacement : {};
  const ballast = isObj(loading.ballast) ? loading.ballast : {};
  const crew = isObj(loading.crew) ? loading.crew : {};
  const lightship = isObj(loading.lightship) ? loading.lightship : {};
  const appendages = isObj(r.appendages) ? r.appendages : {};
  const keel = isObj(appendages.keel) ? appendages.keel : {};
  const rudder = isObj(appendages.rudder) ? appendages.rudder : {};
  const conditions = isObj(r.conditions) ? r.conditions : {};
  const dd = D.hull.dims;
  const out = {
    version: DOC_VERSION,
    title: str(r.title, D.title),
    hull: {
      link: normalizeLink(hull.link),
      dims: Object.fromEntries(Object.keys(dd).map((k) => [k, NULLABLE_DIMS.includes(k) ? finOrNull(dims[k]) : fin(dims[k], dd[k])])),
    },
    rig: {
      type: oneOf(rig.type, RIG_TYPES, D.rig.type),
      mast: {
        aftOfStem: fin(mast.aftOfStem, D.rig.mast.aftOfStem),
        rakeDeg: fin(mast.rakeDeg, 0),
        stepped: oneOf(mast.stepped, STEPPED, D.rig.mast.stepped),
        kgPerM: finOrNull(mast.kgPerM),
      },
      I: fin(rig.I, D.rig.I),
      P: fin(rig.P, D.rig.P),
      E: fin(rig.E, D.rig.E),
      BAS: fin(rig.BAS, D.rig.BAS),
      ISP: finOrNull(rig.ISP),
      forestayAftOfStem: fin(rig.forestayAftOfStem, 0),
      main: {
        roach: fin(main.roach, D.rig.main.roach),
        reefs: Array.isArray(main.reefs) ? main.reefs.filter((x) => Number.isFinite(x)) : [...D.rig.main.reefs],
      },
      headsail: "headsail" in rig ? normalizeHeadsail(rig.headsail, D.rig.headsail) : clone(D.rig.headsail),
      staysail: normalizeStaysail(rig.staysail),
    },
    appendages: {
      keel: { ...normalizeFoil(keel, D.appendages.keel, KEEL_KINDS), bulb: normalizeBulb(keel.bulb) },
      rudder: {
        ...normalizeFoil(rudder, D.appendages.rudder, RUDDER_KINDS),
        maxDeg: fin(rudder.maxDeg, D.appendages.rudder.maxDeg),
        stockFrac: fin(rudder.stockFrac, D.appendages.rudder.stockFrac),
      },
    },
    loading: {
      displacement: { from: oneOf(disp.from, ["hull", "given"], "hull"), kg: finOrNull(disp.kg) },
      ballast: { kg: fin(ballast.kg, 0), at: oneOf(ballast.at, BALLAST_AT, "keel") },
      lightship: { kg: finOrNull(lightship.kg), vcg: finOrNull(lightship.vcg) },
      crew: {
        count: fin(crew.count, 0),
        kgEach: fin(crew.kgEach, 80),
        mode: oneOf(crew.mode, CREW_MODES, "none"),
        arm: finOrNull(crew.arm),
      },
    },
    conditions: {
      aws: Array.isArray(conditions.aws) ? conditions.aws.filter((v) => Number.isFinite(v) && v > 0) : [...D.conditions.aws],
      heelLimitDeg: fin(conditions.heelLimitDeg, D.conditions.heelLimitDeg),
      tws: Array.isArray(conditions.tws) ? conditions.tws.filter((v) => Number.isFinite(v) && v > 0) : [...D.conditions.tws],
      twa: Array.isArray(conditions.twa) ? conditions.twa.filter((v) => Number.isFinite(v) && v > 0 && v <= 180) : [...D.conditions.twa],
      reference: {
        tws: Number.isFinite(conditions.reference?.tws) && conditions.reference.tws > 0 ? conditions.reference.tws : D.conditions.reference.tws,
        twa: Number.isFinite(conditions.reference?.twa) && conditions.reference.twa > 0 && conditions.reference.twa <= 180 ? conditions.reference.twa : D.conditions.reference.twa,
      },
    },
    prov: isObj(r.prov)
      ? Object.fromEntries(Object.entries(r.prov).filter(([, v]) => v === "estimated"))
      : {},
    sources: Array.isArray(r.sources) ? r.sources.filter(isObj).map(clone) : [],
  };
  return out;
}

/** A fresh doc: the stock sloop. */
export const defaultDoc = () => normalize(clone(STOCK_SLOOP));

/** Path text, "rig.main.roach". */
export const pathKey = (path) => path.join(".");

/** Read a path from a (normalized) doc. */
export function getPath(doc, path) {
  let v = doc;
  for (const k of path) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

/**
 * Write a value at a path inside handle.change, making intermediate objects.
 * `undefined` deletes the field (automerge cannot hold undefined). Writing a
 * field marks it given: its "estimated" mark goes.
 */
export function setPath(d, path, value) {
  let o = d;
  for (const k of path.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  const last = path[path.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
  const key = pathKey(path);
  if (isObj(d.prov) && key in d.prov) delete d.prov[key];
}

/**
 * The effective displacement and where it came from.
 * @returns {{ kg: number, from: "hull"|"given" }}
 */
export function displacementOf(doc) {
  const g = doc.loading.displacement;
  if (g.from === "given" && Number.isFinite(g.kg) && g.kg > 0) return { kg: g.kg, from: "given" };
  return { kg: doc.hull.dims.displacementKg, from: "hull" };
}

/** Is this field marked estimated? */
export const isEstimated = (doc, path) => doc.prov?.[pathKey(path)] === "estimated";
