// The sea: a wind-driven wave spectrum sampled into Gerstner waves, and the
// queries physics and walking ask of it. Pure (no three.js): the same
// component list feeds the surface's shader, so what floats is what you see.
//
// The spectrum is Pierson-Moskowitz, a fully developed sea for the wind
// speed, spread around the downwind direction by a cos^2s(θ/2) law whose
// width depends on frequency (Mitsuyasu: narrowest at the peak). It is cut
// into log-spaced frequency bands, one Gerstner wave per band, each carrying
// exactly its band's energy, so the sea's significant wave height is the
// spectrum's. Where in its band each wave's frequency falls, which way it
// heads and its phase come from a PRNG seeded by `seed`, so a seed is a sea.

import { downwind, prng } from "./wind.js";

const G = 9.81;
// Phillips' constant: the PM spectrum's level
const ALPHA = 0.0081;
// the band the waves sample, around the peak frequency: below 0.65 ωp a PM
// spectrum holds nothing, and above 6 ωp the waves are short enough to leave
// to the surface's normal-only detail
const LOW = 0.65;
const HIGH = 6;
// Σ Q·k·A, the most the waves may pinch the surface toward their crests. Kept
// under 1, the surface can't fold over itself; at 0.85 crests sharpen visibly
const CHOP = 0.85;
// the directional spread's s at the peak, and its bounds elsewhere
const SPREAD = 10;
const SPREAD_MIN = 1.5;
const SPREAD_MAX = 12;
const TAU = Math.PI * 2;

/**
 * Facts about a Pierson-Moskowitz sea for a wind speed (m/s at 10 m): the
 * peak's angular frequency, period and wavelength, the surface's variance m0
 * and its significant wave height 4·√m0 (about 2.1 m at 10 m/s). All zero
 * for no wind.
 */
export function pmSea(speed) {
  const U = Math.max(0, Number(speed) || 0);
  if (U <= 0) return { omegaPeak: 0, peakPeriod: 0, peakWavelength: 0, m0: 0, hs: 0 };
  const omegaPeak = (0.877 * G) / U;
  const m0 = (ALPHA * G * G) / (5 * omegaPeak ** 4);
  return { omegaPeak, peakPeriod: TAU / omegaPeak, peakWavelength: (TAU * G) / omegaPeak ** 2, m0, hs: 4 * Math.sqrt(m0) };
}

/** The share of a PM spectrum's energy below ω (it integrates in closed form). */
const pmCumulative = (omega, omegaPeak) => (omega <= 0 ? 0 : Math.exp(-1.25 * (omegaPeak / omega) ** 4));

/** Mitsuyasu's spreading exponent s at ω: widest well away from the peak. */
function spreadAt(omega, omegaPeak) {
  const r = omega / omegaPeak;
  const s = r <= 1 ? SPREAD * r ** 5 : SPREAD * r ** -2.5;
  return Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, s));
}

/** An angle off downwind (radians, −π..π) at quantile u of cos^2s(θ/2), by inverting its tabulated CDF. */
function spreadAngle(s, u) {
  const n = 512;
  const cdf = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const th = -Math.PI + (TAU * (i - 0.5)) / n;
    cdf[i] = cdf[i - 1] + Math.cos(th / 2) ** (2 * s);
  }
  const target = u * cdf[n];
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < target) lo = mid;
    else hi = mid;
  }
  const f = (target - cdf[lo]) / Math.max(cdf[hi] - cdf[lo], 1e-300);
  return -Math.PI + (TAU * (lo + f)) / n;
}

/**
 * Monahan's whitecap coverage for a wind speed: the fraction of the sea
 * that is breaking foam (~2% at 12 m/s). His fit counts the odd breaking
 * ripple in a light breeze too, but white horses only show from a moderate
 * breeze (Beaufort 4) up, so it's eased in between 5 and 8 m/s.
 */
export function whitecapCoverage(speed) {
  const U = Math.max(0, Number(speed) || 0);
  const t = Math.min(1, Math.max(0, (U - 5) / 3));
  return Math.min(1, 3.84e-6 * U ** 3.41 * t * t * (3 - 2 * t));
}

/**
 * The waves for a wind: ≤ `count` Gerstner components, deterministic from
 * `seed`. Empty for no wind.
 * @param {{ speed: number, from: number }} wind  @param {number|string} seed  @param {number} scale  @param {number} count
 * @returns {{ dir: number[], k: number, omega: number, amp: number, steep: number, phase: number }[]}
 */
