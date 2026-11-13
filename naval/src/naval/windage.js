// Windage: the wind on what isn't sail (the hull above the water, the mast,
// the standing rigging). Pure. The VPP (vpp.js), the reef winds
// (analysis.js) and the contract (§6.1, `windage`) read the same elements,
// and the contract's reference consumer (compose.js) evaluates them by the
// same two rules.
//
// The elements, their areas, drag coefficients and heights are ORC's
// (ORC VPP Documentation 2023, §5.3 "Windage Forces", Table 5.10, eqs.
// 5.27–5.28 and 5.31–5.33), with this package's geometry where ORC uses a
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
//               Cd 0.8, at its middle. The width is the contract's
//               `rig.mast.sectionM` (a drawing's rule, 0.0055·L + 0.01 m:
//               an estimate, not a section).
//   rigging     a stayed rig: I × 2·d (eq. 5.32, ORC's "factor of 2 means
//               four stays"), Cd 1.0 × (1 + 0.2) for the spreaders (eq. 5.33),
//               at half I. ORC sizes d from a default rigging weight it
//               doesn't publish; here d is the cap shroud's: a 1×19 wire
//               whose breaking load is 2.5 × the chainplate load at RM30
//               (RM30 over the chainplate base, §3.10), at a nominal
//               breaking stress of 1.0 GPa (6 mm 1×19 316 breaks at about
//               28 kN). Both constants are rules of thumb: to verify.
//   Not included: the crew (ORC's CREW element needs its default crew
//   weight table), the boom, the pulpits and the dodger.
//
// How each element meets the air (the same apparent wind as the sails, §6.1:
// q_e = ½ρ·AWS_e², at β_e in the heeled sail plane; no gradient):
//
//   body (the hull)  cross flow: each projected area takes the flow normal
//                    to it, Fx = −q_e·Cd_f·A_f·cos β_e·|cos β_e| along the
//                    boat, Fh = q_e·Cd_s·A_s(φ)·sin β_e·|sin β_e| square to
//                    the mast. A long, low body's along-boat drag comes from
//                    its frontal area, not its side (the rule sailing's
//                    physics uses). ORC instead takes the drag along the
//                    apparent wind, D = q(Cd_f·A_f·|cos β| + Cd_s·A_s·sin β),
//                    which puts the side area's drag along the boat too:
//                    about four times the surge at 45° on a 12 m hull.
//   spar (mast, rigging)  a round section square to the flow: drag along the
//                    apparent wind, D = q_e·A·Cd(β_e), Fx = −D·cos β_e,
//                    Fh = D·sin β_e, Cd(β) = Cd_f·cos²β + Cd_s·sin²β (a
//                    bare spar's Cd is the same from every side; ORC's linear
//                    interpolation in |cos β|, |sin β| would make it 1.41 × at
//                    45°).
//
// Each element's Fx and Fh act at its own centre (x, z) and enter the
// balance exactly as a sail set's drive and heel force do at its CE (§6.6).

const RAD = Math.PI / 180;
const fin = (v) => Number.isFinite(v);

export const WINDAGE_SOURCE =
  "ORC VPP Documentation 2023, §5.3 Windage Forces (Table 5.10; eqs. 5.27, 5.28, 5.31–5.33), orc.org, retrieved 2026-11-12: the elements, areas, drag coefficients and heights. Resolution: cross flow on the hull, drag along the flow on spars (this package's; ORC resolves every element along the apparent wind).";

/** ORC Table 5.10's drag coefficients, and the rules of thumb this package adds. */
export const WINDAGE_RULES = Object.freeze({
  hullCd: 0.816,
  hullZ: 0.66,
  hullHeelSide: 0.75,
  mastSailCd: Object.freeze([0.4, 0.6]),
  mastBareCd: 0.8,
  riggingCd: 1.0,
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
 * The windage elements of a design, in the profile plane ([x, z], the
 * waterplane z = 0).
 * @param {{ plan: object, loa: number, beam: number, stemX: number, sternX: number, sheerAt: (x: number) => number,
 *           mastLengthM: number, rm30Nm: number|null, chainplateBaseM: number|null }} g
 * @returns {{ id, shape: "body"|"spar", areaFrontM2, areaSideM2, sidePerSinHeelM2, cdFront, cdSide, at: [number, number], zPerSinHeelM, lengthM?, widthM? }[]}
 */
export function windageElements({ plan, loa, beam, stemX, sternX, sheerAt, mastLengthM, rm30Nm, chainplateBaseM }) {
  const W = WINDAGE_RULES;
  const out = [];
  const fb = meanFreeboard(sheerAt, sternX, stemX);
  if (fb > 0 && loa > 0 && beam > 0)
    out.push({
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
    });
  const m = plan?.mast;
  if (!m || !(m.heightM > 0)) return out;
  const th = (plan.rakeDeg ?? 0) * RAD;
  const along = (h) => [m.partners[0] - Math.sin(th) * h, m.partners[1] + Math.cos(th) * h];
  const width = mastSection(fin(mastLengthM) && mastLengthM > 0 ? mastLengthM : m.heightM);
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
    const A = plan.I * 2 * d;
    const cd = W.riggingCd * (1 + W.spreaderFactor);
    out.push({ id: "rigging", shape: "spar", lengthM: plan.I, widthM: 2 * d, wireDiameterM: d, areaFrontM2: A, areaSideM2: A, sidePerSinHeelM2: 0, cdFront: cd, cdSide: cd, at: along(plan.I / 2), zPerSinHeelM: 0 });
  }
  return out;
}

/**
 * One element's force at an apparent wind in the heeled sail plane.
 * @returns {{ fx: number, fh: number, x: number, z: number }} fx along the boat (+ ahead), fh square to the mast (+ to leeward), at (x, z)
 */
export function elementForce(e, { awsE, betaEDeg, heelDeg, rho }) {
  const q = 0.5 * rho * awsE * awsE;
  const b = betaEDeg * RAD;
  const cb = Math.cos(b), sb = Math.sin(b);
  const s = Math.sin(heelDeg * RAD);
  let fx, fh;
  if (e.shape === "body") {
    const side = e.areaSideM2 + e.sidePerSinHeelM2 * s;
    fx = -q * e.cdFront * e.areaFrontM2 * cb * Math.abs(cb);
    fh = q * e.cdSide * side * sb * Math.abs(sb);
  } else {
    const D = q * e.areaFrontM2 * (e.cdFront * cb * cb + e.cdSide * sb * sb);
    fx = -D * cb;
    fh = D * sb;
  }
  return { fx, fh, x: e.at[0], z: e.at[1] + e.zPerSinHeelM * s };
}

/** Every element's force, and their sums. */
export function windageForces(elements, w) {
  const list = (elements ?? []).map((e) => ({ id: e.id, ...elementForce(e, w) }));
  return { list, drive: list.reduce((t, f) => t + f.fx, 0), heel: list.reduce((t, f) => t + f.fh, 0) };
}
