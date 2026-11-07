// Resistance of the hull and appendages through the water, displacement and
// planing. Pure, no DOM; runs in the worker as well. Every coefficient is
// transcribed with its source below; the contract's §6 repeats the rules so
// a consumer (sailing's physics) applies the same ones.
//
// R(V, φ, F_h) = R_f + R_r + ΔR_r(φ) + R_app + R_i            (displacement)
// R            = (1 − w)·[R_f + R_r + ΔR_r] + w·R_planing + R_app + R_i
//
// 1. Friction, ITTC-57: C_f = 0.075/(log₁₀Re − 2)², Re = V·0.7·LWL/ν, on the
//    canoe body's wetted skin at that heel (the statics table's wetted area;
//    upright until it is built). No form factor: Keuning & Katgert fitted
//    the residuary as R_total − R_f with this same friction and no (1 + k),
//    so adding one would count the viscous pressure drag twice.
// 2. Upright residuary, DSYHS (Keuning & Katgert 2008, Eq. 1.7, Table 2):
//      R_r/(∇_c·ρ·g) = a0 + (a1·LCB_fpp/LWL + a2·Cp + a3·∇_c^⅔/Aw
//                          + a4·BWL/LWL + a5·LCB_fpp/LCF_fpp + a6·BWL/Tc
//                          + a7·Cm) · ∇_c^⅓/LWL
//    tabulated at Fn 0.15 … 0.75, linear between rows. Below Fn 0.15 the
//    row-0 value is scaled by Fn/0.15 to zero at rest (a stated choice: the
//    table stops there; vela and signalk do the same). LCB_fpp and LCF_fpp
//    are measured aft of the forward end of the waterline, m.
// 3. Heel, DSYHS (Larsson, Eliasson & Orych, Fig 5.22, after Keuning &
//    Sonnenberg): at 20°,
//      ΔR_r20/(∇_c·ρ·g) = (u0 + u1·LWL/BWL + u2·BWL/Tc + u3·(BWL/Tc)²
//                          + u4·LCB + u5·LCB²)/1000,   LCB in % of LWL, + fwd
//    at Fn 0.25 … 0.55, and at heel φ (rad) ΔR_r = ΔR_r20·6·φ^1.7. Below Fn
//    0.25 scaled by Fn/0.25; above 0.55 the last row is held.
// 4. Appendages: each foil's profile drag q·S·cd0 (foils.js: Hoerner's
//    thickness factor on ITTC-57 at the MAC's Reynolds number); a bulb's
//    friction on a spheroid's wetted area with Hoerner's body form factor
//    1 + 1.5·(D/L)^1.5 + 7·(D/L)³. The keel's own residuary (DSYHS ΔR_rk) is
//    not included: no transcription of its coefficients in hand.
// 5. Induced: R_i = F_H²/(π·T_e²·½ρV²), F_H the water's HORIZONTAL side
//    force (Y·cos φ for Y in the heeled foil plane, as Keuning & Sonnenberg
//    define it), T_e the
//    effective draft (DSYHS, Keuning & Sonnenberg 1998, upright row):
//      T_e/T = (A1·Tc/T + A2·(Tc/T)² + A3·BWL/Tc + A4·TR)·(B0 + B1·Fn)
//    T the draft overall, TR the keel's taper. The heeled rows were not in
//    hand: T_e(φ) = T_e(0)·cos φ (ASSUMPTION, the span projected on the
//    vertical; stated, to replace with the 10°/20°/30° rows).
// 6. Planing, Savitsky (1964) prismatic planing surface, transcribed from
//    the Rising Tide `resistance` module (MIT; savitsky.ts, checked there
//    against OpenPlaning): with the load coefficient C_Lβ = W/(½ρV²b²),
//      C_Lβ = C_L0 − 0.0065·β·C_L0^0.6                       (deadrise β, deg)
//      l_p/(λb) = 0.75 − 1/(5.21·(C_V/λ)² + 2.39) = LCG/(λb)   (moment, C_V = V/√(gb))
//      C_L0 = τ^1.1·(0.0120·√λ + 0.0055·λ^2.5/C_V²)            (τ in degrees)
//      V_m = V·√(1 − (0.012·τ^1.1·√λ − 0.0065·β·(0.012·τ^1.1·√λ)^0.6)/(λ·cos τ))
//      R_planing = W·tan τ + ½ρV_m²·(λb²/cos β)·(C_f(V_m·λb/ν) + ΔC_f)/cos τ
//    Savitsky's Eq. for drag: the wetted bottom is λb²/cos β (the V's two
//    sloping faces, not their plan), and he adds a roughness allowance
//    ΔC_f = 0.0004 to ITTC-57. Kept at 0.0004 for a dinghy too (a stated,
//    conservative choice: a polished dinghy bottom is smoother than the
//    planing craft he fitted it to, so this errs slow). With both terms the
//    OpenPlaning base-'64 run is reproduced to ±2%.
//    b the chine (here: waterline) beam, LCG forward of the transom, W the
//    boat's weight, upright (heel is not in the planing branch). Its tested
//    range: C_V ≥ 1, 2° ≤ τ ≤ 15°, λ ≤ 4. No whisker spray. Where the
//    equations have no solution (R not finite: V_m → 0 on an absurd hull)
//    the blend falls back to w = 0 and says so.
//    The blend: w = smoothstep(Fn; 0.55, 0.75) × planing capability, the
//    capability 1 − smoothstep(D/L; 110, 160) (a light hull can plane, a
//    keelboat of D/L ≥ 160 is taken as displacement only). Fn 0.55 is where
//    Savitsky's C_V reaches about 1 on dinghy proportions and 0.75 the top
//    of the DSYHS table, so the hand-over happens where both are fitted. A
//    hull that can't plane, past Fn 0.75, is "beyond model".

