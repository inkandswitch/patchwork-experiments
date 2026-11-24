// The 1-D design helpers: each answers one question the designer asks and
// returns the doc writes that answer it, applied as a single change. No
// optimiser: one input moves, one figure is matched, and the model that
// matches it is the tool's own (computeNumbers: the sail plan, the balance
// and the reference VPP point), so the readouts agree with the answer.
//
// - mastForHelm: move the rig so the rudder angle that balances yaw at the
//   reference point is a chosen few degrees (weather +).
// - mastForLead: move the rig so the lead is a chosen % of LWL.
//   Both move the mast and the forestay's tack together, so J, the sail
//   plan and its area stay as they are and only the balance changes (moving
//   the mast alone would change J, and with it the area and SA/D). A tack
//   that ends up forward of the stem is a bowsprit; one aft of it is on deck.
// - scaleToSAD: scale I, J, P and E together so the designer's SA/D is the
//   target. J scales with them, so the mast moves (the forestay stays put).

import { computeNumbers } from "./numbers.js";
import { jOf, hasForetriangle } from "./naval/sailplan.js";
import { normalize } from "./doc.js";

/**
 * Solve f(x) = target for a monotone f on [lo, hi]: step out from x0 to
 * bracket the target, then Illinois regula falsi (bisection-safe).
 * @param {(x: number) => number} f may return NaN where it can't say
 * @returns {{ ok: true, x: number, f: number, evals: number } | { ok: false, why: string, evals: number, x?: number, f?: number }}
 */
export function solve1d(f, target, { lo, hi, x0, step, tolX = 1e-4, tolF = 1e-6, maxEval = 60 } = {}) {
  let evals = 0;
  const g = (x) => {
    evals++;
    return f(x) - target;
  };
  x0 = Math.min(hi, Math.max(lo, x0));
  let a = x0, ga = g(a);
  if (!Number.isFinite(ga)) return { ok: false, why: "the model has no answer where it starts", evals };
  if (Math.abs(ga) <= tolF) return { ok: true, x: a, f: ga + target, evals };
  // which way? step both sides once to find the slope's sign
  let b = Math.min(hi, a + step);
  if (b === a) b = Math.max(lo, a - step);
  let gb = g(b);
  if (!Number.isFinite(gb)) return { ok: false, why: "the model has no answer a step away", evals };
  const rising = (gb - ga) / (b - a) > 0;
  // walk toward the target until the sign changes
  let dir = (ga < 0) === rising ? 1 : -1;
  let x = a, gx = ga, s = step;
  let bracket = null;
  while (evals < maxEval) {
    const xn = Math.min(hi, Math.max(lo, x + dir * s));
    if (xn === x) break;
    const gn = g(xn);
    if (!Number.isFinite(gn)) break;
    if (Math.sign(gn) !== Math.sign(gx) || gn === 0) {
      bracket = [x, gx, xn, gn];
      break;
    }
    x = xn;
    gx = gn;
    s *= 1.6;
  }
  if (!bracket) return { ok: false, why: `out of reach: at the end of the range the figure is ${(gx + target).toPrecision(4)}`, evals, x, f: gx + target };
  let [p, gp, q, gq] = bracket;
  let side = 0;
  while (evals < maxEval) {
    const m = (p * gq - q * gp) / (gq - gp);
    const gm = g(m);
    if (!Number.isFinite(gm)) return { ok: false, why: "the model failed inside the bracket", evals };
    if (Math.abs(gm) <= tolF || Math.abs(q - p) <= tolX) return { ok: true, x: m, f: gm + target, evals };
    if (Math.sign(gm) === Math.sign(gq)) {
      q = m;
      gq = gm;
      if (side === -1) gp /= 2;
      side = -1;
    } else {
      p = m;
      gp = gm;
      if (side === 1) gq /= 2;
      side = 1;
    }
  }
  return { ok: false, why: "didn't converge", evals };
}

/** The rig moved so its mast is x aft of the stem, J kept (the forestay's tack moves with it). */
function withRigAt(doc, x) {
  const dx = x - doc.rig.mast.aftOfStem;
  return normalize({ ...doc, rig: { ...doc.rig, mast: { ...doc.rig.mast, aftOfStem: x }, forestayAftOfStem: doc.rig.forestayAftOfStem + (hasForetriangle(doc.rig.type) ? dx : 0) } });
}

