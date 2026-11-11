// A first guess from a hull: a whole proposed boat (rig, keel and rudder,
// ballast, crew) sized from the floated hull by rules of thumb, so a newly
// linked hull opens to something sensible rather than an empty form. Every
// rule is in RULES with its basis; each is a starting point, marked "to
// verify", and everything the guess writes is marked estimated in the doc.
//
// Two of the rules are solved, not just applied:
//
// - P (with E and I tied to it, J by its rule), in closed form, so the
//   designer's SA/D is the target exactly.
// - The mast's position, so the lead is the middle of its band (sloops and
//   cutters; no band is quoted for a cat, whose mast goes by its rule). The
//   rig is upright and moves as one piece: the forestay's tack goes aft of
//   the stem with the mast, so J, the sail plan and its area stay. The keel
//   doesn't move with the rig, so the CLR stays and the designer's CE moves
//   exactly as far as the mast does:
//       lead(m) = lead(m₀) − (m − m₀) / LWL
//   strictly falling and affine in the mast's distance m aft of the stem.
//   lead(m₀) is read once from the tool's own model (computeNumbers) with
//   the tack at the stem (m₀ = J), and the answer is the one m that gives
//   the target, clamped to the bracket [J, LOA − E]: the tack at or aft of
//   the stem (J fits on the hull) and the boom's end at or forward of the
//   stern (which also keeps the mast on the hull). If the clamped position
//   is still outside the band, no position in the bracket is inside it
//   (the lead is monotone), and the result says so instead of a guess.
//
// Nothing else is optimised; the 1-D helpers (helpers.js) are the next
// step and the designer's call.

import { normalize } from "./doc.js";
import { computeNumbers } from "./numbers.js";
import { LEAD_BANDS, keelFamily } from "./naval/balance.js";
import { BULB_CP } from "./naval/foils.js";
import { RHO_SEA } from "./naval/units.js";

/** Lead, kg/m³: the bulb is sized to hold the ballast in it. */
export const LEAD_KG_M3 = 11340;
/** A bulb is this many diameters long (the same rule as the tool's fin-bulb choice). */
export const BULB_LENGTH_D = 4.5;

const VERIFY = "a rule of thumb: to verify";

/**
 * The rules, with what each is based on. Where the plan's rule disagreed with
 * the published boats in src/fixtures, the fixtures won, and the basis says so.
 */