import { RHO_SEA } from "./units.js";
import { G } from "./ratios.js";
import { NU_SEA, ittc57, cd0At } from "./foils.js";

const RAD = Math.PI / 180;
const fin = (v) => Number.isFinite(v);
export const smoothstep = (x, lo, hi) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

export const DSYHS_RESIDUARY_SOURCE =
  "Keuning & Katgert (2008), 'A bare hull resistance prediction method derived from the results of the Delft Systematic Yacht Hull Series extended to higher speeds', RINA Int. Conf. on Innovation in High Performance Sailing Yachts, Lorient, pp. 13–21: Eq. 1.7 and Table 2. Transcribed from two independent copies that agree cell for cell: lofilobzik/sail data/delft-residuary.json (read from the paper's page image, MIT) and aciceri/vela dsyhs.rs (from Larsson, Eliasson & Orych, Principles of Yacht Design 5th ed., Fig 5.18). Retrieved 2026-11-06; the paper itself was not opened here.";
export const DSYHS_HEEL_SOURCE =
  "Larsson, Eliasson & Orych, Principles of Yacht Design, 5th ed. (2022), Fig 5.22 (after Keuning & Sonnenberg 1998), as transcribed in aciceri/vela dsyhs.rs (Apache-2.0), retrieved 2026-11-06; matches the coefficients as commonly reproduced. The book was not opened here.";
export const DSYHS_TE_SOURCE =
  "Keuning & Sonnenberg (1998), 'Approximation of the hydrodynamic forces on a sailing yacht based on the DSYHS', HISWA symposium, effective-span regression, upright row, as reproduced in Borba Labi (2019) Table 16 and copied in motamman/signalk-weather-router-plus src/vessel/vpp_physics.ts (Apache-2.0), retrieved 2026-11-06. The heeled rows were not in hand.";
export const SAVITSKY_SOURCE =
  "Savitsky, D. (1964), 'Hydrodynamic design of planing hulls', Marine Technology 1(4): lift, moment and V_m as implemented in Rising Tide Research's resistance module (src/savitsky.ts, MIT); friction on Savitsky's wetted area λb²/cos β with his ΔC_f = 0.0004 (which that module leaves out), so it reproduces OpenPlaning's base Savitsky-'64 run to ±2%.";
