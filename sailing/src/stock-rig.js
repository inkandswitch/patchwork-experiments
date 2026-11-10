// The stock sloop's rig contract (patchwork-rig v1, `extras.rig` on her
// "Mast and sail" rig GLB), stated from her drawing (DESIGN.md, "Trim
// feedback", item 1). Pure: no THREE, no ship.js (ship.js hands it
// `rigDrawing()`, and puts what comes back on the GLB).
//
// It is the rig package's 12 m sloop fixture with her own rig. Her
// principal dimensions are the fixture's (LOA 12, beam 3.8, 8000 kg), so the
// fixture's synthetic canoe body, its appendages and resistance, the sail
// model and each sail family's constants, the loading (but for where the
// rig's items are) and the rules are kept as they are (stock-rig-12m.js).
// Everything the rig decides is computed here from where she draws it, by
// the specification's own rules (naval/contract/v1/specification.md), each a
// named function a test can re-derive:
// - the main swings about the rig object's own Y axis: its tack is the
//   gooseneck (the rig object's origin) and its head straight up from it,
//   at the drawn head's height; its outline is the drawn cloth's;
// - the jib is a 100% blade on her drawn (masthead) forestay, its clew at the
//   fixture's own proportion up the luff, its leads by §3.9's rule put down
//   on her drawn deck;
// - the sets, rig dimensions, hardpoints, the CG roll-up and the lumped
//   sail follow §3.6–3.12 and §6.8.
//
// The contract is in its own frame (x forward, y port, z up, the waterplane
// at z = 0); her hull GLB is drawn in her body frame (x starboard, y up,
// z aft, the waterline at y = 0), so glbToFrame is p ↦ (−z, −x, y) and her
// body frame is the contract's (rig-contract.js rigFrame is the identity).
// Points are worked out in the body frame and stated through toContract.

import KEPT from "./stock-rig-12m.js";
import { toContract } from "./rig-contract.js";
import { areaCentroid, furledClew, reefed, sailSlope } from "./rig-sails.js";
import { rigSailCoeffs } from "./physics-foils.js";

/** The family of hull GLBs this contract describes: the stock hull, any `@n` (parts.js fileKey). */
export const STOCK_GLB_KEY = "sailing/hull";
export const STOCK_GENERATOR = "patchwork sailing stock-rig";

/**
 * Where the jib's clew is up its luff, as a fraction of it: the 12 m
 * fixture's own, (c − t)·l/|l|² (stock-rig.test.js re-derives it).
 */
export const JIB_CLEW_S = 0.2827;

/** The jib's head below the forestay's top (m): the main's head is as far under the masthead, as drawn. */
export const JIB_HEAD_DROP = 0.35;

/** §3.9: the leads are stated for the clew furled by these (and the doc's furl if more). */
export const LEAD_FURLS = Object.freeze([0, 0.1, 0.2, 0.3]);

/**
 * The stock jib's sheet all the way out (its `sheeting.maxDeg`, deg). The
 * family's 30° (§6.2's model.sheet, which stays as the fixture has it) is
 * the foot's angle with the clew at the rail; eased further the clew rises
 * and the head twists open, so the chord's mean angle goes on out. At 55° an
 * eased jib on a beam reach can luff, so every state its trim shows can be
 * reached by its sheet (DESIGN.md, "Trim feedback": the stock jib's ease).
 */
export const JIB_EASED_DEG = 60;

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const C = (p) => toContract(p);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Area-weighted mean of points. */
function weighted(items) {
  let w = 0;
  const s = [0, 0, 0];
  for (const { at, by } of items) {
    w += by;
    for (let i = 0; i < 3; i++) s[i] += at[i] * by;
  }
  return w > 0 ? scale(s, 1 / w) : [0, 0, 0];
}

/**
 * A sail on the centreplane from its corners and outline (body frame): its
 * area and CE are the polygon's (§3.6), its luff and foot from its tack, its
 * aspect ratio 2·luff²/area and its lift slope Helmbold on it (§6.2).
 */
