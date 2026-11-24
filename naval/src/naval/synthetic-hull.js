// A closed hull mesh from principal dimensions, so a boat with no drawn hull
// (the validation boats, a quick "what if") goes through exactly the same
// mesh hydrostatics as a camber hull. Pure.
//
// The canoe body: super-ellipse sections |y/b|ⁿ + |z/t|ⁿ = 1 whose fullness
// n is fitted to Cm, along a sectional-area curve f(u) = 1 − |u|^p (u = −1 at
// the aft end of the LWL, 0 at mid-LWL, +1 at the forward end) with its own
// p fore and aft, fitted to Cp and LCB. Each section's half-breadth and depth
// share f as f^α · f^(1−α). Topsides run straight from the waterline to a flat
// sheer at the stated freeboard; overhangs make up LOA − LWL (estimated split,
// a raked stem forward and a transom aft). After the mesh is built its
// underwater depth is scaled so ∇ is exactly Δ/ρ: a polygonal section is a
// little leaner than the smooth one it samples, and only the depth absorbs it.
//
// Frame: x forward, y port, z up, metres; origin at mid-LWL on the design
// waterline. Which coefficients are given and which estimated decides which
// one moves to carry the displacement (fitSynthetic).

import { RHO_SEA, qty } from "./units.js";

/** Estimated canoe-body coefficients when none are given (mid-range modern yacht canoe bodies; to verify against DSYHS in the resistance step). */
export const SYNTH_DEFAULTS = Object.freeze({
  cp: 0.56,
  cm: 0.72,
  lcbFrac: -0.03, // LCB aft of mid-LWL, as a fraction of LWL
  bowOverhangShare: 0.6, // of LOA − LWL
  transomHalfBeamFrac: 0.75, // transom half-breadth / half the beam
  transomHeightFrac: 0.25, // transom bottom above the DWL / freeboard
  alpha: 0.6, // half-breadth takes f^α, depth f^(1−α)
});
const CP_RANGE = [0.5, 0.62];
const CM_RANGE = [0.55, 0.95];

/** Γ(x) for x > 0 (Lanczos, g = 7). */
export function gamma(x) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/** Area of the lower half of a super-ellipse over its 2b × t box: Γ(1+1/n)² / Γ(1+2/n). */
export const sectionCoefficient = (n) => gamma(1 + 1 / n) ** 2 / gamma(1 + 2 / n);