/** How far the rig may move: its tack no more than 15% of LOA out on a bowsprit, its mast forward of 75% of LOA. */
function mastRange(doc, n) {
  const loa = n.form?.loa ?? doc.hull.dims.loa;
  const lwl = n.form?.hydro?.lwl > 0 ? n.form.hydro.lwl : doc.hull.dims.lwl;
  const J = hasForetriangle(doc.rig.type) ? jOf(doc.rig) : 0;
  return { lo: Math.max(0.02 * loa, J - 0.15 * loa), hi: 0.75 * loa, step: 0.03 * lwl };
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
/** Writes that move the rig to x: the mast, and the tack with it. */
function mastWrites(doc, x) {
  const w = [[["rig", "mast", "aftOfStem"], r4(x)]];
  if (hasForetriangle(doc.rig.type)) w.push([["rig", "forestayAftOfStem"], r4(doc.rig.forestayAftOfStem + x - doc.rig.mast.aftOfStem)]);
  return w;
}

/**
 * The rig position (mast x, J kept) that gives a chosen rudder angle at the reference point.
 * @param {object} doc normalized
 * @param {{ linked?: object, statics?: object }} ctx the tool's hull and statics
 * @param {number} helmDeg + weather
 */
export function mastForHelm(doc, ctx, helmDeg) {
  const n = computeNumbers(doc, ctx);
  if (!n.design?.ok) return { ok: false, why: `the performance model isn't ready: ${n.design?.why ?? "no design"}` };
  const r = mastRange(doc, n);
  const at = (x) => {
    const m = computeNumbers(withRigAt(doc, x), ctx);
    return m.reference?.ok ? m.reference.rudder : NaN;
  };
  const s = solve1d(at, helmDeg, { ...r, x0: doc.rig.mast.aftOfStem, tolX: 5e-4, tolF: 0.01 });
  if (!s.ok) return { ok: false, why: `no mast position from ${r.lo.toFixed(2)} to ${r.hi.toFixed(2)} m aft of the stem gives ${helmDeg}° (${s.why})`, evals: s.evals };
  return { ok: true, writes: mastWrites(doc, s.x), x: s.x, from: doc.rig.mast.aftOfStem, value: s.f, evals: s.evals };
}

/** The rig position (mast x, J kept) that gives a chosen lead (fraction of LWL) over the extended-keel CLR. */
export function mastForLead(doc, ctx, lead) {
  const n = computeNumbers(doc, ctx);
  if (!Number.isFinite(n.analysis?.balance?.lead)) return { ok: false, why: "no lead to move: it needs a hull and a sail plan" };
  const r = mastRange(doc, n);
  const at = (x) => computeNumbers(withRigAt(doc, x), ctx).analysis.balance.lead;
  const s = solve1d(at, lead, { ...r, x0: doc.rig.mast.aftOfStem, tolX: 1e-4, tolF: 1e-5 });
  if (!s.ok) return { ok: false, why: `no mast position from ${r.lo.toFixed(2)} to ${r.hi.toFixed(2)} m aft of the stem gives a ${(lead * 100).toFixed(1)}% lead (${s.why})`, evals: s.evals };
  return { ok: true, writes: mastWrites(doc, s.x), x: s.x, from: doc.rig.mast.aftOfStem, value: s.f, evals: s.evals };
}

/**
 * Scale the sail plan uniformly (I, J, P, E, ISP, the headsail's LP and clew,
 * the staysail) so the designer's SA/D is the target. The area goes as the
 * square of the scale, so this is exact in one step. BAS (headroom under the
 * boom) and the forestay's tack stay; J scales, so the mast moves.
 */
export function scaleToSAD(doc, ctx, target) {
  if (!(target > 0)) return { ok: false, why: "give an SA/D above zero" };
  const n = computeNumbers(doc, ctx);
  const now = n.ratios?.saDDesigner;
  if (!(now > 0)) return { ok: false, why: "no SA/D to scale: it needs a sail plan and a displacement" };
  const k = Math.sqrt(target / now);
  const rig = doc.rig;
  const ft = hasForetriangle(rig.type);
  const r4 = (v) => Math.round(v * 1e6) / 1e6;
  const w = [
    [["rig", "P"], r4(k * rig.P)],
    [["rig", "E"], r4(k * rig.E)],
  ];
  if (ft) {
    w.push([["rig", "I"], r4(k * rig.I)]);
    w.push([["rig", "mast", "aftOfStem"], r4(rig.forestayAftOfStem + k * jOf(rig))]);
    if (Number.isFinite(rig.ISP)) w.push([["rig", "ISP"], r4(k * rig.ISP)]);
    if (rig.headsail) {
      w.push([["rig", "headsail", "LP"], r4(k * rig.headsail.LP)]);
      if (Number.isFinite(rig.headsail.clewHeight)) w.push([["rig", "headsail", "clewHeight"], r4(k * rig.headsail.clewHeight)]);
    }
    if (rig.staysail) for (const key of ["I2", "J2", "LP2"]) w.push([["rig", "staysail", key], r4(k * rig.staysail[key])]);
  }
  return { ok: true, writes: w, scale: k, from: now, value: target };
}