/** Savitsky's roughness allowance on ITTC-57 for the planing bottom. */
export const SAVITSKY_DELTA_CF = 0.0004;

/** Keuning & Katgert (2008) Table 2: Fn and a0 … a7. */
export const RESIDUARY_FN = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75];
export const RESIDUARY_A = [
  [-0.0005, 0.0023, -0.0086, -0.0015, 0.0061, 0.001, 0.0001, 0.0052],
  [-0.0003, 0.0059, -0.0064, 0.007, 0.0014, 0.0013, 0.0005, -0.002],
  [-0.0002, -0.0156, 0.0031, -0.0021, -0.007, 0.0148, 0.001, -0.0043],
  [-0.0009, 0.0016, 0.0337, -0.0285, -0.0367, 0.0218, 0.0015, -0.0172],
  [-0.0026, -0.0567, 0.0446, -0.1091, -0.0707, 0.0914, 0.0021, -0.0078],
  [-0.0064, -0.4034, -0.125, 0.0273, -0.1341, 0.3578, 0.0045, 0.1115],
  [-0.0218, -0.5261, -0.2945, 0.2485, -0.2428, 0.6293, 0.0081, 0.2086],
  [-0.0388, -0.5986, -0.3038, 0.6033, -0.043, 0.8332, 0.0106, 0.1336],
  [-0.0347, -0.4764, -0.2361, 0.8726, 0.4219, 0.899, 0.0096, -0.2272],
  [-0.0361, 0.0037, -0.296, 0.9661, 0.6123, 0.7534, 0.01, -0.3352],
  [0.0008, 0.3728, -0.3667, 1.3957, 1.0343, 0.323, 0.0072, -0.4632],
  [0.0108, -0.1238, -0.2026, 1.1282, 1.1836, 0.4973, 0.0038, -0.4477],
  [0.1023, 0.7726, 0.504, 1.7867, 2.1934, -1.5479, -0.0115, -0.0977],
];
/** Heel ΔR at 20°: Fn and u0 … u5 (× 1000). */
export const HEEL_FN = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55];
export const HEEL_U = [
  [-0.0268, -0.0014, -0.0057, 0.0016, -0.007, -0.0017],
  [0.6628, -0.0632, -0.0699, 0.0069, 0.0459, -0.0004],
  [1.6433, -0.2144, -0.164, 0.0199, -0.054, -0.0268],
  [-0.8659, -0.0354, 0.2226, 0.0188, -0.58, -0.1133],
  [-3.2715, 0.1372, 0.5547, 0.0268, -1.0064, -0.2026],
  [-0.1976, -0.148, -0.6593, 0.1862, -0.7489, -0.1648],
  [1.5873, -0.3749, -0.7105, 0.2146, -0.4818, -0.1174],
];
/** Effective draft, upright: A1, A2, A3, A4, B0, B1. */
export const TE_UPRIGHT = [3.7455, -3.6246, 0.0589, -0.0296, 1.2306, -0.7256];

/**
 * The regression's own ranges: the fitted models of Keuning & Katgert (2008)
 * Table 1, as transcribed by lofilobzik/sail (docs/DAY-EQUATIONS.md, from
 * the paper's page 5). Larsson, Eliasson & Orych (via vela) quote LWL/BWL
 * 2.73–5.00, which is BWL/LWL 0.200–0.366: the lower bound disagrees with
 * Table 1's 0.170; Table 1 is used.
 */
