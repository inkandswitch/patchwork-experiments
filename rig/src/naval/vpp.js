// The static VPP: for a true wind speed and angle, the boat speed, heel,
// leeway and rudder angle at which every force and moment balances, flat
// water, steady wind, no wind gradient, fixed trim. Pure, no DOM: the
// reference point runs on the main thread, the polar in the worker.
//
// Frames and signs. Body frame x forward; "windward" is the side the wind
// comes from. V is the speed along the track, λ the leeway (the heading is
// λ to windward of the track), φ the heel (to leeward, ≥ 0), δ the rudder,
// + = weather helm (the blade's trailing edge to leeward, its force to
// windward at the stern, bearing her away). TWA is off the track.
//
// Apparent wind: AWA_track = atan2(TWS·sin γ, TWS·cos γ + V), AWS its length;
// the sails see β = AWA_track − λ (sails.js turns that into the heeled
// sail plane's β_e).
//
// Water side force (each lift in its heeled foil's plane, horizontal part × cos φ):
//   keel     Y_k = q·S_k·CL(a_k(φ)·α_k),      α_k = λ·cos φ
//   rudder   Y_r = q·S_r·CL(a_r(φ)·α_r),      α_r = λ·cos φ·(1 − dε/dα) + δ
//   hull     Y_h = q·LWL²·|Y'v|·sin λ·cos φ,  N_h = q·LWL³·|N'v|·sin λ·cos φ
//            Clarke's linear hull derivatives (Clarke, Gedling & Hine 1983):
//            Y'v = −π(Tc/LWL)²·(1 + 0.40·Cb·BWL/Tc), N'v = −π(Tc/LWL)²·(0.5 + 2.4·Tc/LWL),
//            made dimensional on ½ρ·LWL²·V·v and ½ρ·LWL³·V·v (v = V·sin λ); the
//            force acts at mid-LWL and N_h (which includes the Munk moment)
//            turns her bow to windward. A ship regression applied to a yacht's
//            canoe body: stated, an extrapolation.
//   a(φ): Helmbold on AR_eff(φ) (foils.js); CL saturates smoothly at
//   CL_max = a·15°: CL = a·α/(1 + (a·α/CL_max)⁸)^⅛; |α| past 15° is "stalled".
//   They act at the keel's and rudder's MAC quarter chords; for the heeling
//   arm, the hull's side force acts at its lateral-profile centroid's depth.
// Resistance R = resistance.js R(V, φ, Y) with Y = Y_k + Y_r + Y_h.
// Equations (forces in the body frame, the water force perpendicular and
// the resistance along the track):
//   surge   Fx_sail − R·cos λ + L·sin λ = 0,          L = Y·cos φ
//   sway    −Fh·cos φ + R·sin λ + L·cos λ = 0
//   roll    Fh·(z_CE − z_Y) = RM(φ)                   (z_Y: the side force's centre)
//   yaw     Σ Y_i·cos φ·x_i + N_h − Fh·cos φ·x_CE + Fx_sail·z_CE·sin φ
//           − (R_app + R_i)·z_Y·sin φ + R·sin λ·x_LCB = 0
//   (+ yaw = the bow to windward; the drive at a heeled CE, to leeward of
//   the centreline, rounds her up; drag on a heeled keel, to windward, too.)
// Righting: RM(φ) = RM_boat(φ) + RM_crew(φ) from the stability curve. When
// the wind's moment upright is less than the crew's, she sails upright with
// the crew partly in (φ = 0).
//
// Method. φ is solved inside, for given (V, λ, δ), by a bracketed root on
// roll; (V, λ, δ) by damped Newton with a finite-difference Jacobian, warm-
// started from the last point, restarted from a spread of speeds when it
// fails. A hull that can plane may balance both below the resistance hump
// and on the plane: the faster balance is taken (she has been got over it). Outside: sail flat ∈ [0.5, 1] and the main's
// reefs, maximising V with the heel within the limit (flat first, reefs only
// when flat can't hold it, ORC-style).

import { liftSlope } from "./foils.js";
import { resistanceModel, regime, envelopeText, FN_MAX_DISPLACEMENT } from "./resistance.js";
import { rigForces, tableOf, FLAT_MIN } from "./sails.js";
import { G } from "./ratios.js";
import { KNOT } from "./units.js";

