// Windage: the wind on what isn't sail (the hull above the water, the mast,
// the standing rigging), as the rig contract states it (§3.13) and composes
// it (§6.1). Pure.
//
// COPIED, never linked, from naval/src/naval/windage.js (patchwork-
// experiments, as of 7d473f91, "rigging windage is four stays wide"): its
// rules (WINDAGE_SOURCE, WINDAGE_RULES, mastSection, wireDiameter,
// meanFreeboard), its element builder and elementForce, with these changes:
// - the builder is split in two, hullElement (the hull from her LOA, beam
//   and sheer) and rigElements (the mast and rigging from her rig), so a
//   contract that keeps a hull element (the stock sloop keeps the 12 m
//   fixture's) states only its rig's;
// - rigElements takes the mast's width (`mastWidthM`: a contract's
//   `rig.mast.sectionM`, or mastSection of a length where nothing is
//   drawn) where naval works it out from the mast's length, and planOf
//   reads its `plan` off a contract's rig and sails;
// - contractElement states one element in the contract's frame, as naval's
//   contract.js windageOf does (atM is the profile point on the centreplane,
//   or on the plane y a ship's box stands on);
// - elementForce takes the air at the element in her heeled sail plane as
//   its two components (AWS_e·sin β_e square to her centreplane, AWS_e·cos
//   β_e along it), not as AWS_e and β_e, and the sine of the heel its heeled
//   side area grows by, so the physics can call it with the air it has; its
//   centre (atM, lifted zPerSinHeelM·sin φ) is the caller's to place.
// physics.js flies every element through elementForce, the one force law.
// windage.test.js holds this copy to what naval states: every fixture's
// elements and mast sections, and compose.js's windage force at a finite
// table of states. Those are naval's outputs as copied, so an edit here
// shows; a change in naval does not (sailing stands alone, CLAUDE.md), so
// when naval's rules change, re-copy them with the contract's files.
//
// The elements, their areas, drag coefficients and heights are ORC's
// (ORC VPP Documentation 2023, §5.3 "Windage Forces", Table 5.10, eqs.
// 5.27–5.28 and 5.31–5.33), with naval's geometry where ORC uses a
// measurement:
//
//   hull        frontal FBAV·B, side FBAV·LOA + 0.75·(B/2)·LOA·sin φ (eq. 5.28,
//               ORC's pre-2017 heeled side area), Cd 0.816 both, its centre
//               0.66·(FBAV + B·sin φ) above the water, at mid-LOA.
//               FBAV: the sheer's mean height above the waterplane over the
//               LOA (eq. 5.27's fb), B the beam overall.
//   mast, sail  the mast beside the main's luff (BAS to BAS + P up the mast):
//               width × P, Cd 0.4 head-on and 0.6 abeam (Table 5.10's
//               MAST-Sail), at its middle.
//   mast, bare  the rest of the mast above the partners: width × length,
//               Cd 0.8, at its middle.
//   rigging     a stayed rig: four stays of diameter d, I × 4·d, Cd 1.0 ×
//               (1 + 0.2) for the spreaders (eq. 5.33), at half I. d is the
//               cap shroud's: a 1×19 wire whose breaking load is 2.5 × the
//               chainplate load at RM30 (RM30 over the chainplate base,
//               §3.10), at a nominal breaking stress of 1.0 GPa. Both
//               constants are rules of thumb (naval's: to verify).
//   Not included: the crew, the boom, the pulpits and the dodger.
//
// How each element meets the air (the same apparent wind as the sails, §6.1:
// q_e = ½ρ·AWS_e², at β_e in the heeled sail plane; no gradient):
//
//   body (the hull)  cross flow: Fx = −q_e·Cd_f·A_f·cos β_e·|cos β_e| along
//                    the boat, Fh = q_e·Cd_s·A_s(φ)·sin β_e·|sin β_e| square
//                    to the mast.
//   spar (mast, rigging)  drag along the apparent wind, D = q_e·A·Cd(β_e),
//                    Fx = −D·cos β_e, Fh = D·sin β_e,
//                    Cd(β) = Cd_f·cos²β + Cd_s·sin²β.
//
// Each element's Fx and Fh act at its own centre (x, z).

