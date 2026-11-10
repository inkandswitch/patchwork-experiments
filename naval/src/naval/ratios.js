// The designer's ratios, each with the band it is usually read against.
// Pure, SI in, no DOM.
//
//   SA/D   = SA / ∇^(2/3)                 dimensionless; equal to the ft form
//            SA ft² / (Δ lb / 64)^(2/3) (64 lb/ft³ sea water = 1025.18 kg/m³)
//   D/L    = Δ (long tons) / (0.01 · LWL ft)³
//   ballast ratio = ballast / Δ
//   LWL/BWL, BWL/Tc, LWL/∇^(1/3)
//   hull speed = 1.34 · √(LWL ft) knots   (Fn ≈ 0.40)
//
// Bands are rules of thumb, not limits, and are labelled so. Where a band is
// a regression's validity range (DSYHS), it says so: outside it the
// resistance model (resistance.js) extrapolates.

import { FT, LONG_TON, RHO_SEA, KNOT } from "./units.js";

export const G = 9.80665;

/** Displaced volume ∇ (m³) of a mass in sea water. */
export const displacedVolume = (massKg, rho = RHO_SEA) => massKg / rho;

/** SA/D: sail area over displaced volume^(2/3). */
export const saD = (areaM2, volM3) => (areaM2 > 0 && volM3 > 0 ? areaM2 / Math.pow(volM3, 2 / 3) : NaN);

/** D/L: displacement in long tons over (LWL/100 in feet)³. */
export const dL = (massKg, lwlM) =>
  massKg > 0 && lwlM > 0 ? massKg / LONG_TON / Math.pow((0.01 * lwlM) / FT, 3) : NaN;

export const ballastRatio = (ballastKg, massKg) => (ballastKg >= 0 && massKg > 0 ? ballastKg / massKg : NaN);

/** Hull speed, m/s: 1.34·√(LWL ft) knots. */
export const hullSpeed = (lwlM) => (lwlM > 0 ? 1.34 * Math.sqrt(lwlM / FT) * KNOT : NaN);

const ratio = (a, b) => (a > 0 && b > 0 ? a / b : NaN);

const BREWER =
  "Rule of thumb, as commonly quoted after T. Brewer, Understanding Boat Design (International Marine); the book was not checked for this table.";
const DSYHS =
  "Delft Systematic Yacht Hull Series range as Larsson, Eliasson & Orych (Principles of Yacht Design, 5th ed.) quote it, transcribed in aciceri/vela dsyhs.rs (retrieved 2026-11-06): LWL/BWL 2.73–5.00, BWL/Tc 2.46–19.38, LWL/∇^⅓ 4.34–8.50. Keuning & Katgert (2008) Table 1 (as transcribed by lofilobzik/sail) agrees on BWL/Tc and ∇^⅓/LWL (0.12–0.23) but gives BWL/LWL down to 0.170 (LWL/BWL up to 5.88). The resistance model checks the regression's own parameters (Performance).";

/**
 * Bands: ordered intervals [{ upTo, label }] (the last has upTo Infinity),
 * or for a validity range { min, max }.
 */
export const BANDS = {
  saD: {
    kind: "scale",
    source: BREWER,
    steps: [
      { upTo: 16, label: "low: heavy cruiser, motor-sailer" },
      { upTo: 20, label: "moderate: cruiser, performance cruiser" },
      { upTo: 25, label: "high: racer" },
      { upTo: Infinity, label: "very high: light racer, dinghy" },
    ],
  },
  dL: {
    kind: "scale",
    source: BREWER,
    steps: [
      { upTo: 100, label: "ultralight" },
      { upTo: 200, label: "light" },
      { upTo: 300, label: "moderate" },
      { upTo: 400, label: "heavy" },
      { upTo: Infinity, label: "very heavy" },
    ],
  },
  ballast: {
    kind: "scale",
    source: "Rule of thumb for ballasted keelboats; a dinghy's ballast is her crew.",
    steps: [
      { upTo: 0.3, label: "light ballast: stiffness from form or crew" },
      { upTo: 0.4, label: "typical" },
      { upTo: Infinity, label: "heavily ballasted" },
    ],
  },
  lwlBwl: { kind: "range", min: 2.73, max: 5.0, source: DSYHS },
  bwlTc: { kind: "range", min: 2.46, max: 19.38, source: DSYHS },
  slenderness: { kind: "range", min: 4.34, max: 8.5, source: DSYHS },
};

/**
 * Where a value sits on its band.
 * @returns {{ label: string, out?: boolean } | null}
 */
export function bandOf(id, value) {
  const b = BANDS[id];
  if (!b || !Number.isFinite(value)) return null;
  if (b.kind === "range") {
    if (value < b.min) return { label: `below the DSYHS range (${b.min}–${b.max})`, out: true };
    if (value > b.max) return { label: `above the DSYHS range (${b.min}–${b.max})`, out: true };
    return { label: `within the DSYHS range (${b.min}–${b.max})` };
  }
  const step = b.steps.find((s) => value < s.upTo) ?? b.steps[b.steps.length - 1];
  return { label: step.label };
}

/**
 * Every ratio at once.
 * @param {{ saDesignerM2: number, saActualM2: number, displacementKg: number,
 *           lwl: number, bwl: number, tc: number, ballastKg: number }} x
 */
export function computeRatios(x) {
  const vol = displacedVolume(x.displacementKg);
  return {
    volumeM3: vol,
    saDDesigner: saD(x.saDesignerM2, vol),
    saDActual: saD(x.saActualM2, vol),
    dL: dL(x.displacementKg, x.lwl),
    ballast: ballastRatio(x.ballastKg, x.displacementKg),
    lwlBwl: ratio(x.lwl, x.bwl),
    bwlTc: ratio(x.bwl, x.tc),
    slenderness: vol > 0 && x.lwl > 0 ? x.lwl / Math.cbrt(vol) : NaN,
    hullSpeedMs: hullSpeed(x.lwl),
  };
}
