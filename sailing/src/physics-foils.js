// Lift and drag coefficients for the ship's foils: the keel and rudder
// (symmetric sections in water) and the sail (a cambered one in air). Pure
// scalar functions, so the physics' hot loop allocates nothing.
//
// α is the angle between the chord and the flow, 0..π: past π/2 the flow
// comes from behind.

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Lift per radian of a finite wing (Helmbold): a stubby keel is softer than a long rudder. */
export function liftSlope(aspect) {
  return (2 * Math.PI * aspect) / (2 + Math.sqrt(aspect * aspect + 4));
}

export const STALL = 15 * DEG;

/**
 * A symmetric foil's lift: linear up to the stall at 15°, then falling away
 * to a flat plate's. A foil in reversed flow is the same foil backwards.
 */
export function foilCL(alpha, slope) {
  const a = alpha > HALF_PI ? Math.PI - alpha : alpha;
  const attached = slope * Math.min(a, STALL);
  const plate = 0.8 * Math.sin(2 * a);
  const w = smoothstep(STALL, STALL + 10 * DEG, a);
  return attached * (1 - w) + plate * w;
}

/**
 * A symmetric foil's drag: skin friction plus induced drag, then a flat
 * plate's once stalled. Backwards its sharp trailing edge leads and its
 * blunt nose trails, which costs more.
 */
export function foilCD(alpha, cl, aspect, cd0 = 0.01) {
  const a = alpha > HALF_PI ? Math.PI - alpha : alpha;
  if (alpha > HALF_PI) cd0 *= 4;
  const attached = cd0 + (cl * cl) / (Math.PI * aspect * 0.9);
  const plate = cd0 + 1.2 * Math.sin(a) * Math.sin(a);
  const w = smoothstep(STALL, STALL + 10 * DEG, a);
  return attached * (1 - w) + plate * w;
}

export const SAIL_LUFF = 6 * DEG;
export const SAIL_PEAK = 22 * DEG;
export const SAIL_CL_MAX = 1.4;

/**
 * A cambered sail's lift: nothing while it luffs (the chord within 6° of
 * the wind, where the luff backs and the cloth won't hold its shape),
 * rising to 1.4 at 22°, then stalling gently to nothing square to the wind;
 * past that the wind is on its back.
 */
export function sailCL(alpha) {
  if (alpha <= SAIL_LUFF) return 0;
  if (alpha < SAIL_PEAK) {
    const s = (alpha - SAIL_LUFF) / (SAIL_PEAK - SAIL_LUFF);
    return SAIL_CL_MAX * s * (2 - s);
  }
  if (alpha <= HALF_PI) return SAIL_CL_MAX * Math.cos((HALF_PI * (alpha - SAIL_PEAK)) / (HALF_PI - SAIL_PEAK));
  return 0.6 * Math.sin(2 * alpha);
}

/**
 * A sail's drag: a little for the cloth, more while it luffs and flogs, the
 * induced drag of its lift, and separation as it stalls, so square to the
 * wind it is a 1.2 drag coefficient and never nothing.
 */
export function sailCD(alpha, cl, aspect) {
  const s = Math.sin(alpha);
  const flogging = 0.12 * (1 - smoothstep(0, 10 * DEG, alpha));
  return 0.04 + flogging + (cl * cl) / (Math.PI * aspect * 0.85) + 1.15 * s * s * smoothstep(10 * DEG, 50 * DEG, alpha);
}