export const DSYHS_ENVELOPE = [
  { id: "lcbFpp", label: "LCB_fpp / LWL", min: 0.5, max: 0.582 },
  { id: "cp", label: "Cp", min: 0.519, max: 0.599 },
  { id: "volAw", label: "∇c^⅔ / Aw", min: 0.079, max: 0.265 },
  { id: "bwlLwl", label: "BWL / LWL", min: 0.17, max: 0.366 },
  { id: "lcbLcf", label: "LCB_fpp / LCF_fpp", min: 0.92, max: 1.002 },
  { id: "bwlTc", label: "BWL / Tc", min: 2.46, max: 19.38 },
  { id: "cm", label: "Cm", min: 0.646, max: 0.79 },
  { id: "volLwl", label: "∇c^⅓ / LWL", min: 0.12, max: 0.23 },
];

/** Linear interpolation of table rows on an axis, clamped at the ends. */
function rowAt(axis, rows, x) {
  if (x <= axis[0]) return rows[0];
  const n = axis.length;
  if (x >= axis[n - 1]) return rows[n - 1];
  let k = 0;
  while (axis[k + 1] < x) k++;
  const t = (x - axis[k]) / (axis[k + 1] - axis[k]);
  return rows[k].map((a, i) => a + t * (rows[k + 1][i] - a));
}

/**
 * The DSYHS inputs from a hull's upright hydrostatics.
 * @param {{ lwl, bwl, tc, volumeM3, awM2, cp, cm, lcb, lcf, xFwd, xAft, wsaCanoeM2? }} h
 */
export function dsyhsHull(h) {
  const lcbFpp = h.xFwd - h.lcb;
  const lcfFpp = fin(h.lcf) ? h.xFwd - h.lcf : NaN;
  return {
    lwl: h.lwl,
    bwl: h.bwl,
    tc: h.tc,
    volumeM3: h.volumeM3,
    awM2: h.awM2,
    cp: h.cp,
    cm: h.cm,
    lcbFpp,
    lcfFpp,
    lcbPct: (100 * (h.lcb - (h.xFwd + h.xAft) / 2)) / h.lwl,
    wsaM2: h.wsaCanoeM2 ?? h.wsaM2,
  };
}

/**
 * The DSYHS inputs from published particulars, LCB and LCF in % of LWL from
 * mid-LWL, + forward (the books' convention).
 */
export function dsyhsFromParticulars({ lwl, bwl, tc, volumeM3, wsaM2, awM2, cp, cm, lcbPct, lcfPct }) {
  return { lwl, bwl, tc, volumeM3, awM2, cp, cm, wsaM2, lcbPct, lcbFpp: lwl * (0.5 - lcbPct / 100), lcfFpp: lwl * (0.5 - lcfPct / 100) };
}

/** The regression's parameters for a hull. */
export function dsyhsParams(p) {
  const c = Math.cbrt(p.volumeM3);
  return {
    lcbFpp: p.lcbFpp / p.lwl,
    cp: p.cp,
    volAw: (c * c) / p.awM2,
    bwlLwl: p.bwl / p.lwl,
    lcbLcf: p.lcbFpp / p.lcfFpp,
    bwlTc: p.bwl / p.tc,
    cm: p.cm,
    volLwl: c / p.lwl,
  };
}

/** Every DSYHS parameter outside the regression's range: [{ id, label, value, min, max }]. */
export function envelope(p) {
  const v = dsyhsParams(p);
  return DSYHS_ENVELOPE.filter((e) => !(v[e.id] >= e.min && v[e.id] <= e.max)).map((e) => ({ ...e, value: v[e.id] }));
}

/**
 * How far outside the regression a hull is: each parameter's distance past
 * its range as a fraction of the range's width. "near": one or two
 * parameters, each within half a range-width; "far": more, or further.
 * @returns {{ level: "inside"|"near"|"far", count: number, of: number, worst: number, text: string }}
 */
export function envelopeGrade(out) {
  const of = DSYHS_ENVELOPE.length;
  if (!out.length) return { level: "inside", count: 0, of, worst: 0, text: "" };
  const past = out.map((e) => {
    const d = e.value < e.min ? e.min - e.value : e.value - e.max;
    return fin(d) ? d / (e.max - e.min) : Infinity;
  });
  const worst = Math.max(...past);
  const level = out.length >= 3 || worst > 0.5 ? "far" : "near";
  return {
    level,
    count: out.length,
    of,
    worst,
    text: `DSYHS extrapolated: ${out.length} of ${of} hull parameters outside the fitted range${level === "far" ? ", some far outside; the speeds are a guess past the data" : ", just outside"}`,
  };
}

