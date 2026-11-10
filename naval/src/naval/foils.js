// Keel and rudder: from a planform to the numbers balance, stability, the
// VPP (design.js, vpp.js) and the contract need. Pure, no DOM.
//
// Frame: the rig frame seen from starboard, points [x, z] (x forward, z up,
// metres, the floated waterplane at z = 0). A foil hangs straight down from
// its root, which is a horizontal chord at the canoe body's underside:
//
//   rootLE = [stemX − aftOfStem, rootZ]          rootTE = rootLE − [rootChord, 0]
//   tipLE  = rootLE + [−span·tan(sweep), −span]   tipTE  = tipLE − [tipChord, 0]
//
// `sweepDeg` is the leading edge's sweep, + = the tip aft. `tc` is the
// section's thickness/chord.
//
// What this module states (and the contract spec will repeat):
// - Effective aspect ratio. A foil whose root meets the hull below the
//   waterline has the hull as an end plate: it acts as a wing of twice its
//   span (its mirror image), AR_eff = 2·b²/S. A rudder hung on a transom (or
//   a kick-up), whose root is at the surface, gets no end-plate credit:
//   AR_eff = b²/S. Heel: ASSUMPTION, the end-plate credit fades as cos²φ,
//   AR_eff(φ) = (b²/S)·(1 + (k − 1)·cos²φ), so a hull on its side is no end
//   plate. To check against the DSYHS effective-draft regression T_e(φ) in
//   the resistance step. A gap between root and hull isn't modelled.
// - Lift slope: Helmbold's equation with the DATCOM sweep term (Hoerner &
//   Borst, Fluid-Dynamic Lift, 1975; USAF DATCOM §4.1.3.2, β = κ = 1):
//     a = 2π·A / (2 + √(A²·(1 + tan²Λ½) + 4))   per radian,
//   A = AR_eff and Λ½ the half-chord sweep, tan Λ½ = tan Λ_LE − (c_r − c_t)/(2b).
// - Stall: 15° for every foil (the plan's stated figure for NACA 00xx-like
//   sections at yacht Reynolds numbers); CL_max = a·15°.
// - Profile drag: Hoerner's thickness form factor on ITTC-57 friction,
//   cd0 = 2·Cf·(1 + 2·t/c + 60·(t/c)⁴), Cf = 0.075/(log₁₀Re − 2)², Re on the MAC.
// - Downwash of the keel on the rudder: ε = CL_k/(π·AR_k,eff) (the induced
//   angle at the keel; far downstream it would be twice this), so
//   dε/dα = a_k/(π·AR_k,eff).
// - Volume: NACA 4-digit symmetric section, area 0.685·t·c² with its
//   centroid 0.420·c aft of the leading edge (both integrated from the NACA
//   00xx thickness formula). A bulb is a prolate spheroid of its length and
//   diameter, volume π/6·D²·L, its axis D/2 below the tip chord and its
//   centre under the tip's quarter chord.

import { polygonArea, polygonCentroid } from "./sailplan.js";
import { RHO_SEA } from "./units.js";

export const KEEL_KINDS = ["fin", "fin-bulb", "centreboard", "daggerboard", "long", "none"];
export const RUDDER_KINDS = ["spade", "skeg", "transom-hung", "kick-up"];
export const KEEL_KIND_LABELS = { fin: "Fin", "fin-bulb": "Fin and bulb", centreboard: "Centreboard", daggerboard: "Daggerboard", long: "Long keel", none: "None" };
export const RUDDER_KIND_LABELS = { spade: "Spade", skeg: "On a skeg", "transom-hung": "Transom-hung", "kick-up": "Kick-up (transom)" };

/** NACA 00xx: section area / (t·c), and its centroid from the leading edge / c. */
export const NACA_AREA = 0.685;
export const NACA_CENTROID = 0.42;
export const STALL_DEG = 15;
/** ITTC (1978) sea water at 15 °C, m²/s. */
export const NU_SEA = 1.18831e-6;
/** A bulb's volume over its circumscribing cylinder's: a prolate spheroid's, 2/3. */
export const BULB_CP = 2 / 3;
/** Structure of a non-ballast foil (rudder, centreboard, daggerboard): GRP on a foam or wood core. Estimated. */
export const FOIL_DENSITY = 1100;

const RAD = Math.PI / 180;
const pos = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Helmbold with the DATCOM sweep term. A = effective AR (full-wing), sweep = half-chord sweep in degrees. */
export function liftSlope(A, sweepHalfDeg = 0) {
  if (!(A > 0)) return 0;
  const t = Math.tan(sweepHalfDeg * RAD);
  return (2 * Math.PI * A) / (2 + Math.sqrt(A * A * (1 + t * t) + 4));
}