export const RULES = {
  dinghyLwl: { value: 5, basis: "LWL under 5 m: a cat-rigged dinghy with a daggerboard and a hiking crew (the plan's split)", verify: VERIFY },
  saD: {
    keelboat: 17,
    dinghy: 25,
    basis:
      "Designer's SA/D: 17 for a keelboat, a moderate performance cruiser on the band commonly quoted after Brewer (Catalina 30 14.9, J/24 19.8); 25 for a dinghy, from the Laser's 24.2 on her 160 kg all up (the plan's 30 is above every dinghy fixture)",
    verify: VERIFY,
  },
  pOverE: { keelboat: 3, cat: 1.9, basis: "P/E 3 for a sloop's main (the plan; Catalina 3.0, J/24 2.9, stock 2.9); 1.9 for a cat's (Laser 5.13/2.74 = 1.87)", verify: VERIFY },
  basOverP: { value: 0.12, basis: "BAS 0.12·P (the plan; J/24 0.13, Laser 0.11)", verify: VERIFY },
  iOverP: {
    masthead: 1.03,
    fractional: 0.85,
    basis: "Masthead: I = BAS + 1.03·P, the forestay just above the head (Catalina 30: I/P 1.17 with BAS 0.12·P gives 1.15). Fractional: I = 0.85·(BAS + P), a 7/8 rig (J/24 0.845, stock 0.81)",
    verify: VERIFY,
  },
  draft: {
    keelboat: 0.2,
    dinghy: 0.18,
    basis:
      "Keelboat draft 0.20·LWL (Catalina 30 0.21, J/24 0.20, stock 0.18). The plan's 'twice the canoe body's draft' gives 0.9–1.1 m on these boats against their 1.2–1.9 m, so the fixtures' rule is used. Dinghy board span 0.18·LWL below the hull (Laser 0.68/3.81)",
    verify: VERIFY,
  },
  keelArea: {
    value: 0.04,
    minArGeom: 0.8,
    basis:
      "Keel (or board) planform 4% of the designer's sail area (the plan; stock 4.5%, Laser 3.3%). A fin is never stubbier than geometric AR 0.8 (span²/area; Catalina 30's estimated fin 0.73, J/24's 0.79): where the draft rule would make it so, it goes deeper",
    verify: VERIFY,
  },
  keelShape: { fin: { taper: 0.6, sweepDeg: 8, tc: 0.12 }, board: { taper: 1, sweepDeg: 0, tc: 0.1 }, basis: "A tapered, lightly swept fin, t/c 12%; a rectangular board, t/c 10% (Laser 0.097)", verify: VERIFY },
  keelAt: {
    keelAtLwl: 0.455,
    boardAtLwl: 0.42,
    basis:
      "A keelboat's keel with its quarter chord (on the MAC) 45.5% of the LWL aft of the waterline's forward end: the mean of the six fin-keel boats whose keels are from drawings (Soling 0.416, Farr 40 0.445, Cal 40 0.453, HR 40C 0.456, J/70 0.476, Contessa 32 0.486). The plan's 'over the LCB' put it 4–11% of the LWL aft of every one of them. A dinghy's board 42% (Laser 0.416, 470 0.426). The keel is not moved for the lead: the rig is (the mast rule). The helm is the helpers', and the first guess reports it",
    verify: VERIFY,
  },

  ballast: {
    value: 0.38,
    minFinWithBulb: 0.6,
    basis:
      "Keelboat ballast 0.38 of the displacement (the plan; Catalina 30 0.41, J/24 0.31), in a lead bulb 4.5 diameters long where that leaves a fin of at least 60% of the depth below the hull, otherwise in the fin; a dinghy's ballast is her crew",
    verify: VERIFY,
  },
  rudder: {
    at: 0.92,
    areaOfKeel: 0.35,
    dinghyAreaOfKeel: 0.45,
    ar: 2.5,
    taper: 0.7,
    sweepDeg: 5,
    tc: 0.12,
    basis:
      "A spade with its stock at 92% of the LWL from its forward end, 35% of the keel's area, geometric AR 2.5, its tip no deeper than 0.85 of the draft (the plan). A dinghy's is a kick-up on the transom at 45% of the board's area (Laser 0.46), AR 2.5 (Laser 2.6)",
    verify: VERIFY,
  },
  mast: {
    jOverLoa: 0.38,
    catAtLoa: 0.31,
    basis:
      "Sloops and cutters: J = 0.38·LOA (Farr 40 0.379, Catalina 30 0.384, Cal 40 0.386, Contessa 32 0.396, J/24 0.396, stock 0.40, HR 40C 0.372; by the LWL the same boats run 0.39–0.53, and 0.46·LWL was longer than a plumb-bowed hull's foredeck), and the mast where the lead over the extended-keel CLR is the middle of its band (a cutter uses the masthead's), the forestay's tack as far aft of the stem as that takes, never forward of it, and the boom's end never aft of the stern. Cat: 0.31·LOA aft of the stem (Laser 1.305/4.23); no lead band is quoted for a cat",
    verify: VERIFY,
  },
  headsail: { lpOverJ: 1.05, basis: "A 105% jib; a cutter's staysail I2 0.8·I, J2 0.5·J, LP2 0.45·J (as the tool's cutter choice)", verify: VERIFY },
  roach: { keelboat: 0.12, cat: 0.05, basis: "Roach 12% of the main's triangle on a sloop (the stock sloop's), 5% on a cat", verify: VERIFY },
  reefs: { keelboat: [0.15, 0.3], basis: "Two reefs, 15% and 30% of P, on a keelboat; none on a dinghy", verify: VERIFY },
  crew: { basis: "Keelboat: LOA/3 crew (2–8) of 80 kg sitting; dinghy: one 80 kg crew hiking (two over 250 kg displacement)", verify: VERIFY },
};

/** The lead band the first guess aims into, as fractions of LWL [lo, hi] (a cutter uses the masthead's); null where none is quoted. */
export function targetBand(rigType, keelKind) {
  const fam = keelFamily(keelKind);
  const b = fam ? LEAD_BANDS[fam][rigType === "cutter" ? "masthead" : rigType] : null;
  return b ? [b[0] / 100, b[1] / 100] : null;
}

/** The lead the first guess aims at: its band's middle. */
export function targetLead(rigType, keelKind) {
  const b = targetBand(rigType, keelKind);
  return b ? (b[0] + b[1]) / 2 : null;
}

