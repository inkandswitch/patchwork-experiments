// For tests only: sailing's spectrum (ocean.js), copied, so the surface's
// tests can make a sea for a wind as sailing does (water itself never makes
// waves: whoever contributes them does), evaluated by this package's own
// surface.js.
import { prng } from "../prng.js";
import { createSurface } from "../surface.js";
const downwind = (from) => { const a = ((Number(from) || 0) * Math.PI) / 180; return [-Math.sin(a), Math.cos(a)]; };
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
 * The sea for a wind, as sailing makes it, evaluated by this package's own
 * surface: { wind, seed, scale, components, stats } and the surface's queries.
 * @param {{ wind?: { speed?: number, from?: number }, seed?: number|string, scale?: number, count?: number }} o
 */
export function createOcean({ wind = {}, seed = 1, scale = 1, count = 32 } = {}) {
  const speed = Math.max(0, Number(wind.speed) || 0);
  const from = Number(wind.from) || 0;
  const components = waveComponents({ speed, from }, seed, scale, count);
  const pm = pmSea(speed);
  const sc = Math.max(0, Number(scale ?? 1));
  return {
    wind: { speed, from },
    seed,
    scale: sc,
    stats: { hs: pm.hs * sc, peakPeriod: pm.peakPeriod, peakWavelength: pm.peakWavelength, whitecaps: components.length ? whitecapCoverage(speed) : 0 },
    ...createSurface(components),
  };
}