const RAD = Math.PI / 180;
const fin = (v) => Number.isFinite(v);

export const WINDAGE_SOURCE =
  "ORC VPP Documentation 2023, §5.3 Windage Forces (Table 5.10; eqs. 5.27, 5.28, 5.31–5.33), orc.org, retrieved 2026-11-12: the elements, areas, drag coefficients and heights. Resolution: cross flow on the hull, drag along the flow on spars (this package's; ORC resolves every element along the apparent wind).";

/** ORC Table 5.10's drag coefficients, and the rules of thumb naval adds. */
export const WINDAGE_RULES = Object.freeze({
  hullCd: 0.816,
  hullZ: 0.66,
  hullHeelSide: 0.75,
  mastSailCd: Object.freeze([0.4, 0.6]),
  mastBareCd: 0.8,
  riggingCd: 1.0,
  stays: 4,
  spreaderFactor: 0.2,
  wireBreakFactor: 2.5,
  wireStressPa: 1.0e9,
});

/** The mast's drawn width (drawing only, not a scantling): 0.0055·L + 0.01 m, L its length. */
export const mastSection = (L) => 0.0055 * L + 0.01;

/** The cap shroud's diameter for a chainplate load (N): 1×19 breaking at wireBreakFactor × it. */
export const wireDiameter = (chainplateN) => (chainplateN > 0 ? Math.sqrt((4 * WINDAGE_RULES.wireBreakFactor * chainplateN) / (Math.PI * WINDAGE_RULES.wireStressPa)) : 0);

/**
 * The sheer's mean height above the waterplane over the LOA (ORC's fb), by
 * the trapezoid rule on n stations from the stern to the stem.
 */
export function meanFreeboard(sheerAt, sternX, stemX, n = 40) {
  let s = 0, w = 0;
  for (let i = 0; i <= n; i++) {
    const x = sternX + ((stemX - sternX) * i) / n;
    const z = sheerAt(x);
    if (!fin(z)) continue;
    const k = i === 0 || i === n ? 0.5 : 1;
    s += k * Math.max(0, z);
    w += k;
  }
  return w > 0 ? s / w : 0;
}

/**
 * The hull's element, in the profile plane ([x, z], the waterplane z = 0),
 * or null when she has no freeboard, length or beam.
 * @param {{ loa: number, beam: number, stemX: number, sternX: number, sheerAt: (x: number) => number }} g
 */
export function hullElement({ loa, beam, stemX, sternX, sheerAt }) {
  const W = WINDAGE_RULES;
  const fb = meanFreeboard(sheerAt, sternX, stemX);
  if (!(fb > 0 && loa > 0 && beam > 0)) return null;
  return {
    id: "hull",
    shape: "body",
    areaFrontM2: fb * beam,
    areaSideM2: fb * loa,
    sidePerSinHeelM2: W.hullHeelSide * (beam / 2) * loa,
    cdFront: W.hullCd,
    cdSide: W.hullCd,
    at: [(stemX + sternX) / 2, W.hullZ * fb],
    zPerSinHeelM: W.hullZ * beam,
    freeboardM: fb,
  };
}

/**
 * The mast's and the standing rigging's elements, in the profile plane.
 * `plan` is the rig: { mast: { partners: [x, z], heightM (above the
 * partners) }, rakeDeg, BAS, P, I, type, sails: [{ id }] }.
 * @param {{ plan: object, mastWidthM: number, rm30Nm: number|null, chainplateBaseM: number|null }} g
 */