const RAD = Math.PI / 180;
const fin = (v) => Number.isFinite(v);
const RHO_AIR = 1.225;
export const TOL = 1e-9;

/** Linear interpolation on a sorted axis; NaN beyond it. */
function lerp(xs, ys, x) {
  if (!(x >= xs[0] && x <= xs[xs.length - 1])) return NaN;
  let k = 0;
  while (k < xs.length - 2 && xs[k + 1] < x) k++;
  const t = xs[k + 1] === xs[k] ? 0 : (x - xs[k]) / (xs[k + 1] - xs[k]);
  return ys[k] + t * (ys[k + 1] - ys[k]);
}

/** A foil's lift coefficient at α (deg) and heel, saturating at a·15°. */
export function foilCL(f, alphaDeg, heelDeg) {
  if (!f) return { cl: 0, stalled: false, slope: 0 };
  const ar = f.arGeom * (1 + (f.endPlateFactor - 1) * Math.cos(heelDeg * RAD) ** 2);
  const a = liftSlope(ar, f.sweepHalfDeg);
  const lin = a * alphaDeg * RAD;
  const clMax = a * f.stallDeg * RAD;
  const cl = clMax > 0 ? lin / (1 + (lin / clMax) ** 8) ** 0.125 : 0;
  return { cl, stalled: Math.abs(alphaDeg) > f.stallDeg, slope: a, arEff: ar };
}

/** The design's resistance model (memoised per design object). */
const models = new WeakMap();
export function resistanceOf(D) {
  let m = models.get(D);
  if (!m) {
    const wsa = D.rm.wsa;
    m = resistanceModel({
      hull: D.hull,
      foils: [D.keel, D.rudder].filter(Boolean),
      draftT: D.draftT,
      keelTaper: D.keelTaper,
      planing: D.planing,
      wsaAt: wsa ? (heel) => lerp(D.rm.heels, wsa, heel) || null : null,
    });
    models.set(D, m);
  }
  return m;
}

/** RM(φ), N·m: { boat, crew } (NaN beyond the curve). */
export function rmAt(D, heelDeg) {
  return { boat: lerp(D.rm.heels, D.rm.boat, heelDeg), crew: lerp(D.rm.heels, D.rm.crew, heelDeg) };
}

/** The heel of the curve's largest RM. */
function heelOfMaxRm(D) {
  let best = 0, m = -Infinity;
  D.rm.heels.forEach((h, i) => {
    const v = D.rm.boat[i] + D.rm.crew[i];
    if (v > m) [m, best] = [v, h];
  });
  return best;
}

/**
 * Every force at a state. The function the sim's agreement test mirrors.
 * NOT MODELLED: the canoe body's side force and yaw moment from heel alone
 * (DSYHS, Keuning & Sonnenberg; coefficients not in hand). Hull Y and N
 * here come from leeway only (Clarke), so helm reads toward lee as heel
 * grows. Spec §6.4 states it; HELM_OMISSION carries it to the readout.
 * @param {object} D buildDesign's
 * @param {{ set: object, flat: number, tws: number, twa: number }} c
 * @param {{ V: number, heel: number, leeway: number, rudder: number }} s degrees
 */