/** The super-ellipse exponent whose section coefficient is cm (0.17 … 0.99). */
export function exponentForCm(cm) {
  let lo = 0.5, hi = 200;
  for (let i = 0; i < 100; i++) {
    const mid = Math.sqrt(lo * hi);
    if (sectionCoefficient(mid) < cm) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/**
 * Split Cp into fore and aft fullnesses a = p/(p+1) so the curve's centroid
 * sits at lcbFrac·LWL. In half-lengths, a half's area is a and its moment
 * a/(2(2 − a)); a_f + a_a = 2·Cp.
 * @returns {{ pFwd: number, pAft: number, lcbFrac: number }}
 */
export function fitSAC(cp, lcbFrac) {
  const sum = 2 * cp;
  const lcbOf = (af) => {
    const aa = sum - af;
    return (af / (2 * (2 - af)) - aa / (2 * (2 - aa))) / sum / 2; // half-lengths → fraction of LWL
  };
  let lo = Math.max(1e-6, sum - 0.999999);
  let hi = Math.min(0.999999, sum - 1e-6);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (lcbOf(mid) < lcbFrac) lo = mid;
    else hi = mid;
  }
  const af = 0.5 * (lo + hi);
  const aa = sum - af;
  return { pFwd: af / (1 - af), pAft: aa / (1 - aa), lcbFrac: lcbOf(af) };
}

/**
 * Settle the coefficients and the canoe-body depth for given dims.
 * Given values are kept; estimated ones move first; the depth moves last
 * (or first, when Tc itself is estimated).
 * @param {{ loa, lwl, beam, bwl, tc, freeboard, displacementKg, cp?, cm?, lcbFrac? }} dims
 * @param {{ estimated?: string[], rho?: number }} [o] estimated: dims keys marked estimated
 */
export function fitSynthetic(dims, { estimated = [], rho = RHO_SEA } = {}) {
  const est = new Set(estimated);
  const L = dims.lwl, B = dims.bwl;
  const V = dims.displacementKg / rho;
  const warnings = [];
  const made = []; // coefficients this filled in
  const given = (k) => Number.isFinite(dims[k]) && dims[k] > 0 && !est.has(k);
  let cp = given("cp") ? dims.cp : null;
  let cm = given("cm") ? dims.cm : null;
  const lcbFrac = Number.isFinite(dims.lcbFrac) && !est.has("lcbFrac") ? dims.lcbFrac : SYNTH_DEFAULTS.lcbFrac;
  if (!(Number.isFinite(dims.lcbFrac) && !est.has("lcbFrac"))) made.push("lcbFrac");
  let T = dims.tc;
  const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));
  if (!(L > 0 && B > 0 && V > 0)) return { ok: false, error: "LWL, BWL and displacement must all be more than zero for a synthetic hull." };
  if (!given("tc") || !(T > 0)) {
    if (cp == null) (cp = SYNTH_DEFAULTS.cp), made.push("cp");
    if (cm == null) (cm = SYNTH_DEFAULTS.cm), made.push("cm");
    T = V / (cp * cm * L * B);
  } else {
    const cb = V / (L * B * T);
    if (cp == null && cm == null) {
      cm = SYNTH_DEFAULTS.cm;
      cp = clamp(cb / cm, CP_RANGE);
      cm = clamp(cb / cp, CM_RANGE);
      made.push("cp", "cm");
    } else if (cp == null) {
      cp = clamp(cb / cm, CP_RANGE);
      made.push("cp");
    } else if (cm == null) {
      cm = clamp(cb / cp, CM_RANGE);
      made.push("cm");
    }
    const T2 = V / (cp * cm * L * B);
    if (Math.abs(T2 / T - 1) > 0.02)
      warnings.push(
        `The given Tc (${qty(T, "length", 3)}) and the displacement don't agree with Cp ${cp.toFixed(3)} and Cm ${cm.toFixed(3)}: the synthetic hull floats ${Math.abs(100 * (T2 / T - 1)).toFixed(0)}% ${T2 < T ? "shallower" : "deeper"}, at ${qty(T2, "length", 3)}, so that it displaces what was given.`,
      );
    T = T2;
  }
  const sac = fitSAC(cp, lcbFrac);
  return { ok: true, L, B, T, V, cp, cm, lcbFrac, n: exponentForCm(cm), ...sac, made: [...new Set(made)], warnings };
}

/**
 * The mesh. Returns triangles (9 per triangle, outward), the fit, and the
 * figures it was built to.
 * @param {object} dims see fitSynthetic
 * @param {{ estimated?: string[], stations?: number, girth?: number }} [o]
 */