/** ITTC-57 friction line. */
export const ittc57 = (re) => (re > 1e3 ? 0.075 / (Math.log10(re) - 2) ** 2 : NaN);

/** Hoerner's profile drag of a section of thickness/chord tc at Reynolds number re. */
export const sectionCd0 = (tc, re) => 2 * ittc57(re) * (1 + 2 * tc + 60 * tc ** 4);

/** The keel's induced angle at a lift coefficient (rad): the downwash the rudder sees. */
export const downwash = (clKeel, arEffKeel) => (arEffKeel > 0 ? clKeel / (Math.PI * arEffKeel) : 0);

/** Trapezoid planform numbers for root chord cr, tip chord ct, span b. */
export function trapezoid(cr, ct, b) {
  const area = (b * (cr + ct)) / 2;
  const lam = cr > 0 ? ct / cr : 0;
  const mac = cr > 0 ? ((2 / 3) * cr * (1 + lam + lam * lam)) / (1 + lam) : 0;
  const macFromRoot = cr + ct > 0 ? (b / 3) * ((cr + 2 * ct) / (cr + ct)) : 0;
  return { area, taper: lam, mac, macFromRoot, arGeom: area > 0 ? (b * b) / area : 0 };
}

/** Simpson's rule on [0, b] (exact for the cubics below with any even n). */
function simpson(f, b, n = 8) {
  const h = b / n;
  let s = f(0) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(i * h);
  return (s * h) / 3;
}

/** Volume of a foil of NACA 00xx sections and the [x, z] of its centroid. */
function foilVolume(rootLE, cr, ct, b, tanLE, tc) {
  const c = (s) => cr + ((ct - cr) * s) / b;
  const V = NACA_AREA * tc * simpson((s) => c(s) ** 2, b);
  if (!(V > 0)) return { volumeM3: 0, centroid: null };
  const Mx = NACA_AREA * tc * simpson((s) => c(s) ** 2 * (rootLE[0] - s * tanLE - NACA_CENTROID * c(s)), b);
  const Mz = NACA_AREA * tc * simpson((s) => c(s) ** 2 * (rootLE[1] - s), b);
  return { volumeM3: V, centroid: [Mx / V, Mz / V] };
}

/**
 * A foil's geometry and coefficients.
 * @param {{ kind: string, aftOfStem: number, span: number, rootChord: number, tipChord: number, sweepDeg: number, tc: number,
 *           bulb?: { length: number, diameter: number } | null }} f the doc's appendage
 * @param {{ id: "keel"|"rudder", stemX: number, rootZ: number, endPlate: boolean, heelDeg?: number }} at
 */
export function foilOf(f, { id, stemX, rootZ, endPlate, heelDeg = 0 }) {
  const b = pos(f.span);
  const cr = pos(f.rootChord);
  const ct = pos(f.tipChord);
  const sweepDeg = num(f.sweepDeg);
  const tanLE = Math.tan(sweepDeg * RAD);
  const tc = pos(f.tc);
  const rootLE = [stemX - num(f.aftOfStem), rootZ];
  const rootTE = [rootLE[0] - cr, rootZ];
  const tipLE = [rootLE[0] - b * tanLE, rootZ - b];
  const tipTE = [tipLE[0] - ct, rootZ - b];
  const polygon = [rootLE, rootTE, tipTE, tipLE];
  const t = trapezoid(cr, ct, b);
  const ok = t.area > 0;
  const k = endPlate ? 2 : 1;
  const cos2 = Math.cos(heelDeg * RAD) ** 2;
  const arEff = t.arGeom * (1 + (k - 1) * cos2);
  const tanHalf = b > 0 ? tanLE - (cr - ct) / (2 * b) : 0;
  const sweepHalfDeg = Math.atan(tanHalf) / RAD;
  const slope = liftSlope(arEff, sweepHalfDeg);
  // the MAC's quarter-chord point: where the foil's lift acts
  const macLE = [rootLE[0] - t.macFromRoot * tanLE, rootZ - t.macFromRoot];
  const qc = [macLE[0] - t.mac / 4, macLE[1]];
  const vol = foilVolume(rootLE, cr, ct, b, tanLE, tc);
  let bulb = null;
  if (f.kind === "fin-bulb" && f.bulb && pos(f.bulb.length) > 0 && pos(f.bulb.diameter) > 0) {
    const L = f.bulb.length;
    const D = f.bulb.diameter;
    const centre = [tipLE[0] - ct / 4, tipLE[1] - D / 2];
    bulb = {
      length: L,
      diameter: D,
      centre,
      volumeM3: bulbVolume(L, D),
      lateralAreaM2: (Math.PI / 4) * L * D, // its side view, an ellipse
      bottomZ: centre[1] - D / 2,
      nose: [centre[0] + L / 2, centre[1]],
      tail: [centre[0] - L / 2, centre[1]],
    };
  }
  const bottomZ = Math.min(tipLE[1], bulb ? bulb.bottomZ : Infinity);
  return {
    id,
    kind: f.kind,
    ok,
    polygon,
    corners: { rootLE, rootTE, tipLE, tipTE },
    rootZ,
    span: b,
    rootChord: cr,
    tipChord: ct,
    sweepDeg,
    sweepHalfDeg,
    tc,
    areaM2: Math.abs(polygonArea(polygon)),
    centroid: ok ? polygonCentroid(polygon) : rootLE,
    mac: t.mac,
    macFromRoot: t.macFromRoot,
    taper: t.taper,
    qc,
    arGeom: t.arGeom,
    endPlate,
    endPlateFactor: k,
    heelDeg,
    arEff,
    liftSlope: slope,
    stallDeg: STALL_DEG,
    clMax: slope * STALL_DEG * RAD,
    volumeM3: vol.volumeM3,
    volumeCentroid: vol.centroid,
    bulb,
    bottomZ,
  };
}