/**
 * The mast position that gives a target lead, for a rig that moves as one
 * piece over a fixed keel: lead(m) = lead0 − (m − m0)/lwl, clamped to [lo, hi].
 * @returns {{ ok: true, m: number, lead: number, clamped: boolean } | { ok: false, m: number|null, lead: number|null }}
 *   ok when the lead at m is inside the band; when not, no m in [lo, hi] is (the lead is monotone in m)
 */
export function mastForBand({ lead0, m0, lwl, band, lo, hi }) {
  if (!(hi >= lo)) return { ok: false, m: null, lead: null };
  const want = m0 + (lead0 - (band[0] + band[1]) / 2) * lwl;
  const m = Math.min(hi, Math.max(lo, want));
  const lead = lead0 - (m - m0) / lwl;
  return { ok: lead >= band[0] && lead <= band[1], m, lead, clamped: m !== want };
}

/** P for a designer's area: ½·P·E + ½·I·J with E = P/r and I = c·P (c 0 for a cat). */
export function pForArea(area, { r, c, J }) {
  const a = 1 / (2 * r);
  const b = 0.5 * c * J;
  return (-b + Math.sqrt(b * b + 4 * a * area)) / (2 * a);
}

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * A first guess for a doc's hull.
 * @param {object} doc normalized; its hull (linked or principal dimensions) and displacement are kept
 * @param {{ linked?: object, statics?: object }} [ctx] the tool's linked-hull state (and statics, unused here)
 * @param {{ type?: "masthead"|"fractional"|"cutter"|"cat" }} [opts] override the rig type the rules choose
 * @returns {{ ok: true, doc: object, estimated: string[], report: object } | { ok: false, why: string }}
 */
