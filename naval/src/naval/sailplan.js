// The sail plan: from a rig's ISO 8666 / ORC dimensions to sail polygons,
// areas and centres of effort, in the hull's profile plane. Pure, no DOM.
//
// Frame: the hull's Chartroom frame seen from starboard, points as [x, z]
// (x forward, z up, metres); every sail lies on the centreplane (y = 0).
// The rig is placed by a datum the hull supplies:
//   stemX, stemZ  the stemhead (forward end of the sheer)
//   sheerZ        the sheer height at the mast (defaults to stemZ)
//   sternX, sternZ  optional: where the backstay lands
//
// Vocabulary (ISO 8666; ORC Rating Systems):
//   I    height of the forestay's attachment on the mast above the sheer
//   J    foretriangle base: forestay tack to the front of the mast, at the sheer
//   P    main luff, from the top of the boom to the head
//   E    main foot, along the boom from the mast
//   BAS  boom above sheer, at the gooseneck
//   ISP  spinnaker halyard height (defaults to the mast top)
//   LP   headsail luff perpendicular: shortest distance from the clew to the luff
//
// Conventions this module states (and the contract spec will repeat):
// - The mast is placed by `mast.aftOfStem`, its front at the sheer (the
//   partners). J is derived: mast.aftOfStem − forestayAftOfStem. Typing J
//   moves the mast; a bowsprit is a negative forestayAftOfStem.
// - Heights on the mast (I, BAS, BAS + P, ISP) are measured ALONG the mast
//   from the partners. Rake (degrees, + = head aft) turns the mast about the
//   partners, so a point h up the mast moves aft by h·sin(rake).
// - The boom stays horizontal under rake (the gooseneck rides the mast; the
//   vang holds the boom level). So the main's CE moves aft by exactly its
//   height above the partners × sin(rake).
// - The forestay tack is at the stemhead's height (or at the sheer for a tack
//   aft of the stem on a flat sheer); a headsail is hoisted to the hounds.
// - Two sail-area conventions:
//     designer's: ½·P·E + ½·I·J (main triangle + 100% foretriangle), the
//       basis of SA/D and lead tables;
//     actual: the main with its roach, the headsail by LP, the staysail.
//   Rule areas use the formulas; CEs are the polygon centroids.
// - Roach is a fraction of the main's triangle: actual main = triangle·(1+roach),
//   carried as a parabolic bulge on the leech.
// - A reef r lowers the head by r·P: the sail above a line r·P up the luff,
//   parallel to the boom, brought down to the boom. A triangle keeps (1−r)².

/** @typedef {[number, number]} P2 */

export const RIG_TYPES = ["masthead", "fractional", "cat", "cutter"];
export const RIG_TYPE_LABELS = {
  masthead: "Masthead sloop",
  fractional: "Fractional sloop",
  cat: "Cat (una)",
  cutter: "Cutter",
};
export const HEADSAIL_KINDS = ["jib", "genoa", "self-tacking"];
/** Default clew height above the tack, as a fraction of I, when none is given (estimated). */
export const CLEW_HEIGHT_FRAC = { genoa: 0.05, jib: 0.1, "self-tacking": 0.12, staysail: 0.1 };
const ROACH_SEGMENTS = 8;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

/** Signed area (counter-clockwise positive) of a simple polygon. */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += cross(poly[i], poly[(i + 1) % poly.length]);
  return a / 2;
}

/** Centroid of a simple polygon (either winding). */
export function polygonCentroid(poly) {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = cross(p, q);
    a += c;
    cx += (p[0] + q[0]) * c;
    cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-12) {
    // degenerate: the vertex mean
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

/** Area-weighted centroid of parts [{ areaM2, ce }]. */
export function combineCE(parts) {
  let a = 0;
  let x = 0;
  let z = 0;
  for (const p of parts) {
    if (!p || !(p.areaM2 > 0)) continue;
    a += p.areaM2;
    x += p.areaM2 * p.ce[0];
    z += p.areaM2 * p.ce[1];
  }
  return a > 0 ? { areaM2: a, ce: [x / a, z / a] } : { areaM2: 0, ce: null };
}

/** The part of a polygon on or above the horizontal line z = z0 (Sutherland–Hodgman). */
export function clipAbove(poly, z0) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pin = p[1] >= z0;
    const qin = q[1] >= z0;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (z0 - p[1]) / (q[1] - p[1]);
      out.push([p[0] + t * (q[0] - p[0]), z0]);
    }
  }
  return out;
}

const pos = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Does this rig type carry a forestay and headsail? */
export const hasForetriangle = (type) => type !== "cat";

/** J, derived from the mast's and the forestay's positions aft of the stem. */
/** A jib's (or self-tacker's) LP above this % of J is flagged: it overlaps the mast like a genoa. */
export const JIB_LP_MAX = 115;

export function jOf(rig) {
  if (!hasForetriangle(rig?.type)) return 0;
  return num(rig?.mast?.aftOfStem) - num(rig?.forestayAftOfStem);
}