/** The foil's effective AR and lift slope at a heel (the end-plate credit fading as cos²φ). */
export function atHeel(foil, heelDeg) {
  const arEff = foil.arGeom * (1 + (foil.endPlateFactor - 1) * Math.cos(heelDeg * RAD) ** 2);
  return { arEff, liftSlope: liftSlope(arEff, foil.sweepHalfDeg) };
}

/** Profile drag coefficient at a speed (m/s), on the MAC. */
export function cd0At(foil, speedMs, nu = NU_SEA) {
  return sectionCd0(foil.tc, (speedMs * foil.mac) / nu);
}

/** Volume of a bulb of length L and diameter D, as a body of prismatic coefficient cp (a spheroid by default). */
export const bulbVolume = (L, D, cp = BULB_CP) => cp * (Math.PI / 4) * D * D * L;

/**
 * Where a foil's root meets the hull, and whether the hull is its end plate.
 * The root is at the canoe body's underside at the root's quarter chord; a
 * transom-hung or kick-up rudder, or a foil whose root falls where the hull
 * isn't immersed, hangs from the waterline with no end plate.
 * @param {(x: number) => number|null} hullBottomAt the canoe body's lowest z at x (null off the hull)
 */
export function rootOf(f, { stemX, hullBottomAt, id }) {
  const xq = stemX - num(f.aftOfStem) - pos(f.rootChord) / 4;
  const z = hullBottomAt ? hullBottomAt(xq) : null;
  const hung = id === "rudder" && (f.kind === "transom-hung" || f.kind === "kick-up");
  if (hung || z == null || !(z < -1e-3)) return { rootZ: 0, endPlate: false, why: hung ? "hung on the transom" : "the hull isn't immersed above it" };
  return { rootZ: z, endPlate: true };
}

/**
 * Both appendages for a doc and a hull.
 * @param {object} app the doc's `appendages`
 * @param {{ stemX: number, hullBottomAt: (x: number) => number|null }} hull
 */
export function appendagesOf(app, hull) {
  const out = { keel: null, rudder: null, volumeM3: 0, volumeCentroid: null, foils: [] };
  for (const id of ["keel", "rudder"]) {
    const f = app?.[id];
    if (!f || f.kind === "none") continue;
    const r = rootOf(f, { ...hull, id });
    const foil = foilOf(f, { id, stemX: hull.stemX, rootZ: r.rootZ, endPlate: r.endPlate });
    if (!foil.ok) continue;
    foil.rootNote = r.why ?? null;
    out[id] = foil;
    out.foils.push(foil);
  }
  // the buoyancy the canoe body's table leaves out
  let V = 0, X = 0, Z = 0;
  for (const f of out.foils) {
    for (const [v, c] of [[f.volumeM3, f.volumeCentroid], [f.bulb?.volumeM3, f.bulb?.centre]])
      if (v > 0 && c) {
        V += v;
        X += v * c[0];
        Z += v * c[1];
      }
  }
  out.volumeM3 = V;
  out.volumeCentroid = V > 0 ? [X / V, Z / V] : null;
  out.buoyancyKg = V * RHO_SEA;
  return out;
}