export function waveComponents(wind, seed = 1, scale = 1, count = 32) {
  const { omegaPeak, m0 } = pmSea(wind?.speed);
  const n = Math.max(0, Math.min(32, Math.floor(count)));
  const sc = Math.max(0, Number(scale ?? 1));
  if (!omegaPeak || !n || !sc) return [];
  const rand = prng(seed);
  const [wx, wz] = downwind(wind.from);
  const lo = Math.log(LOW * omegaPeak);
  const step = (Math.log(HIGH * omegaPeak) - lo) / n;
  // the directions' quantiles, stratified: each band gets a different
  // stretch of the spread, in a seeded order, so the few waves there are
  // cover it evenly instead of bunching
  const slots = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.exp(lo + i * step);
    const b = Math.exp(lo + (i + 1) * step);
    const energy = m0 * (pmCumulative(b, omegaPeak) - pmCumulative(a, omegaPeak));
    const omega = Math.exp(lo + (i + rand()) * step);
    const off = spreadAngle(spreadAt(omega, omegaPeak), (slots[i] + rand()) / n);
    const c = Math.cos(off);
    const s = Math.sin(off);
    out.push({
      dir: [wx * c - wz * s, wx * s + wz * c],
      k: (omega * omega) / G, // deep water: ω² = g·k
      omega,
      amp: sc * Math.sqrt(2 * energy),
      steep: 1,
      phase: rand() * TAU,
    });
  }
  // the same steepness for all, as near circular orbits as the no-folding
  // bound allows
  const slope = out.reduce((sum, w) => sum + w.k * w.amp, 0);
  const q = Math.min(1, CHOP / Math.max(slope, 1e-12));
  for (const w of out) w.steep = q;
  return out;
}

/**
 * The sea for a wind.
 * @param {{ wind?: { speed?: number, from?: number }, seed?: number|string, scale?: number, count?: number }} o
 */