/**
 * The clew of a triangular headsail: on the aft side of the luff tack→head,
 * LP from it, at height clewZ.
 */
function clewFor(tack, head, LP, clewZ) {
  const L = len(sub(head, tack));
  if (!(L > 0)) return tack;
  const d = mul(sub(head, tack), 1 / L);
  // the normal on the aft side (x forward, so aft is −x)
  let n = [-d[1], d[0]];
  if (n[0] > 0) n = mul(n, -1);
  const base = add(tack, mul(n, LP));
  if (Math.abs(d[1]) < 1e-9) return base;
  const t = (clewZ - base[1]) / d[1];
  return add(base, mul(d, t));
}

/** The leech of the main from head to clew, bulged outward by `bulgeArea` as a parabola. */
function roachedLeech(head, clew, tack, bulgeArea) {
  const chord = sub(clew, head);
  const L = len(chord);
  if (!(bulgeArea > 0) || !(L > 0)) return [head, clew];
  const n0 = [-chord[1] / L, chord[0] / L];
  // outward: away from the tack
  const n = cross(chord, sub(tack, head)) > 0 ? mul(n0, -1) : n0;
  const N = ROACH_SEGMENTS;
  // an N-chord polygon inscribed in a parabola of height h holds (2/3)·L·h·(1 − 1/N²)
  const h = bulgeArea / ((2 / 3) * L * (1 - 1 / (N * N)));
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    pts.push(add(add(head, mul(chord, t)), mul(n, 4 * h * t * (1 - t))));
  }
  return pts;
}

function sail(id, kind, polygon, extra = {}) {
  const areaM2 = Math.abs(polygonArea(polygon));
  return { id, kind, polygon, areaM2, ce: polygonCentroid(polygon), ...extra };
}

/**
 * Lay out a rig.
 * @param {object} rig the doc's `rig`
 * @param {{ stemX?: number, stemZ?: number, sheerZ?: number, sternX?: number, sternZ?: number }} [datum]
 */