function sailOf({ id, kind, model, tack, head, clew, polygon }) {
  const { area, ce } = areaCentroid(polygon);
  const luff = len(sub(head, tack));
  return {
    id,
    kind,
    model,
    tack,
    head,
    clew,
    polygon,
    area,
    ce: [0, ce[1], ce[2]],
    luff,
    foot: len(sub(clew, tack)),
    ar: (2 * luff * luff) / area,
    liftSlope: sailSlope(luff, area),
  };
}

/** The main, from the drawing: tack at the gooseneck, head straight up the rig's Y, the drawn clew and cloth. */
export function stockMain(d, model) {
  const tack = [...d.boom.gooseneck];
  const head = [tack[0], d.main.head[1], tack[2]];
  return sailOf({ id: "main", kind: "main", model, tack, head, clew: [...d.main.clew], polygon: d.main.outline.map((p) => [0, p[1], p[2]]) });
}

/**
 * The jib, a 100% blade on her forestay: its tack the forestay's foot, its
 * head JIB_HEAD_DROP down from the top, its clew JIB_CLEW_S up the luff and
 * LP = J aft of it, square to the luff in the centreplane.
 */
export function stockJib(d, model) {
  const tack = [...d.forestay.from];
  const stay = sub(d.forestay.to, tack);
  const u = scale(stay, 1 / len(stay));
  const head = sub(d.forestay.to, scale(u, JIB_HEAD_DROP));
  const luff = sub(head, tack);
  const J = Math.abs(tack[2] - d.mast.step[2]);
  // square to the luff in the centreplane (y, z), aft
  let n = [0, -u[2], u[1]];
  if (n[2] < 0) n = scale(n, -1);
  const clew = add(add(tack, scale(luff, JIB_CLEW_S)), scale(n, J));
  return { ...sailOf({ id: "jib", kind: "jib", model, tack, head, clew, polygon: [tack, head, clew] }), J };
}

/**
 * §3.9's lead for a headsail, on one side (−1 port, +1 starboard; body
 * frame): on the line from the luff's midpoint through the clew (furled
 * by `furl`), carried down to the deck (`deckAt(x, z)`, the drawn surface's
 * height), at `minDeg` off the centreline from the tack in plan.
 */
export function leadAt(sail, furl, side, minDeg, deckAt) {
  const mid = scale(add(sail.tackM, sail.headM), 0.5);
  const clew = furledClew(sail, furl);
  const dir = sub(clew, mid);
  const tan = Math.tan(minDeg * DEG);
  const at = (t) => {
    const p = add(mid, scale(dir, t));
    return [side * tan * (p[2] - sail.tackM[2]), p[1], p[2]];
  };
  const above = (t) => {
    const p = at(t);
    return p[1] - deckAt(p[0], p[2]);
  };
  // from the clew down the line to the first place it meets the deck, then bisected
  let lo = 1;
  let hi = 1;
  for (let k = 0; k < 4000 && above(hi) > 0; k++) hi += 0.01;
  if (above(hi) > 0) throw new Error("stock-rig: the lead line never reaches the deck");
  if (above(lo) <= 0) return at(lo);
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2;
    if (above(m) > 0) lo = m;
    else hi = m;
  }
  return at(hi);
}

/** §6.8's lumped sail from the sails (body frame): their area and CE, the foot three times their swing arm, the tack at the boom's height. */
export function lumpedSailOf(sails, boomY, ceHeightFrac = 0.38) {
  const area = sails.reduce((a, s) => a + s.area, 0);
  const ce = weighted(sails.map((s) => ({ at: s.ce, by: s.area })));
  // each CE aft of its own pivot (the gooseneck for the main, the tack for a headsail): body +z is aft
  const arm = sails.reduce((a, s) => a + s.area * (s.ce[2] - s.tack[2]), 0) / area;
  const foot = Math.max(0.3, 3 * arm);
  const luff = Math.max(1, (ce[1] - boomY) / ceHeightFrac);
  const tack = [0, ce[1] - ceHeightFrac * luff, ce[2] - foot / 3];
  return { tack, luff, foot, area, ce, ceHeightFrac };
}