export function forcesAt(D, c, s) {
  const { V, heel: phi, leeway: lam, rudder: del } = s;
  const g = c.twa * RAD;
  const ax = c.tws * Math.cos(g) + V, ay = c.tws * Math.sin(g);
  const aws = Math.hypot(ax, ay);
  const awaTrack = Math.atan2(ay, ax) / RAD;
  const beta = awaTrack - lam;
  const sail = rigForces(tableOf(c.set), { aws, awaDeg: beta, heelDeg: phi, flat: c.flat, rho: RHO_AIR });
  const cphi = Math.cos(phi * RAD), sphi = Math.sin(phi * RAD);
  const q = 0.5 * D.rhoWater * V * V;
  const ak = lam * cphi;
  const k = foilCL(D.keel, ak, phi);
  const dEps = D.keel ? k.slope / (Math.PI * k.arEff) : 0;
  const ar = ak * (1 - dEps) + del;
  const r = foilCL(D.rudder, ar, phi);
  const Yk = D.keel ? q * D.keel.areaM2 * k.cl : 0;
  const Yr = D.rudder ? q * D.rudder.areaM2 * r.cl : 0;
  const hs = D.hullSide;
  const sinLam = Math.sin(lam * RAD);
  const Yh = q * hs.lwl ** 2 * hs.yv * sinLam * cphi;
  const Nh = q * hs.lwl ** 3 * hs.nv * sinLam * cphi;
  const Y = Yk + Yr + Yh;
  const zk = D.keel?.qc[1] ?? 0, zr = D.rudder?.qc[1] ?? 0, zh = D.hullSide.at[1];
  const zY = Math.abs(Y) > 1e-9 ? (Yk * zk + Yr * zr + Yh * zh) / Y : D.keel ? zk : zh;
  const res = resistanceOf(D).at(V, phi, Y);
  const R = res.total;
  const L = Y * cphi;
  const cl = Math.cos(lam * RAD), sl = Math.sin(lam * RAD);
  const [xCE, zCE] = c.set.ce;
  const surge = sail.drive - R * cl + L * sl;
  const sway = -sail.heelForce * cphi + R * sl + L * cl;
  const hm = sail.heelForce * (zCE - zY);
  const rm = rmAt(D, phi);
  const xk = D.keel?.qc[0] ?? 0, xr = D.rudder?.qc[0] ?? 0, xh = hs.xMid;
  const yaw =
    (Yk * xk + Yr * xr + Yh * xh) * cphi +
    Nh -
    sail.heelForce * cphi * xCE +
    sail.drive * zCE * sphi -
    (res.appendages + res.induced) * zY * sphi +
    R * sl * D.hull.lcbX;
  return { aws, awaTrack, beta, sail, q, keel: { alphaDeg: ak, ...k, Y: Yk }, rudder: { alphaDeg: ar, ...r, Y: Yr }, hullY: Yh, hullN: Nh, Y, zY, res, surge, sway, hm, rm, yaw };
}

/** Scales that make the residuals O(1). */
function scales(D, c) {
  const F = Math.max(1, 0.5 * RHO_AIR * c.tws * c.tws * c.set.areaM2);
  return { F, M: F * Math.max(1, D.hull.lwl) };
}

/**
 * Heel for a given (V, λ, δ): the root of HM(φ) − RM(φ), or 0 when the crew
 * can hold her upright, or the curve's largest-RM heel when she's overpowered.
 */
function heelFor(D, c, V, lam, del) {
  const f = (phi) => {
    const F = forcesAt(D, c, { V, heel: phi, leeway: lam, rudder: del });
    return F.hm - (F.rm.boat + F.rm.crew);
  };
  const f0 = f(0);
  if (!(f0 > 0)) return { heel: 0, over: false };
  const hi = Math.min(heelOfMaxRm(D), D.rm.heels[D.rm.heels.length - 1]);
  let a = 0, b = hi, fa = f0, fb = f(hi);
  if (!(fb < 0)) return { heel: hi, over: true };
  // Illinois
  let side = 0;
  for (let i = 0; i < 60 && b - a > 1e-7; i++) {
    const x = (a * fb - b * fa) / (fb - fa);
    const fx = f(x);
    if (fx > 0) {
      a = x;
      fa = fx;
      if (side === -1) fb /= 2;
      side = -1;
    } else {
      b = x;
      fb = fx;
      if (side === 1) fa /= 2;
      side = 1;
    }
  }
  return { heel: (a + b) / 2, over: false };
}

/** The residuals for (V, λ, δ), with φ solved inside. */
function residualsOf(D, c, x) {
  const [V, lam, del] = x;
  const h = heelFor(D, c, V, lam, del);
  const F = forcesAt(D, c, { V, heel: h.heel, leeway: lam, rudder: del });
  const sc = scales(D, c);
  return { r: [F.surge / sc.F, F.sway / sc.F, F.yaw / sc.M], F, heel: h.heel, over: h.over };
}

const norm = (r) => Math.max(...r.map(Math.abs));