export function buildSailPlan(rig, datum = {}) {
  const type = RIG_TYPES.includes(rig?.type) ? rig.type : "masthead";
  const warnings = [];
  const stemX = num(datum.stemX);
  const stemZ = num(datum.stemZ);
  const sheerZ = num(datum.sheerZ, stemZ);
  const rakeDeg = num(rig?.mast?.rakeDeg);
  const th = (rakeDeg * Math.PI) / 180;
  const u = [-Math.sin(th), Math.cos(th)];

  const aftOfStem = num(rig?.mast?.aftOfStem);
  const partners = [stemX - aftOfStem, sheerZ];
  const along = (h) => add(partners, mul(u, h));
  // how far up the mast the level line through p meets it: points on the main
  // are partners + h·u + (−a, 0) (the boom is level), so h = Δz / cos(rake)
  const heightAbove = (p) => (p[1] - partners[1]) / Math.cos(th);

  const ft = hasForetriangle(type);
  const I = ft ? pos(rig?.I) : 0;
  const P = pos(rig?.P);
  const E = pos(rig?.E);
  const BAS = Math.max(0, num(rig?.BAS));
  const J = ft ? jOf(rig) : 0;
  const ISP = Number.isFinite(rig?.ISP) && rig.ISP > 0 ? rig.ISP : null;
  const mastHeight = Math.max(I, BAS + P, ISP ?? 0);

  if (!(P > 0 && E > 0)) warnings.push("P and E must both be more than zero to make a main.");
  if (ft && !(I > 0)) warnings.push("I must be more than zero to make a foretriangle.");
  if (ft && !(J > 0)) warnings.push("The forestay tack must be forward of the mast (J > 0).");
  const tol = 0.02 * mastHeight;
  if (type === "masthead" && I > 0 && I < BAS + P - tol)
    warnings.push("I is below the head of the main: the forestay meets the mast below the top, which is a fractional rig.");
  if (type === "fractional" && I >= BAS + P - tol && I > 0)
    warnings.push("I reaches the head of the main: that is a masthead rig.");

  // --- mast, boom, stays
  const masthead = along(mastHeight);
  const gooseneck = along(BAS);
  const boomEnd = add(gooseneck, [-E, 0]);
  const forestayTack = ft ? [stemX - num(rig?.forestayAftOfStem), stemZ] : null;
  const hounds = ft ? along(I) : null;
  const stern = Number.isFinite(datum.sternX) ? [datum.sternX, num(datum.sternZ, sheerZ)] : null;

  // --- main: triangle × (1 + roach), reefs
  const head = along(BAS + P);
  const clew = boomEnd;
  const triangle = [gooseneck, head, clew];
  const triArea = Math.abs(polygonArea(triangle));
  const roach = Math.max(0, num(rig?.main?.roach));
  const leech = roachedLeech(head, clew, gooseneck, roach * triArea);
  const mainPoly = [gooseneck, ...leech];
  const reefs = (Array.isArray(rig?.main?.reefs) ? rig.main.reefs : [])
    .filter((r) => Number.isFinite(r) && r > 0 && r < 1)
    .map((r) => {
      const cut = add(partners, mul(u, BAS + r * P));
      const drop = mul(u, -r * P);
      const poly = clipAbove(mainPoly, cut[1]).map((p) => add(p, drop));
      const s = sail("main", "main", poly);
      return { fraction: r, polygon: poly, areaM2: s.areaM2, ce: s.ce };
    });
  const main =
    P > 0 && E > 0
      ? sail("main", "main", mainPoly, {
          luffM: P,
          footM: E,
          roach,
          triangle: { polygon: triangle, areaM2: triArea, ce: polygonCentroid(triangle) },
          ceAbovePartnersM: 0,
          reefs,
        })
      : null;
  if (main) main.ceAbovePartnersM = heightAbove(main.ce);

  // --- headsail and staysail
  const sails = main ? [main] : [];
  let foretriangle = null;
  const estimated = [];
  if (ft && I > 0 && J > 0) {
    const ftPoly = [forestayTack, hounds, partners];
    foretriangle = sail("foretriangle", "foretriangle", ftPoly);
    const hs = rig?.headsail;
    if (hs && pos(hs.LP) > 0) {
      const kind = HEADSAIL_KINDS.includes(hs.kind) ? hs.kind : "jib";
      let clewH = hs.clewHeight;
      if (!(Number.isFinite(clewH) && clewH >= 0)) {
        clewH = CLEW_HEIGHT_FRAC[kind] * I;
        estimated.push("headsail clew height");
      }
      const hsClew = clewFor(forestayTack, hounds, hs.LP, forestayTack[1] + clewH);
      const luffM = len(sub(hounds, forestayTack));
      sails.push(
        sail("jib", kind, [forestayTack, hounds, hsClew], {
          luffM,
          footM: len(sub(hsClew, forestayTack)),
          LP: hs.LP,
          lpPercent: (hs.LP / J) * 100,
          clewHeightM: clewH,
        }),
      );
    }
    const jibNow = sails.find((x) => x.id === "jib");
    // a jib is a non-overlapping sail: LP about 100% of J or less (a genoa overlaps the mast)
    if (jibNow && (jibNow.kind === "jib" || jibNow.kind === "self-tacking") && jibNow.lpPercent > JIB_LP_MAX)
      warnings.push(`The ${jibNow.kind === "self-tacking" ? "self-tacking jib" : "jib"}'s LP is ${Math.round(jibNow.lpPercent)}% of J: its clew is aft of the mast, so it overlaps like a genoa. Choose Genoa, or bring LP down toward 100%.`);
    const st = type === "cutter" ? rig?.staysail : null;
    if (type === "cutter" && !(st && pos(st.I2) > 0 && pos(st.J2) > 0 && pos(st.LP2) > 0))
      warnings.push("A cutter needs a staysail: give I2, J2 and LP2.");
    if (st && pos(st.I2) > 0 && pos(st.J2) > 0 && pos(st.LP2) > 0) {
      const tack2 = [partners[0] + st.J2, sheerZ];
      const head2 = along(st.I2);
      let clewH = st.clewHeight;
      if (!(Number.isFinite(clewH) && clewH >= 0)) {
        clewH = CLEW_HEIGHT_FRAC.staysail * st.I2;
        estimated.push("staysail clew height");
      }
      const clew2 = clewFor(tack2, head2, st.LP2, tack2[1] + clewH);
      sails.push(
        sail("staysail", "staysail", [tack2, head2, clew2], {
          luffM: len(sub(head2, tack2)),
          footM: len(sub(clew2, tack2)),
          LP: st.LP2,
          clewHeightM: clewH,
          stay: { tack: tack2, head: head2 },
        }),
      );
    }
  }

  // --- the two conventions
  const ruleMain = 0.5 * P * E;
  const ruleFT = ft ? 0.5 * I * J : 0;
  const designer = combineCE([
    main && { areaM2: ruleMain, ce: main.triangle.ce },
    foretriangle && { areaM2: ruleFT, ce: foretriangle.ce },
  ]);
  const actual = combineCE(sails);

  return {
    type,
    J,
    I,
    P,
    E,
    BAS,
    ISP,
    rakeDeg,
    mast: { partners, head: masthead, heightM: mastHeight, aboveDatumZ: masthead[1] },
    boom: main ? { gooseneck, end: boomEnd } : null,
    forestay: ft && I > 0 ? { tack: forestayTack, head: hounds } : null,
    backstay: stern ? { from: masthead, to: stern } : null,
    foretriangle,
    sails,
    rule: { mainM2: ruleMain, foretriangleM2: ruleFT, totalM2: ruleMain + ruleFT },
    designer: { areaM2: ruleMain + ruleFT, ce: designer.ce },
    actual: { areaM2: actual.areaM2, ce: actual.ce },
    estimated,
    warnings,
  };
}