/** Plain text for an envelope's violations, or "". */
export const envelopeText = (out) =>
  out.length ? `DSYHS residuary extrapolated: ${out.map((e) => `${e.label} ${fin(e.value) ? e.value.toFixed(3) : "unknown"} (fitted ${e.min}–${e.max})`).join("; ")}.` : "";

export const froudeOf = (V, lwl) => V / Math.sqrt(G * lwl);

/** ITTC-57 friction on a wetted area at Re on 0.7·LWL. */
export function frictionN(V, { lwl, wsaM2 }, { rho = RHO_SEA, nu = NU_SEA } = {}) {
  if (!(V > 0) || !(wsaM2 > 0)) return 0;
  return 0.5 * rho * V * V * wsaM2 * ittc57((V * 0.7 * lwl) / nu);
}

/** DSYHS upright residuary coefficient R_r/(∇ρg) at a Froude number (tapered below 0.15). */
export function residuaryCoefficient(p, fn) {
  if (!(fn > 0)) return 0;
  const a = rowAt(RESIDUARY_FN, RESIDUARY_A, fn);
  const x = dsyhsParams(p);
  const c = a[0] + (a[1] * x.lcbFpp + a[2] * x.cp + a[3] * x.volAw + a[4] * x.bwlLwl + a[5] * x.lcbLcf + a[6] * x.bwlTc + a[7] * x.cm) * x.volLwl;
  return fn < RESIDUARY_FN[0] ? (c * fn) / RESIDUARY_FN[0] : c;
}

/** DSYHS upright residuary, N. */
export function residuaryN(V, p, { rho = RHO_SEA, g = G } = {}) {
  return residuaryCoefficient(p, V / Math.sqrt(g * p.lwl)) * p.volumeM3 * rho * g;
}

/** DSYHS change of residuary with heel, N (heel in degrees). */
export function heelResiduaryN(V, heelDeg, p, { rho = RHO_SEA, g = G } = {}) {
  const fn = V / Math.sqrt(g * p.lwl);
  if (!(fn > 0) || !heelDeg) return 0;
  const u = rowAt(HEEL_FN, HEEL_U, fn);
  const bt = p.bwl / p.tc;
  const lcb = p.lcbPct;
  const c = (u[0] + u[1] * (p.lwl / p.bwl) + u[2] * bt + u[3] * bt * bt + u[4] * lcb + u[5] * lcb * lcb) / 1000;
  const taper = fn < HEEL_FN[0] ? fn / HEEL_FN[0] : 1;
  return taper * c * p.volumeM3 * rho * g * 6 * Math.abs(heelDeg * RAD) ** 1.7;
}

/** DSYHS effective draft T_e (m) at a Froude number and heel. */
export function effectiveDraft({ T, tc, bwl, taper }, fn, heelDeg = 0) {
  if (!(T > 0)) return 0;
  const r = Math.min(1, tc / T);
  const [A1, A2, A3, A4, B0, B1] = TE_UPRIGHT;
  const te = T * (A1 * r + A2 * r * r + A3 * (bwl / tc) + A4 * (fin(taper) ? taper : 0.5)) * (B0 + B1 * Math.min(0.75, Math.max(0, fn)));
  return Math.max(0.1 * T, te) * Math.cos(heelDeg * RAD);
}

/** Induced resistance, N, of a side force F (N) at speed V for an effective draft T_e. */
export const inducedN = (F, V, te, rho = RHO_SEA) => (V > 0 && te > 0 ? (F * F) / (Math.PI * te * te * 0.5 * rho * V * V) : 0);