/** Solve a 3×3 linear system (Gaussian elimination with partial pivoting); null if singular. */
export function solve3(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  const n = 3;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Damped Newton with a finite-difference Jacobian, for any 3-unknown system.
 * @param {(x: number[]) => { r: number[] }} fn  @param {number[]} x0
 * @param {{ steps?: number[], lo?: number[], hi?: number[], maxIter?: number, tol?: number }} o
 */
export function newton(fn, x0, { steps = [1e-6, 1e-6, 1e-6], lo = [-Infinity, -Infinity, -Infinity], hi = [Infinity, Infinity, Infinity], maxIter = 40, tol = TOL } = {}) {
  const clamp = (x) => x.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  let x = clamp(x0);
  let f = fn(x);
  let n0 = norm(f.r);
  let iter = 0;
  for (; iter < maxIter && n0 > tol; iter++) {
    const J = [[], [], []];
    for (let j = 0; j < 3; j++) {
      const xp = [...x];
      xp[j] += steps[j];
      const fp = fn(xp).r;
      for (let i = 0; i < 3; i++) J[i][j] = (fp[i] - f.r[i]) / steps[j];
    }
    const dx = solve3(J, f.r.map((v) => -v));
    if (!dx || !dx.every(fin)) break;
    let t = 1, ok = false;
    for (let k = 0; k < 12; k++, t /= 2) {
      const xn = clamp(x.map((v, i) => v + t * dx[i]));
      const fn1 = fn(xn);
      const n1 = norm(fn1.r);
      if (fin(n1) && n1 < n0) {
        x = xn;
        f = fn1;
        n0 = n1;
        ok = true;
        break;
      }
    }
    if (!ok) break;
  }
  return { x, f, residual: n0, iterations: iter, converged: n0 <= Math.max(tol, 1e-6) };
}

/**
 * Equilibrium at one sail setting.
 * @returns {{ ok, V, heel, leeway, rudder, residual, iterations, over, F }}
 */
export function equilibrium(D, c, guess) {
  const vHull = Math.sqrt(G * D.hull.lwl);
  const fn = (x) => residualsOf(D, c, x);
  const opts = { steps: [1e-5 * vHull, 1e-4, 1e-4], lo: [0.02 * vHull, -10, -60], hi: [3 * vHull, 30, 60] };
  let sol = newton(fn, guess ? [guess.V, guess.leeway, guess.rudder] : [0.3 * vHull, 3, 1], opts);
  if (!sol.converged) {
    // past a resistance hump there can be more than one speed, or none near the guess:
    // start again from a spread of speeds and keep the fastest that balances
    for (const k of [0.3, 0.5, 0.7, 1.0, 1.4]) {
      const s1 = newton(fn, [k * vHull, 3, 1], opts);
      if (s1.converged && (!sol.converged || s1.x[0] > sol.x[0])) sol = s1;
      else if (!sol.converged && s1.residual < sol.residual) sol = s1;
    }
  }
  if (D.planing.capability > 0 && sol.converged) {
    // a hull that can plane may balance both below the hump and on the plane: take the plane
    // (the VPP's convention: she has been got over the hump)
    for (const k of [1.2, 1.7]) {
      if (k * vHull < sol.x[0]) continue;
      const s2 = newton(fn, [k * vHull, sol.x[1] / 2, sol.x[2]], opts);
      if (s2.converged && s2.x[0] > sol.x[0] * 1.001) sol = s2;
    }
  }
  const [V, leeway, rudder] = sol.x;
  return { ok: sol.converged, V, heel: sol.f.heel, leeway, rudder, residual: sol.residual, iterations: sol.iterations, over: sol.f.over, F: sol.f.F };
}

/**
 * The best point at a true wind: the fastest sail setting (flat, reef)
 * whose heel is within the limit.
 * @param {object} D  @param {{ tws: number, twa: number }} w m/s, degrees  @param {object} [guess]
 */
export function solvePoint(D, w, guess) {
  const limit = D.heelLimitDeg;
  const tries = [];
  const at = (set, flat, g) => {
    const e = equilibrium(D, { set, flat, tws: w.tws, twa: w.twa }, g);
    tries.push({ set, flat, e });
    return e;
  };
  const okHeel = (e) => e.ok && !e.over && e.heel <= limit + 1e-6;
  const bySet = [];
  for (const set of D.sets) {
    let e = at(set, 1, guess);
    let flat = 1;
    if (e.ok && !okHeel(e)) {
      // flatten until the heel is the limit
      const ef = at(set, FLAT_MIN, e);
      if (!okHeel(ef)) {
        bySet.push({ set, flat: FLAT_MIN, e: ef, held: false });
        continue;
      }
      let lo = FLAT_MIN, hi = 1, best = ef, last = ef;
      for (let i = 0; i < 18; i++) {
        const m = (lo + hi) / 2;
        const em = at(set, m, last);
        last = em;
        if (okHeel(em)) [lo, best] = [m, em];
        else hi = m;
      }
      [flat, e] = [lo, best];
    }
    bySet.push({ set, flat, e, held: okHeel(e) });
    // full sail held at full power: a reef can't be faster
    if (set.reef < 0 && flat === 1 && okHeel(e)) break;
  }
  const held = bySet.filter((b) => b.held && b.e.ok);
  const pick = held.length ? held.reduce((p, q) => (q.e.V > p.e.V ? q : p)) : bySet.filter((b) => b.e.ok).reduce((p, q) => (!p || q.e.heel < p.e.heel ? q : p), null) ?? bySet[0];
  return describe(D, w, pick, held.length > 0);
}

/** A solved point in words: flags, regime, sheets. */
function describe(D, w, pick, held) {
  const { set, flat, e } = pick;
  const F = e.F;
  const flags = [];
  const fn = e.V / Math.sqrt(G * D.hull.lwl);
  const cap = D.planing.capability;
  const reg = regime(fn, cap);
  if (!e.ok) flags.push({ id: "no-equilibrium", text: "no equilibrium: the forces don't balance at any speed here" });
  if (e.ok && !held) flags.push({ id: "over-heel", text: e.over ? "overpowered: she heels past her greatest righting moment even flat and reefed" : `over the heel limit (${D.heelLimitDeg}°) even flat and reefed` });
  const maxDeg = D.rudder?.maxDeg ?? 35;
  if (D.rudder && Math.abs(e.rudder) > maxDeg) flags.push({ id: "helm", text: `cannot be held: needs ${Math.abs(e.rudder).toFixed(1)}° of ${e.rudder > 0 ? "weather" : "lee"} helm (limit ${maxDeg}°)` });
  else if (F?.rudder?.stalled) flags.push({ id: "rudder-stall", text: `rudder stalled: ${Math.abs(F.rudder.alphaDeg).toFixed(1)}° angle of attack (stalls at ${D.rudder.stallDeg}°)` });
  if (F?.keel?.stalled) flags.push({ id: "keel-stall", text: `keel stalled: ${Math.abs(F.keel.alphaDeg).toFixed(1)}° of leeway on it (stalls at ${D.keel.stallDeg}°)` });
  if (reg.id === "beyond") flags.push({ id: "beyond", text: `beyond model: Fn ${fn.toFixed(2)}, past the DSYHS table (0.75) on a hull too heavy to plane` });
  if (F?.res?.degenerate) flags.push({ id: "planing-range", text: "planing model has no solution here (Savitsky's equations degenerate on this hull): displacement resistance used" });
  else if ((reg.id === "planing" || reg.id === "transition") && F?.res?.savitsky && !F.res.savitsky.inRange) flags.push({ id: "planing-range", text: `planing model extrapolated: ${F.res.savitsky.why.join("; ")}` });
  if (D.hull.envelope.length && fn > 0.1) flags.push({ id: "dsyhs", text: envelopeText(D.hull.envelope) });
  const sheets = {};
  if (F) {
    const t = tableOf(set);
    const b = Math.min(180, Math.max(0, Math.round(Math.abs(F.sail.betaE))));
    for (const [id, arr] of Object.entries(t.sheets)) sheets[id] = arr[b];
  }
  return {
    twsKn: w.tws / KNOT,
    tws: w.tws,
    twa: w.twa,
    ok: e.ok,
    speed: e.ok && reg.id !== "beyond" ? e.V : null,
    V: e.V,
    fn,
    heel: e.heel,
    leeway: e.leeway,
    rudder: e.rudder,
    flat,
    set: set.id,
    reef: set.reef,
    sheets,
    aws: F?.aws,
    awa: F?.awaTrack,
    regime: reg.id,
    regimeText: reg.text,
    planingWeight: F?.res?.planingWeight ?? 0,
    residual: e.residual,
    vmg: e.ok ? e.V * Math.cos(w.twa * RAD) : null,
    flags,
    // drawn hollow: the point itself is in doubt. A DSYHS extrapolation is the hull's, said once in the notes
    hollow: flags.some((f) => f.id !== "dsyhs"),
  };
}

export const HELM_OMISSION =
  "Not modelled: the hull's own side force and yaw moment from heel (DSYHS heeled terms, coefficients not in hand), which add weather helm as she heels; the helm here reads toward lee helm by an unknown amount at large heel.";

/**
 * The helm's band: a rule of thumb, not a citation. Upwind a few degrees of
 * weather helm is wanted (the boat rounds up if let go, the rudder adds a
 * little lift); lee helm, or more than about 5°, is out. The toolbar's Helm
 * helper aims at 3°, the middle.
 */
export const HELM_BAND = Object.freeze({
  min: 0,
  max: 5,
  label: "0–5° weather",
  source: "Rule of thumb (not cited): a few degrees of weather helm upwind is the usual aim; lee helm, or more than about 5° of weather helm, is out of band. " + HELM_OMISSION,
});

/** The helm verdict at a point: { id, text, deg, out?, band }. */
export function helmVerdict(D, p) {
  if (!p) return { id: "unknown", text: "not computed" };
  const lim = D.rudder?.maxDeg ?? 35;
  if (!D.rudder) return { id: "none", text: "no rudder" };
  if (!p.ok) return { id: "unknown", text: "no equilibrium at the reference point" };
  const d = p.rudder;
  const band = HELM_BAND.label;
  if (Math.abs(d) > lim) return { id: "cannot", text: `cannot be held: needs ${Math.abs(d).toFixed(1)}° of ${d > 0 ? "weather" : "lee"} helm, the limit is ${lim}°`, deg: d, out: true, band };
  if (p.flags.some((f) => f.id === "rudder-stall")) return { id: "cannot", text: `cannot be held: the rudder stalls at ${Math.abs(d).toFixed(1)}°`, deg: d, out: true, band };
  if (Math.abs(d) < 0.5) return { id: "neutral", text: `neutral helm (${d.toFixed(1)}°), within ${band}`, deg: d, band };
  if (d < 0) return { id: "lee", text: `lee helm ${(-d).toFixed(1)}°: out of ${band}`, deg: d, out: true, band };
  if (d > HELM_BAND.max) return { id: "weather", text: `weather helm ${d.toFixed(1)}°: heavy, above ${band}`, deg: d, out: true, band };
  return { id: "weather", text: `weather helm ${d.toFixed(1)}°, within ${band}`, deg: d, band };
}

/** The reference point (synchronous). */
export function referencePoint(D) {
  const r = D.conditions.reference;
  return solvePoint(D, { tws: r.tws, twa: r.twa });
}

/** The best VMG over a range of TWA by golden section, from solved points. */
function bestVmg(D, tws, lo, hi, sign, guess) {
  const g = (Math.sqrt(5) - 1) / 2;
  const cache = new Map();
  const at = (twa) => {
    const k = twa.toFixed(4);
    if (!cache.has(k)) cache.set(k, solvePoint(D, { tws, twa }, guess));
    const p = cache.get(k);
    return { p, v: p.ok && p.speed != null ? sign * p.vmg : -Infinity };
  };
  let a = lo, b = hi;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = at(c), fd = at(d);
  for (let i = 0; i < 14; i++) {
    if (fc.v > fd.v) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = at(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = at(d);
    }
  }
  const best = fc.v > fd.v ? fc : fd;
  return best.p;
}

/**
 * The polar: every (TWS, TWA) of the conditions, with beat and run VMG.
 * @returns {{ points: object[], beat: object[], run: object[], ms: number }}
 */
export function polar(D, { tws = D.conditions.tws, twa = D.conditions.twa } = {}) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const points = [], beat = [], run = [];
  const angles = [...twa].sort((a, b) => a - b);
  for (const w of tws) {
    let guess = null;
    for (const a of angles) {
      const p = solvePoint(D, { tws: w, twa: a }, guess);
      points.push(p);
      if (p.ok) guess = { V: p.V, leeway: p.leeway, rudder: p.rudder };
    }
    const first = points.find((p) => p.tws === w && p.ok);
    const b = bestVmg(D, w, 30, 70, 1, first && { V: first.V, leeway: first.leeway, rudder: first.rudder });
    beat.push(b);
    const r = bestVmg(D, w, 120, 180, -1, null);
    run.push(r);
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { points, beat, run, ms: t1 - t0 };
}

export { FN_MAX_DISPLACEMENT };