export function syntheticHull(dims, { estimated = [], stations = 48, girth = 12, topsides = 3, overhangStations = 6 } = {}) {
  const fit = fitSynthetic(dims, { estimated });
  if (!fit.ok) return fit;
  const D = SYNTH_DEFAULTS;
  const { L, B, T, n, pFwd, pAft } = fit;
  const loa = Math.max(dims.loa > 0 ? dims.loa : L, L);
  const fb = Math.max(0.01 * L, dims.freeboard > 0 ? dims.freeboard : 0.1 * L);
  const beam = Math.max(dims.beam > 0 ? dims.beam : B, B);
  const over = loa - L;
  const xStem = L / 2 + D.bowOverhangShare * over;
  const xStern = -L / 2 - (1 - D.bowOverhangShare) * over;
  const zTransom = D.transomHeightFrac * fb;
  const a = D.alpha;

  const f = (x) => {
    const u = (2 * x) / L;
    if (u >= 1 || u <= -1) return 0;
    return u >= 0 ? 1 - Math.pow(u, pFwd) : 1 - Math.pow(-u, pAft);
  };
  const sheerHalf = (x) => {
    const half = beam / 2;
    if (x >= 0) {
      const v = Math.min(1, x / (xStem || 1));
      return half * Math.sqrt(Math.max(0, 1 - v * v));
    }
    const v = Math.min(1, x / (xStern || -1));
    return half * (1 - (1 - D.transomHalfBeamFrac) * v * v);
  };

  // stations: the overhangs, then the LWL with one at mid-LWL, stern first
  const xs = [];
  if (xStern < -L / 2) for (let i = 0; i < overhangStations; i++) xs.push(xStern + ((-L / 2 - xStern) * i) / overhangStations);
  for (let i = 0; i <= stations; i++) xs.push(-L / 2 + (L * i) / stations);
  if (xStem > L / 2) for (let i = 1; i <= overhangStations; i++) xs.push(L / 2 + ((xStem - L / 2) * i) / overhangStations);

  // one closed loop per station: keel, up the port side, across the deck, down the starboard side
  const loops = xs.map((x) => {
    const fx = f(x);
    const bw = (B / 2) * Math.pow(fx, a);
    const t = T * Math.pow(fx, 1 - a);
    const wet = fx > 0;
    const zk = wet ? -t : x > 0 ? (fb * (x - L / 2)) / Math.max(1e-9, xStem - L / 2) : (zTransom * (-L / 2 - x)) / Math.max(1e-9, -L / 2 - xStern);
    const bs = Math.max(sheerHalf(x), bw);
    const port = [];
    for (let i = 1; i <= girth; i++) {
      const th = ((i / girth) * Math.PI) / 2;
      port.push(wet ? [bw * Math.pow(Math.sin(th), 2 / n), -t * Math.pow(Math.cos(th), 2 / n)] : [0, zk]);
    }
    const [y0, z0] = wet ? [bw, 0] : [0, zk];
    for (let i = 1; i <= topsides; i++) port.push([y0 + ((bs - y0) * i) / topsides, z0 + ((fb - z0) * i) / topsides]);
    const loop = [[x, 0, zk], ...port.map(([y, z]) => [x, y, z])];
    for (let i = port.length - 1; i >= 0; i--) loop.push([x, -port[i][0], port[i][1]]);
    return loop;
  });

  const out = [];
  const push = (p, q, r) => out.push(...p, ...q, ...r);
  const m = loops[0].length;
  for (let s = 0; s + 1 < loops.length; s++) {
    const A = loops[s], Bn = loops[s + 1];
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      push(A[k], A[k2], Bn[k2]);
      push(A[k], Bn[k2], Bn[k]);
    }
  }
  // end caps: a fan from each end loop's centroid (the stem loop is a point, its cap has no area)
  for (const [loop, flip] of [
    [loops[0], false],
    [loops[loops.length - 1], true],
  ]) {
    const c = loop.reduce((s, p) => [s[0] + p[0] / m, s[1] + p[1] / m, s[2] + p[2] / m], [0, 0, 0]);
    for (let k = 0; k < m; k++) {
      const p = loop[k], q = loop[(k + 1) % m];
      if (flip) push(c, p, q);
      else push(c, q, p);
    }
  }

  // carry the displacement exactly: scale the depth of everything below the DWL
  const tri = Float64Array.from(out);
  let v6 = 0;
  for (let i = 0; i < tri.length; i += 9) {
    // ∇ below z = 0 by ∫ z n_z dA over the faces below it (topsides start at z = 0, so none straddle)
    const z = [tri[i + 2], tri[i + 5], tri[i + 8]];
    if (z.some((v) => v > 1e-12)) continue;
    const ux = tri[i + 3] - tri[i], uy = tri[i + 4] - tri[i + 1];
    const vx = tri[i + 6] - tri[i], vy = tri[i + 7] - tri[i + 1];
    v6 += (ux * vy - uy * vx) * (z[0] + z[1] + z[2]);
  }
  const vMesh = Math.abs(v6) / 6;
  const k = vMesh > 0 ? fit.V / vMesh : 1;
  for (let i = 2; i < tri.length; i += 3) if (tri[i] < 0) tri[i] *= k;
  return {
    ok: true,
    triangles: tri,
    fit: { ...fit, T: fit.T * k, depthScale: k },
    loa,
    beam,
    freeboard: fb,
    xStem,
    xStern,
    frame: "x forward, y port, z up; origin mid-LWL on the design waterline",
  };
}
