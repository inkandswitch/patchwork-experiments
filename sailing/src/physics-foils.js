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

// ─── foils from a planform (the rig contract's §6.4) ────────────────────
// Only a ship whose rig carries the contract (spec.rig) flies these; the
// functions above stay what every other ship flies.

/**
 * A planform's effective aspect ratio at heel (§6.4): the hull is an end
 * plate (k = 2) that works less as she heels, AR_geom·(1 + (k − 1)·cos²φ).
 */
export function planformAspect(arGeom, endPlate, cosHeel) {
  return arGeom * (1 + (endPlate - 1) * cosHeel * cosHeel);
}

/** Helmbold's lift slope (per radian) with the half-chord sweep: `secHalf2` is 1 + tan²Λ½. */
export function planformSlope(aspect, secHalf2 = 1) {
  return aspect > 0 ? (2 * Math.PI * aspect) / (2 + Math.sqrt(aspect * aspect * secHalf2 + 4)) : 0;
}

/**
 * A planform foil's lift at α (0..π, as foilCL's): the contract's
 * a·α / (1 + (a·α/CLmax)⁸)^⅛ with CLmax = a·stall up to its stall, so
 * wherever the aid's predictions are (unstalled) it is §6.4 exactly; past
 * the stall it goes over 10° to a flat plate's, as foilCL does, because a
 * sim also meets a foil sideways or backwards. Not above what it had at the
 * stall, though: a stubby keel's attached lift is less than a plate's, and
 * stalling mustn't add to it (§6.4: past the stall CL saturates).
 */
export function planformCL(alpha, slope, stall = STALL) {
  const a = alpha > HALF_PI ? Math.PI - alpha : alpha;
  const lin = slope * a;
  const clMax = slope * stall;
  const attached = clMax > 0 ? lin / Math.pow(1 + Math.pow(lin / clMax, 8), 0.125) : 0;
  if (a <= stall) return attached;
  const atStall = clMax / 1.0905077326652577; // 2^⅛: the curve's value at the stall
  const plate = Math.min(atStall, 0.8 * Math.sin(2 * a));
  const w = smoothstep(stall, stall + 10 * DEG, a);
  return attached * (1 - w) + plate * w;
}

/**
 * A planform foil's drag: its section's skin friction `cd0` (the contract's
 * appendage friction, 2·C_f·(1 + 2t/c + 60(t/c)⁴), at its chord's Reynolds
 * number) and its own induced drag at its effective aspect ratio; a flat
 * plate's once stalled; backwards costs more, as foilCD's.
 */
export function planformCD(alpha, cl, aspect, cd0, stall = STALL) {
  const a = alpha > HALF_PI ? Math.PI - alpha : alpha;
  if (alpha > HALF_PI) cd0 *= 4;
  const attached = cd0 + (aspect > 0 ? (cl * cl) / (Math.PI * aspect) : 0);
  if (a <= stall) return attached;
  const plate = cd0 + 1.2 * Math.sin(a) * Math.sin(a);
  const w = smoothstep(stall, stall + 10 * DEG, a);
  return attached * (1 - w) + plate * w;
}

/** ITTC '57's skin friction coefficient at a Reynolds number (held at 1e5 below it). */
export function ittc57(re) {
  const lg = Math.log10(re > 1e5 ? re : 1e5) - 2;
  return 0.075 / (lg * lg);
}

// ─── sails from the rig contract (§6.2) ─────────────────────────────────
// Only a ship whose rig contract states its sails (spec.rig.sails) flies
// these; sailCL and sailCD above stay what every other ship flies.

/** An angle in degrees, into (−180°, 180°]. */
export function wrap180(a) {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

/** The attached curve's saturation, x/(1 + x⁴)^¼: linear at small x, 1 at large. */
const sat = (x) => x / Math.pow(1 + x * x * x * x, 0.25);

/**
 * One sail's CL and CDv (§6.2), into out[0] and out[1]: `k` its family's
 * constants (`sails[].model`: alpha0, clMax, clBack, cdp, kv, stall, width,
 * cn90, ease; degrees), `slope` its lift slope per radian (Helmbold on
 * 2·luff²/area), `alphaDeg` the angle of attack, `sheetDeg` its sheeting
 * angle (the easing terms read |δ|), `cnExp` the separated normal force's
 * exponent (`sailModel.cnExp`). Unflattened, before any interaction (§6.3).
 * @param {Float64Array | number[]} out
 */
export function rigSailCoeffs(out, k, slope, alphaDeg, sheetDeg, cnExp = 0.3) {
  const al = wrap180(alphaDeg);
  const sh = Math.abs(sheetDeg);
  const e = k.ease;
  const es = e ? smoothstep(e.from, e.to, sh) : 0;
  const loss = e ? 1 - e.loss * es : 1;
  const clMax = k.clMax * loss, clBack = k.clBack * loss;
  const d = (al - k.alpha0) * DEG;
  const cla = d >= 0 ? clMax * sat((slope * d) / clMax) : -clBack * sat((slope * -d) / clBack);
  const a = al * DEG;
  const s = Math.abs(Math.sin(a));
  const cn = k.cn90 * Math.pow(s, cnExp);
  const cls = cn * Math.cos(a) * (a < 0 ? -1 : 1);
  const cds = cn * s;
  const sig = smoothstep(k.stall, k.stall + k.width, Math.abs(al - k.alpha0));
  out[0] = (1 - sig) * cla + sig * cls;
  out[1] = k.cdp + (k.kv * cla * cla + (e ? e.drag * es : 0)) * (1 - sig) + sig * cds;
  return out;
}