export function firstGuess(doc, ctx = {}, opts = {}) {
  const n0 = computeNumbers(doc, { linked: ctx.linked });
  const form = n0.form;
  if (!form) return { ok: false, why: n0.hullState === "synthetic" ? "the principal dimensions don't make a hull" : "the linked hull isn't read yet" };
  const h = form.hydro;
  const geo = n0.analysis.geo;
  const massKg = n0.displacement.kg;
  if (!(massKg > 0)) return { ok: false, why: "no displacement: give one (Loading) first" };
  const lwl = h.lwl;
  const loa = form.loa;
  const stemX = geo.stemX;
  const dinghy = lwl < RULES.dinghyLwl.value;
  const type = opts.type ?? (dinghy ? "cat" : "masthead");
  const cat = type === "cat";
  const vol = massKg / RHO_SEA;
  const saD = dinghy ? RULES.saD.dinghy : RULES.saD.keelboat;
  const area = saD * Math.pow(vol, 2 / 3);
  const depthAt = (x) => Math.max(0, -(geo.bottomAt(x) ?? 0));

  // ── the rig: J by its rule, P solved for the area; the mast starts with the tack at the stem (cat: by LOA)
  const r = cat ? RULES.pOverE.cat : RULES.pOverE.keelboat;
  const bas = RULES.basOverP.value;
  const c = cat ? 0 : type === "fractional" ? RULES.iOverP.fractional * (1 + bas) : bas + RULES.iOverP.masthead;
  const J = cat ? 0 : RULES.mast.jOverLoa * loa;
  const mastX = cat ? RULES.mast.catAtLoa * loa : J;
  const P = pForArea(area, { r, c, J });
  const BAS = bas * P;
  const I = cat ? 0 : type === "fractional" ? RULES.iOverP.fractional * (BAS + P) : BAS + RULES.iOverP.masthead * P;
  const rig0 = {
    type,
    mast: { aftOfStem: round(mastX), rakeDeg: 0, stepped: dinghy ? "deck" : "keel", kgPerM: null },
    I: round(I),
    P: round(P),
    E: round(P / r),
    BAS: round(BAS),
    ISP: null,
    forestayAftOfStem: 0,
    main: { roach: cat ? RULES.roach.cat : RULES.roach.keelboat, reefs: dinghy ? [] : [...RULES.reefs.keelboat] },
    headsail: cat ? null : { kind: "jib", LP: round(RULES.headsail.lpOverJ * J), clewHeight: null, furl: 0 },
    staysail: type === "cutter" ? { I2: round(0.8 * I), J2: round(0.5 * J), LP2: round(0.45 * J), clewHeight: null } : null,
  };

  // ── ballast, and the draft the keel reaches
  const ballastKg = dinghy ? 0 : RULES.ballast.value * massKg;
  const bulbD = ballastKg > 0 ? Math.cbrt(ballastKg / LEAD_KG_M3 / (BULB_CP * (Math.PI / 4) * BULB_LENGTH_D)) : 0;
  const draft = (dinghy ? RULES.draft.dinghy : RULES.draft.keelboat) * lwl; // a dinghy's: the board below the hull
  const shape = dinghy ? RULES.keelShape.board : RULES.keelShape.fin;
  const keelArea = RULES.keelArea.value * area;
  const tanLE = Math.tan((shape.sweepDeg * Math.PI) / 180);
  const lam = shape.taper;

  /** The keel with its MAC's quarter chord at x: span to the draft, chord from the area. */
  const keelAt = (xq) => {
    let cr = Math.sqrt(keelArea), span = 0, bulb = null, xRootLE = xq;
    for (let i = 0; i < 6; i++) {
      const below = dinghy ? draft : Math.max(0, draft - depthAt(xRootLE - cr / 4));
      // a bulb only where it leaves a fin of at least 60% of the depth below the hull
      bulb = !dinghy && bulbD > 0 && below - bulbD >= RULES.ballast.minFinWithBulb * below ? { length: round(BULB_LENGTH_D * bulbD, 3), diameter: round(bulbD, 3) } : null;
      // never stubbier than the minimum aspect ratio: the keel goes deeper instead
      span = Math.max(0.25 * draft, below - (bulb ? bulbD : 0), dinghy ? 0 : Math.sqrt(RULES.keelArea.minArGeom * keelArea));
      cr = (2 * keelArea) / (span * (1 + lam));
      const mac = (2 / 3) * cr * ((1 + lam + lam * lam) / (1 + lam));
      const yMac = (span / 3) * ((1 + 2 * lam) / (1 + lam));
      xRootLE = xq + yMac * tanLE + mac / 4;
    }
    return {
      kind: dinghy ? "daggerboard" : bulb ? "fin-bulb" : "fin",
      aftOfStem: round(stemX - xRootLE),
      span: round(span),
      rootChord: round(cr),
      tipChord: round(lam * cr),
      sweepDeg: shape.sweepDeg,
      tc: shape.tc,
      bulb,
    };
  };

  // ── rudder (its size from the keel's area; placed by the hull)
  const R = RULES.rudder;
  const rudArea = (dinghy ? R.dinghyAreaOfKeel : R.areaOfKeel) * keelArea;
  let rudder;
  if (dinghy) {
    const span = Math.sqrt(R.ar * rudArea);
    const chord = rudArea / span;
    rudder = { kind: "kick-up", aftOfStem: round(stemX - form.stern[0] + 0.02), span: round(span), rootChord: round(chord), tipChord: round(chord), sweepDeg: 0, tc: 0.1, maxDeg: 30, stockFrac: 0.15 };
  } else {
    const xStock = h.xFwd - R.at * lwl;
    const rootDepth = depthAt(xStock);
    let span = Math.sqrt(R.ar * rudArea);
    span = Math.min(span, Math.max(0.3 * span, 0.85 * draft - rootDepth));
    const cr = (2 * rudArea) / (span * (1 + R.taper));
    rudder = {
      kind: "spade",
      aftOfStem: round(stemX - xStock - 0.2 * cr),
      span: round(span),
      rootChord: round(cr),
      tipChord: round(R.taper * cr),
      sweepDeg: R.sweepDeg,
      tc: R.tc,
      maxDeg: 35,
      stockFrac: 0.2,
    };
  }

  const crewCount = dinghy ? (massKg > 250 ? 2 : 1) : Math.min(8, Math.max(2, Math.round(loa / 3)));
  const candidate = (keel, rig) =>
    normalize({
      ...doc,
      rig,
      appendages: { keel, rudder },
      loading: {
        ...doc.loading,
        ballast: { kg: round(ballastKg, 1), at: keel.bulb ? "bulb" : dinghy ? "hull" : "keel" },
        crew: { count: crewCount, kgEach: 80, mode: dinghy ? "hiking" : "sitting", arm: null },
      },
    });

  // ── the keel: its quarter chord a fraction of the LWL aft of the waterline's forward end (keelboat and dinghy each by its rule)
  const keel = keelAt(h.xFwd - (dinghy ? RULES.keelAt.boardAtLwl : RULES.keelAt.keelAtLwl) * lwl);
  const bulb = keel.bulb;

  // ── the mast: where the lead is its band's middle (see the header); a cat's stays by its rule
  const band = targetBand(type, keel.kind);
  let rig = rig0, mast = null;
  if (band) {
    const lead0 = computeNumbers(candidate(keel, rig0), { linked: ctx.linked }).analysis.balance.lead;
    const lo = J, hi = loa - rig0.E;
    mast = { ...mastForBand({ lead0, m0: mastX, lwl, band, lo, hi }), lo, hi };
    if (!mast.ok) {
      const pct = (v) => `${(100 * v).toFixed(1)}%`;
      const bandText = `${pct(band[0])}–${pct(band[1])}`;
      const m = (v) => `${v.toFixed(2)} m`;
      return {
        ok: false,
        why:
          mast.m == null
            ? `this hull is too heavy to rig by the rules: at ${(massKg / 1000).toFixed(1)} t, SA/D ${saD} is ${area.toFixed(0)} m², whose J ${m(J)} and boom ${m(rig0.E)} are together longer than her ${m(loa)} overall`
            : `no mast position balances this hull: with the keel where its rule puts it, the lead is in its ${bandText} band nowhere from ${m(lo)} (the forestay's tack at the stem) to ${m(hi)} aft of the stem (the boom's end at the stern); the nearest, at ${m(mast.m)}, gives ${pct(mast.lead)}`,
      };
    }
    rig = { ...rig0, mast: { ...rig0.mast, aftOfStem: round(mast.m) }, forestayAftOfStem: round(mast.m - J) };
  }
  const out = candidate(keel, rig);
  const n1 = computeNumbers(out, { linked: ctx.linked, statics: ctx.statics });
  const xq = n1.analysis.app.keel ? n1.analysis.app.keel.qc[0] : NaN;

  const estimated = [
    "rig.type",
    "rig.mast.aftOfStem",
    "rig.mast.stepped",
    "rig.I",
    "rig.P",
    "rig.E",
    "rig.BAS",
    "rig.forestayAftOfStem",
    "rig.main.roach",
    "rig.main.reefs",
    ...(rig.headsail ? ["rig.headsail.LP"] : []),
    ...(rig.staysail ? ["rig.staysail.I2", "rig.staysail.J2", "rig.staysail.LP2"] : []),
    ...["kind", "aftOfStem", "span", "rootChord", "tipChord", "sweepDeg", "tc"].flatMap((k) => [`appendages.keel.${k}`, `appendages.rudder.${k}`]),
    ...(bulb ? ["appendages.keel.bulb.length", "appendages.keel.bulb.diameter"] : []),
    "loading.ballast.kg",
    "loading.crew.count",
  ];
  out.prov = { ...Object.fromEntries(Object.entries(out.prov).filter(([k]) => !/^(rig|appendages|loading\.(ballast|crew))\./.test(k))), ...Object.fromEntries(estimated.map((k) => [k, "estimated"])) };
  out.sources = [
    ...out.sources.filter((s) => s.id !== "first-guess"),
    { id: "first-guess", what: "Rig, keel, rudder, ballast and crew", cite: "naval/src/firstguess.js RULES: rules of thumb from the hull, each to verify" },
  ];
  return {
    ok: true,
    doc: out,
    estimated,
    report: { type, dinghy, saD, areaM2: area, draftRuleM: draft, keelAreaM2: keelArea, targetLead: band ? (band[0] + band[1]) / 2 : null, mastRangeM: mast ? [mast.lo, mast.hi] : null, mastClamped: mast?.clamped ?? false, tackAftOfStemM: rig.forestayAftOfStem, lead: n1.analysis.balance.lead, leadBand: n1.analysis.balance.leadBand.label, helmDeg: n1.reference?.ok ? n1.reference.rudder : null, helm: n1.helm?.text ?? null, draftOverallM: -Math.min(...n1.analysis.app.foils.map((f) => f.bottomZ)), keelQcFromLcbM: xq - h.lcb, keelQcFromLcbFrac: (xq - h.lcb) / lwl },
  };
}

/** The parts of a doc the first guess replaces: written in one change. */
export const FIRST_GUESS_KEYS = ["rig", "appendages", "loading", "prov", "sources"];