/** Hoerner's form factor for a streamlined body of diameter/length d. */
export const bodyFormFactor = (d) => 1 + 1.5 * d ** 1.5 + 7 * d ** 3;

/** Wetted area of a prolate spheroid of length L and diameter D. */
export function spheroidArea(L, D) {
  const a = L / 2, b = D / 2;
  if (!(a > b)) return 4 * Math.PI * b * b;
  const e = Math.sqrt(1 - (b * b) / (a * a));
  return 2 * Math.PI * b * b * (1 + (a / (b * e)) * Math.asin(e));
}

/** Appendage viscous drag, N: foils' profile drag and a bulb's friction. */
export function appendageN(V, foils, { rho = RHO_SEA, nu = NU_SEA } = {}) {
  if (!(V > 0)) return 0;
  const q = 0.5 * rho * V * V;
  let r = 0;
  for (const f of foils) {
    r += q * f.areaM2 * cd0At(f, V, nu);
    if (f.bulb) {
      const S = spheroidArea(f.bulb.length, f.bulb.diameter);
      r += q * S * ittc57((V * f.bulb.length) / nu) * bodyFormFactor(f.bulb.diameter / f.bulb.length);
    }
  }
  return r;
}

// ───────────────────────────────── planing

const RHO_P = RHO_SEA;

function bisect(f, target, lo, hi, iters = 60) {
  let flo = f(lo) - target;
  const fhi = f(hi) - target;
  if (flo * fhi > 0) return Math.abs(flo) < Math.abs(fhi) ? lo : hi;
  for (let i = 0; i < iters; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid) - target;
    if (fm === 0) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return 0.5 * (lo + hi);
}

const cpFrac = (cv, lam) => 0.75 - 1 / (5.21 * (cv / lam) ** 2 + 2.39);

/**
 * Savitsky's prismatic planing surface at speed V (m/s).
 * @param {{ weightN: number, beam: number, deadriseDeg: number, lcg: number }} s lcg forward of the transom, m
 */
export function savitsky(s, V, { rho = RHO_P, nu = NU_SEA, g = 9.8066, deltaCf = SAVITSKY_DELTA_CF } = {}) {
  const { weightN: W, beam: b, deadriseDeg: beta, lcg } = s;
  const cv = V / Math.sqrt(g * b);
  const cLbeta = W / (0.5 * rho * V * V * b * b);
  const cL0 = bisect((c) => c - 0.0065 * beta * c ** 0.6, cLbeta, cLbeta, cLbeta + 0.0065 * beta * (cLbeta + 1) ** 0.6 + 1);
  const lambda = bisect((lam) => cpFrac(cv, lam) * lam * b, lcg, 0.2, 12);
  const liftGeom = 0.012 * Math.sqrt(lambda) + (0.0055 * lambda ** 2.5) / cv ** 2;
  const tau = (cL0 / liftGeom) ** (1 / 1.1);
  const tauR = tau * RAD;
  const dyn = 0.012 * tau ** 1.1 * Math.sqrt(lambda);
  const vm = V * Math.sqrt(Math.max(0, 1 - (dyn - 0.0065 * beta * dyn ** 0.6) / (lambda * Math.cos(tauR))));
  const rn = (vm * lambda * b) / nu;
  const cf = ittc57(rn);
  const rFric = (0.5 * rho * vm * vm * lambda * b * b * (cf + deltaCf)) / Math.cos(beta * RAD);
  const rInduced = W * Math.tan(tauR);
  const rTotal = rInduced + rFric / Math.cos(tauR);
  const inRange = cv >= 1 && tau >= 2 && tau <= 15 && lambda <= 4;
  const why = [];
  if (cv < 1) why.push(`C_V ${cv.toFixed(2)} < 1: not yet planing`);
  if (tau < 2 || tau > 15) why.push(`trim ${tau.toFixed(1)}° outside 2–15°`);
  if (lambda > 4) why.push(`wetted length ${lambda.toFixed(2)} beams > 4`);
  return { cv, cLbeta, cL0, lambda, tau, vm, cf, rFric, rInduced, rTotal, inRange, why };
}