export function rigElements({ plan, mastWidthM, rm30Nm, chainplateBaseM }) {
  const W = WINDAGE_RULES;
  const out = [];
  const m = plan?.mast;
  if (!m || !(m.heightM > 0)) return out;
  const th = (plan.rakeDeg ?? 0) * RAD;
  const along = (h) => [m.partners[0] - Math.sin(th) * h, m.partners[1] + Math.cos(th) * h];
  const width = mastWidthM;
  const spar = (id, from, to, cd) => {
    const L = to - from;
    if (!(L > 1e-9)) return null;
    return { id, shape: "spar", lengthM: L, widthM: width, areaFrontM2: width * L, areaSideM2: width * L, sidePerSinHeelM2: 0, cdFront: cd[0], cdSide: cd[1], at: along((from + to) / 2), zPerSinHeelM: 0 };
  };
  const hasMain = plan.sails?.some((s) => s.id === "main") && plan.P > 0;
  const lo = hasMain ? Math.min(m.heightM, plan.BAS) : m.heightM;
  const hi = hasMain ? Math.min(m.heightM, plan.BAS + plan.P) : m.heightM;
  const sail = spar("mast-sail", lo, hi, W.mastSailCd);
  if (sail) out.push(sail);
  // the bare mast: below the boom and above the head, one element at their length-weighted middle
  const parts = [[0, lo], [hi, m.heightM]].filter(([a, b]) => b - a > 1e-9);
  const bareL = parts.reduce((t, [a, b]) => t + (b - a), 0);
  if (bareL > 1e-9) {
    const mid = parts.reduce((t, [a, b]) => t + ((a + b) / 2) * (b - a), 0) / bareL;
    out.push({ ...spar("mast-bare", 0, bareL, [W.mastBareCd, W.mastBareCd]), at: along(mid) });
  }
  if (plan.type !== "cat" && plan.I > 0 && rm30Nm > 0 && chainplateBaseM > 0) {
    const d = wireDiameter(rm30Nm / chainplateBaseM);
    const A = plan.I * W.stays * d;
    const cd = W.riggingCd * (1 + W.spreaderFactor);
    out.push({ id: "rigging", shape: "spar", lengthM: plan.I, widthM: W.stays * d, wireDiameterM: d, areaFrontM2: A, areaSideM2: A, sidePerSinHeelM2: 0, cdFront: cd, cdSide: cd, at: along(plan.I / 2), zPerSinHeelM: 0 });
  }
  return out;
}

/**
 * rigElements's `plan`, read off a contract's rig (§3.7: its mast's partners
 * on the centreplane, height, rake, BAS, P, I and type) and its sails (§3.8).
 */
export function planOf(rig, sails) {
  const ps = rig.mast.partnersM;
  return { mast: { partners: [ps[0], ps[2]], heightM: rig.mast.heightM }, rakeDeg: rig.rakeDeg, BAS: rig.BAS, P: rig.P, I: rig.I, type: rig.type, sails: (sails ?? []).map((s) => ({ id: s.id })) };
}

/**
 * An element as §3.13 states it, in the contract's frame: its profile point
 * on the centreplane, or on the fore-and-aft plane `y` (a ship's box off
 * her body's centre: hull-model.js plainWindage). An option, so that
 * `.map(contractElement)` stays on the centreplane.
 */
export function contractElement(e, { y = 0 } = {}) {
  return {
    id: e.id,
    shape: e.shape,
    areaFrontM2: e.areaFrontM2,
    areaSideM2: e.areaSideM2,
    sidePerSinHeelM2: e.sidePerSinHeelM2,
    cdFront: e.cdFront,
    cdSide: e.cdSide,
    atM: [e.at[0], y, e.at[1]],
    zPerSinHeelM: e.zPerSinHeelM,
  };
}

/**
 * One contract element's force (§6.1: compose.js's windageAt) from the air
 * at its centre in her heeled sail plane: `side` square to her centreplane
 * (AWS_e·sin β_e, + toward where it blows), `along` along it (AWS_e·cos
 * β_e, + from ahead), at air density `rho`, its body's side area grown by
 * sidePerSinHeelM2·`sinHeel`. The body meets it in cross flow, each axis
 * its own area; a spar drags along it.
 * @returns {number[]} `out`: [the force square to her centreplane (§6.1's Fh), along it aft (§6.1's −Fx)]
 */
export function elementForce(e, side, along, sinHeel, rho, out = [0, 0]) {
  const h = 0.5 * rho;
  if (e.shape === "body") {
    out[0] = h * e.cdSide * (e.areaSideM2 + e.sidePerSinHeelM2 * sinHeel) * side * Math.abs(side);
    out[1] = h * e.cdFront * e.areaFrontM2 * along * Math.abs(along);
  } else {
    const u = Math.hypot(side, along);
    const d = u > 0 ? (h * e.areaFrontM2 * (e.cdFront * along * along + e.cdSide * side * side)) / u : 0;
    out[0] = d * side;
    out[1] = d * along;
  }
  return out;
}