/** The roll-up's CG: the items' mass-weighted centroid (§3.4), each where it is. */
export function rollUp(items) {
  const m = items.reduce((a, it) => a + it.massKg, 0);
  const s = [0, 0, 0];
  for (const it of items) for (let i = 0; i < 3; i++) s[i] += it.massKg * it.atM[i];
  return { massKg: m, cgM: s.map((v) => v / m + 0) };
}

/** A sail's coefficients tabulated (§6.2's table) at δ = 0 on its α grid. */
function coeffsOf(model, slope, cnExp) {
  const alphaDeg = [];
  for (let a = -30; a <= 120 + 1e-9; a += 2.5) alphaDeg.push(a);
  const out = [0, 0];
  const cl = [], cd = [];
  for (const a of alphaDeg) {
    rigSailCoeffs(out, model, slope, a, 0, cnExp);
    cl.push(out[0]);
    cd.push(out[1]);
  }
  return { alphaDeg, cl, cd };
}

/** A sail in the contract's frame (§3.6). */
function contractSail(s, { reefs, furl, sheeting, coeffs }) {
  return {
    id: s.id,
    kind: s.kind,
    model: clone(s.model),
    polygonM: s.polygon.map(C),
    areaM2: s.area,
    ceM: C(s.ce),
    tackM: C(s.tack),
    headM: C(s.head),
    clewM: C(s.clew),
    luffM: s.luff,
    footM: s.foot,
    ar: s.ar,
    liftSlope: s.liftSlope,
    reefs,
    furl,
    sheeting,
    coeffs,
  };
}

/** A body-frame sail as rig-sails.js reads one (its tack, head, clew, polygon, area, CE, luff). */
const asBodySail = (s) => ({ tackM: s.tack, headM: s.head, clewM: s.clew, polygonM: s.polygon, areaM2: s.area, ceM: s.ce, luffM: s.luff });

/** The length-weighted centroid of wires (each [from, ...via, to]). */
function wiresCentroid(paths) {
  const items = [];
  for (const path of paths) for (let i = 1; i < path.length; i++) items.push({ at: scale(add(path[i - 1], path[i]), 0.5), by: len(sub(path[i], path[i - 1])) });
  return weighted(items);
}

/**
 * The stock sloop's contract from her drawing (ship.js rigDrawing: points in
 * her body frame, and `deckAt(x, z)`, her drawn surface's height).
 * @param {ReturnType<import("./ship.js").rigDrawing>} d
 */