/** Planing capability from D/L (long tons over (0.01·LWL ft)³). */
export const planingCapability = (dL) => (fin(dL) ? 1 - smoothstep(dL, 110, 160) : 0);
export const PLANING_FN = [0.55, 0.75];
export const FN_MAX_DISPLACEMENT = 0.75;

/**
 * A resistance model for a hull and its foils: R(V, φ, F_h) and its parts.
 * @param {{ hull: ReturnType<typeof dsyhsHull>, foils: object[], draftT: number, keelTaper: number,
 *           planing: { capability: number, weightN: number, beam: number, deadriseDeg: number, lcg: number },
 *           wsaAt?: (heelDeg: number) => number|null }} m
 */
export function resistanceModel(m) {
  const env = envelope(m.hull);
  return {
    envelope: env,
    capability: m.planing?.capability ?? 0,
    /**
     * @param {number} V m/s  @param {number} heelDeg
     * @param {number} sideN the water's side force in the heeled foil plane, N (Y); the induced
     *   term uses its horizontal part Y·cos φ, so with T_e(φ) = T_e(0)·cos φ it is Y²/(π·T_e(0)²·q)
     */
    at(V, heelDeg = 0, sideN = 0) {
      const fn = froudeOf(V, m.hull.lwl);
      const wsa = m.wsaAt?.(heelDeg) ?? m.hull.wsaM2;
      const rf = frictionN(V, { lwl: m.hull.lwl, wsaM2: wsa });
      const rr = residuaryN(V, m.hull);
      const dr = heelResiduaryN(V, heelDeg, m.hull);
      const disp = rf + rr + dr;
      const cap = m.planing?.capability ?? 0;
      let w = cap > 0 ? smoothstep(fn, PLANING_FN[0], PLANING_FN[1]) * cap : 0;
      let pl = null;
      let degenerate = false;
      if (w > 0) {
        pl = savitsky(m.planing, V);
        // no solution (V_m → 0 on an absurd hull): displacement only, said so
        if (!fin(pl.rTotal)) {
          degenerate = true;
          pl = null;
          w = 0;
        }
      }
      const hullN = pl ? (1 - w) * disp + w * pl.rTotal : disp;
      const app = appendageN(V, m.foils);
      const te = effectiveDraft({ T: m.draftT, tc: m.hull.tc, bwl: m.hull.bwl, taper: m.keelTaper }, fn, heelDeg);
      const ri = inducedN(sideN * Math.cos(heelDeg * RAD), V, te);
      const regime = fn <= FN_MAX_DISPLACEMENT ? (w > 0 ? "transition" : "displacement") : cap >= 0.5 ? "planing" : "beyond";
      return { V, fn, heelDeg, friction: rf, residuary: rr, heel: dr, displacement: disp, planing: pl?.rTotal ?? null, planingWeight: w, savitsky: pl, hull: hullN, appendages: app, induced: ri, te, wsa, total: hullN + app + ri, regime, degenerate };
    },
  };
}

/**
 * The regime at a Froude number, in words, for a hull that can or cannot plane.
 * @returns {{ id: "displacement"|"transition"|"planing"|"beyond", text: string }}
 */
export function regime(fn, capability) {
  if (fn <= PLANING_FN[0] || (capability <= 0 && fn <= FN_MAX_DISPLACEMENT)) return { id: "displacement", text: "displacement (DSYHS)" };
  if (fn <= FN_MAX_DISPLACEMENT) return capability > 0 ? { id: "transition", text: "displacement to planing (DSYHS blended with Savitsky)" } : { id: "displacement", text: "displacement (DSYHS)" };
  if (capability >= 0.5) return { id: "planing", text: "planing (Savitsky)" };
  return { id: "beyond", text: "beyond model: past the DSYHS table (Fn 0.75) on a hull too heavy to plane" };
}