export function createOcean({ wind = {}, seed = 1, scale = 1, count = 32 } = {}) {
  const speed = Math.max(0, Number(wind.speed) || 0);
  const from = Number(wind.from) || 0;
  const components = waveComponents({ speed, from }, seed, scale, count);
  const n = components.length;
  const pm = pmSea(speed);
  const sc = Math.max(0, Number(scale ?? 1));

  // per-component constants, laid out flat for the hot loops below
  const KX = new Float64Array(n), KZ = new Float64Array(n), W = new Float64Array(n), P = new Float64Array(n);
  const K = new Float64Array(n), A = new Float64Array(n), AW = new Float64Array(n), QDX = new Float64Array(n), QDZ = new Float64Array(n);
  const QAX = new Float64Array(n), QAZ = new Float64Array(n), AKX = new Float64Array(n), AKZ = new Float64Array(n);
  const QXX = new Float64Array(n), QZZ = new Float64Array(n), QXZ = new Float64Array(n);
  components.forEach((c, i) => {
    const [dx, dz] = c.dir;
    const qa = c.steep * c.amp;
    KX[i] = c.k * dx;
    KZ[i] = c.k * dz;
    W[i] = c.omega;
    P[i] = c.phase;
    K[i] = c.k;
    A[i] = c.amp;
    AW[i] = c.amp * c.omega;
    QDX[i] = c.steep * dx;
    QDZ[i] = c.steep * dz;
    QAX[i] = qa * dx;
    QAZ[i] = qa * dz;
    AKX[i] = c.amp * c.k * dx;
    AKZ[i] = c.amp * c.k * dz;
    QXX[i] = qa * c.k * dx * dx;
    QZZ[i] = qa * c.k * dz * dz;
    QXZ[i] = qa * c.k * dx * dz;
  });

  // what solve() found: the rest point (x0, z0) whose wave-moved position is
  // the asked (x, z), the height there, and the surface's tangent terms
  const S = new Float64Array(8);
  const X0 = 0, Z0 = 1, H = 2, JXX = 3, JZZ = 4, JXZ = 5, GX = 6, GZ = 7;

  /**
   * Find which rest point the waves carry to (x, z) at t. A Gerstner wave
   * moves the surface sideways toward its crests, so the height at a world
   * point is the height of whatever point landed there. Newton's method on
   * x0 − D(x0) = x: its Jacobian (I − ΣQkA cos θ d dᵀ) is positive definite
   * while Σ QkA < 1, so it converges, in two to four rounds.
   */
  function solve(x, z, t) {
    let x0 = x;
    let z0 = z;
    for (let it = 0; it < 8; it++) {
      let sx = 0, sz = 0, h = 0, jxx = 1, jzz = 1, jxz = 0, gx = 0, gz = 0;
      for (let i = 0; i < n; i++) {
        const th = KX[i] * x0 + KZ[i] * z0 - W[i] * t + P[i];
        const s = Math.sin(th);
        const c = Math.cos(th);
        sx += QAX[i] * s;
        sz += QAZ[i] * s;
        h += A[i] * c;
        jxx -= QXX[i] * c;
        jzz -= QZZ[i] * c;
        jxz -= QXZ[i] * c;
        gx += AKX[i] * s;
        gz += AKZ[i] * s;
      }
      S[X0] = x0;
      S[Z0] = z0;
      S[H] = h;
      S[JXX] = jxx;
      S[JZZ] = jzz;
      S[JXZ] = jxz;
      S[GX] = gx;
      S[GZ] = gz;
      const rx = x0 - sx - x;
      const rz = z0 - sz - z;
      if (rx * rx + rz * rz < 1e-12) break;
      const det = jxx * jzz - jxz * jxz;
      x0 -= (jzz * rx - jxz * rz) / det;
      z0 -= (jxx * rz - jxz * rx) / det;
    }
    return S;
  }

  /** The surface's height above sea level at world (x, z) and time t. */
  function heightAt(x, z, t) {
    if (!n) return 0;
    return solve(x, z, t)[H];
  }

  /** The unit normal from solve()'s tangents, into out at offset o. */
  function normalInto(out, o) {
    // ∂P/∂x0 = (jxx, −gx, jxz) and ∂P/∂z0 = (jxz, −gz, jzz); the normal is ∂P/∂z0 × ∂P/∂x0
    const nx = S[GX] * S[JZZ] - S[GZ] * S[JXZ];
    const ny = S[JXX] * S[JZZ] - S[JXZ] * S[JXZ];
    const nz = S[GZ] * S[JXX] - S[GX] * S[JXZ];
    const l = Math.hypot(nx, ny, nz);
    out[o] = nx / l;
    out[o + 1] = ny / l;
    out[o + 2] = nz / l;
    return out;
  }

  /** The surface's unit normal at world (x, z), t. Writes into `out` when given. */
  function normalAt(x, z, t, out = [0, 1, 0]) {
    if (!n) {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return out;
    }
    solve(x, z, t);
    return normalInto(out, 0);
  }

  /** Height and normal in one solve, into `out` as [y, nx, ny, nz]: what a buoyancy sample wants. */
  function sampleAt(x, z, t, out = [0, 0, 1, 0]) {
    if (!n) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 1;
      out[3] = 0;
      return out;
    }
    solve(x, z, t);
    out[0] = S[H];
    return normalInto(out, 1);
  }

  /**
   * The water's orbital velocity at a world point, t. Each wave's motion
   * decays as e^{k·depth}, depth measured down from the surface above the
   * point (Wheeler's stretching), so at the surface it is exactly the
   * surface's own motion and a point above the water takes the surface's.
   * Writes into `out` when given.
   */
  function velocityAt(x, y, z, t, out = [0, 0, 0]) {
    out[0] = out[1] = out[2] = 0;
    if (!n) return out;
    solve(x, z, t);
    const x0 = S[X0];
    const z0 = S[Z0];
    const depth = Math.min(0, y - S[H]);
    let vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) {
      const th = KX[i] * x0 + KZ[i] * z0 - W[i] * t + P[i];
      const e = AW[i] * Math.exp(K[i] * depth);
      const c = Math.cos(th);
      vx += e * QDX[i] * c;
      vz += e * QDZ[i] * c;
      vy += e * Math.sin(th);
    }
    out[0] = vx;
    out[1] = vy;
    out[2] = vz;
    return out;
  }

  /**
   * Where the rest point (x0, z0) is carried at t, and the horizontal
   * Jacobian there (< 1 where the surface is squeezed into a crest, the
   * foam's measure): [x, y, z, J]. The forward map, the one the shader runs.
   */
  function displaced(x0, z0, t, out = [0, 0, 0, 1]) {
    let sx = 0, sz = 0, h = 0, jxx = 1, jzz = 1, jxz = 0;
    for (let i = 0; i < n; i++) {
      const th = KX[i] * x0 + KZ[i] * z0 - W[i] * t + P[i];
      const s = Math.sin(th);
      const c = Math.cos(th);
      sx += QAX[i] * s;
      sz += QAZ[i] * s;
      h += A[i] * c;
      jxx -= QXX[i] * c;
      jzz -= QZZ[i] * c;
      jxz -= QXZ[i] * c;
    }
    out[0] = x0 - sx;
    out[1] = h;
    out[2] = z0 - sz;
    out[3] = jxx * jzz - jxz * jxz;
    return out;
  }

  return {
    wind: { speed, from },
    seed,
    scale: sc,
    components,
    /** what the sea is like: significant wave height (m), the peak's period (s) and wavelength (m), whitecap coverage (0..1) */
    stats: {
      hs: pm.hs * sc,
      peakPeriod: pm.peakPeriod,
      peakWavelength: pm.peakWavelength,
      whitecaps: n ? whitecapCoverage(speed) : 0,
    },
    heightAt,
    normalAt,
    sampleAt,
    velocityAt,
    displaced,
  };
}