export function stockContract(d) {
  const models = KEPT.models;
  const sm = KEPT.sailModel;
  const main = stockMain(d, models.main);
  const jib = stockJib(d, models.jib);
  const body = { main: asBodySail(main), jib: asBodySail(jib) };

  // the main's reefs (§3.6, the aid's rule: rig-sails.js reefed)
  const reefs = KEPT.reefFractions.map((f) => {
    const r = reefed(body.main, f);
    return { fraction: f, polygonM: r.polygon.map(C), areaM2: r.area, ceM: C([0, r.ce[1], r.ce[2]]), luffM: r.luff };
  });
  const E = main.foot;

  // the jib's leads (§3.9), at the family's least sheeting angle, each side
  const minDeg = models.jib.sheet[0];
  const maxDeg = JIB_EASED_DEG;
  const leads = { port: [], starboard: [] };
  for (const furl of LEAD_FURLS) {
    leads.port.push({ furl, atM: C(leadAt(body.jib, furl, -1, minDeg, d.deckAt)) });
    leads.starboard.push({ furl, atM: C(leadAt(body.jib, furl, 1, minDeg, d.deckAt)) });
  }
  const track = (list) => {
    const xs = [...list].sort((a, b) => b.atM[0] - a.atM[0]);
    return { trackFromM: xs[0].atM, trackToM: xs[xs.length - 1].atM };
  };

  const sails = [
    contractSail(main, { reefs, furl: 0, sheeting: { minDeg: models.main.sheet[0], maxDeg: models.main.sheet[1], wing: null, boom: { gooseneckM: C(d.boom.gooseneck), endM: C(d.boom.end), lengthM: d.boom.length }, lead: null }, coeffs: coeffsOf(models.main, main.liftSlope, sm.cnExp) }),
    contractSail(jib, { reefs: [], furl: 0, sheeting: { minDeg, maxDeg, wing: clone(models.jib.wing), boom: null, lead: { port: leads.port[0].atM, starboard: leads.starboard[0].atM } }, coeffs: coeffsOf(models.jib, jib.liftSlope, sm.cnExp) }),
  ];

  // the sets (§3.6, §6.3): full sail, then one per reef of the main
  const mastheadY = d.mast.head[1];
  const heM = sm.spanFactor * mastheadY;
  const setOf = (id, reef, parts) => {
    const area = parts.reduce((a, p) => a + p.area, 0);
    return { id, reef, sails: ["main", "jib"], areaM2: area, ceM: C(weighted(parts.map((p) => ({ at: p.ce, by: p.area })))), heM, are: (heM * heM) / area, trimmed: null };
  };
  const reefBody = KEPT.reefFractions.map((f) => reefed(body.main, f));
  const sets = [
    setOf("full", -1, [main, jib]),
    ...reefBody.map((r, i) => setOf(`reef${i + 1}`, i, [{ area: r.area, ce: [0, r.ce[1], r.ce[2]] }, jib])),
  ];

  // the rig (§3.7), as drawn
  const step = d.mast.step;
  const P = main.luff;
  const I = d.forestay.to[1] - step[1];
  const J = jib.J;
  const mastMass = KEPT.loading.items.find((it) => it.id === "mast").massKg;
  const standing = [
    { id: "forestay", fromM: C(d.forestay.from), toM: C(d.forestay.to), viaM: [] },
    { id: "backstay", fromM: C(d.backstay.from), toM: C(d.backstay.to), viaM: [] },
    ...d.caps.map((c) => ({ id: `cap-shroud-${c.side < 0 ? "port" : "starboard"}`, fromM: C(c.from), toM: C(c.to), viaM: [C(c.via)] })),
    // she has a forward and an aft lower each side; the schema names one per side, so both carry it
    ...d.lowers.map((l) => ({ id: `lower-shroud-${l.side < 0 ? "port" : "starboard"}`, fromM: C(l.from), toM: C(l.to), viaM: [] })),
  ];
  const mainTri = { area: 0.5 * P * E, ce: scale(add(add(main.tack, main.head), main.clew), 1 / 3) };
  const foreTri = { area: 0.5 * I * J, ce: scale(add(add(jib.tack, d.forestay.to), [step[0], jib.tack[1], step[2]]), 1 / 3) };
  const full = sets[0];
  const rig = {
    type: "masthead",
    I,
    J,
    P,
    E,
    BAS: d.boom.gooseneck[1] - step[1],
    ISP: null,
    LP: J,
    rakeDeg: 0,
    mast: { stepM: C(step), partnersM: C(step), headM: C(d.mast.head), heightM: d.mast.height, lengthM: d.mast.height, massKg: mastMass, kgPerM: mastMass / d.mast.height, stepped: "deck", stayed: true, sectionM: d.mast.section },
    boom: { gooseneckM: C(d.boom.gooseneck), endM: C(d.boom.end), lengthM: d.boom.length },
    standing,
    spreaders: [{ heightM: d.spreaders.height, rootM: C(d.spreaders.root), tipsM: d.spreaders.tips.map(C), lengthM: len(sub(d.spreaders.tips[0], d.spreaders.root)) }],
    designer: { areaM2: mainTri.area + foreTri.area, ceM: C(weighted([{ at: mainTri.ce, by: mainTri.area }, { at: foreTri.ce, by: foreTri.area }])) },
    actual: { areaM2: full.areaM2, ceM: full.ceM },
  };

  // the hardpoints (§3.9), as drawn; the rudder stock and crew stations are the fixture's
  const boomM = add(d.boom.gooseneck, scale(sub(d.boom.end, d.boom.gooseneck), (0.95 * E) / d.boom.length));
  const hardpoints = {
    mastStepM: C(step),
    mastPartnersM: C(step),
    mastheadM: C(d.mast.head),
    stemheadM: C(d.stemhead),
    forestayTackM: C(d.forestay.from),
    innerForestayTackM: null,
    backstayPlateM: C(d.backstay.to),
    chainplates: [
      { id: "port", atM: C(d.chainplates.port) },
      { id: "starboard", atM: C(d.chainplates.starboard) },
    ],
    rudderStock: clone(KEPT.hardpoints.rudderStock),
    mainsheet: { boomM: C(boomM), travellerM: d.traveller.map(C) },
    jibLeads: [
      { sail: "jib", side: "port", ...track(leads.port), leads: leads.port },
      { sail: "jib", side: "starboard", ...track(leads.starboard), leads: leads.starboard },
    ],
    halyardExits: [
      { sail: "main", atM: C(main.head) },
      { sail: "jib", atM: C(jib.head) },
    ],
    crewStations: clone(KEPT.hardpoints.crewStations),
  };

  // the loading (§3.4): the fixture's, its rig items moved to where she draws them
  const moved = {
    mast: C(lerp3(step, d.mast.head, 0.5)),
    boom: C(lerp3(d.boom.gooseneck, d.boom.end, 0.5)),
    rigging: C(wiresCentroid([[d.forestay.from, d.forestay.to], [d.backstay.from, d.backstay.to], ...d.caps.map((c) => [c.from, c.via, c.to]), ...d.lowers.map((l) => [l.from, l.to])])),
    "sail-main": C(main.ce),
    "sail-jib": C(jib.ce),
  };
  const loading = clone(KEPT.loading);
  for (const it of loading.items) if (moved[it.id]) it.atM = moved[it.id];
  // the items' masses are the fixture's, so their total is its massKg (to its 9 digits); the CG is re-rolled up exactly
  loading.cgM = rollUp(loading.items).cgM.map((v) => Math.round(v * 1e12) / 1e12 + 0);
  loading.gyradiiBasis = `${loading.gyradiiBasis} Kept from the 12 m fixture: not re-estimated for the stock drawing.`;

  const lumped = lumpedSailOf([main, jib], d.boom.gooseneck[1], 0.38);

  return {
    format: "patchwork-rig",
    version: 1,
    name: "sailing stock sloop",
    frame: {
      axes: "x-forward-y-port-z-up",
      units: "m",
      originDescription: "The stock hull's own frame: midships on her waterline (her body frame), x forward, y port, z up; she floats at z = 0.",
      // her hull GLB is her body frame (x starboard, y up, z aft): p ↦ (−z, −x, y)
      glbToFrame: [0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1],
      glbAxes: { bow: "-Z", up: "+Y" },
      design: { ...clone(KEPT.frame.design), sourceWaterplaneZM: 0 },
    },
    source: {
      generator: STOCK_GENERATOR,
      rigDoc: null,
      rigHeads: null,
      hull: { kind: "synthetic", url: null, path: null, label: "the 12 m sloop's synthetic hull, her principal dimensions", heads: null, glbKey: STOCK_GLB_KEY },
      statics: KEPT.source.statics,
    },
    hull: clone(KEPT.hull),
    loading,
    appendages: clone(KEPT.appendages),
    sails,
    sailModel: clone(sm),
    sets,
    rig,
    resistance: clone(KEPT.resistance),
    hardpoints,
    loads: null,
    predicted: {
      status: "not-computed",
      why: "generated by sailing from the stock drawing; the rig aid's VPP wasn't run on it",
      conditions: { twsMs: [], twaDeg: [], reference: { twsMs: 6.17333333, twaDeg: 45 } },
      reference: null,
      helm: null,
      points: [],
      beat: [],
      run: [],
    },
    lumpedSail: { tackM: C(lumped.tack), luffM: lumped.luff, footM: lumped.foot, areaM2: lumped.area, ceM: C(lumped.ce), ceHeightFrac: lumped.ceHeightFrac },
    warnings: [...KEPT.warnings],
    rules: KEPT.rules,
  };
}
