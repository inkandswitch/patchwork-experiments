// A rig contract's sails as the physics flies them (§6.2–6.3, DESIGN.md
// "The rig contract"): each its own foil, swinging about its own luff, with
// its own area, centre of effort and lift slope for how far the main is
// reefed and the jib furled. Geometry only, in sailing's body frame (x
// starboard, y up, z aft); physics.js does the air. Pure.
//
// - The main swings about its gooseneck (its tack), the boom's angle; a jib
//   or staysail about its tack, its sheet pulling the clew toward the lead,
//   no closer than its least sheeting angle (`sheeting.minDeg`: the lead
//   is on that line from the tack, §3.9). Each turns about its luff, tack
//   to head, so the head stays on the mast or the stay; its CE turns with it.
// - Reefing the main by a fraction f of P (the halyard part-lowered is the
//   same thing): the sail above the line f·P up the luff, parallel to the
//   boom, is brought down by f·P along the luff (the rig aid's sailplan.js:
//   the contract's own reefs are this at their fractions). Its area, CE and
//   luff (so its aspect ratio and lift slope) change; its coefficients don't.
// - Furling a headsail by a fraction of LP: the clew slides toward the luff
//   along the LP line (the rig aid's furledClew), the luff unchanged.

import { liftSlope } from "./physics-foils.js";

const EPS = 1e-9;

/** Polygon area and centroid in the sail's plane: (z, y) shoelace, x carried as the mean. */
export function areaCentroid(poly) {
  let a = 0, cy = 0, cz = 0, x = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const c = p[2] * q[1] - q[2] * p[1];
    a += c;
    cz += (p[2] + q[2]) * c;
    cy += (p[1] + q[1]) * c;
    x += p[0];
  }
  if (Math.abs(a) < 1e-12) return { area: 0, ce: [x / Math.max(1, n), 0, 0] };
  return { area: Math.abs(a / 2), ce: [x / n, cy / (3 * a), cz / (3 * a)] };
}

/** The part of a polygon at or above body height y (Sutherland–Hodgman, one edge). */
function clipAbove(poly, y) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const pin = p[1] >= y, qin = q[1] >= y;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (y - p[1]) / (q[1] - p[1]);
      out.push([p[0] + t * (q[0] - p[0]), y, p[2] + t * (q[2] - p[2])]);
    }
  }
  return out;
}

/**
 * The main reefed by `f` (a fraction of its luff, 0 none): polygon, area,
 * CE and luff. The contract's own figures when unreefed.
 */
export function reefed(sail, f) {
  if (!(f > EPS)) return { polygon: sail.polygonM, area: sail.areaM2, ce: sail.ceM, luff: sail.luffM };
  if (f >= 1 - EPS) return { polygon: [], area: 0, ce: sail.tackM, luff: 0 };
  const t = sail.tackM, h = sail.headM;
  const cut = t[1] + f * (h[1] - t[1]);
  const dx = -f * (h[0] - t[0]), dy = -f * (h[1] - t[1]), dz = -f * (h[2] - t[2]);
  const polygon = clipAbove(sail.polygonM, cut).map((p) => [p[0] + dx, p[1] + dy, p[2] + dz]);
  const { area, ce } = areaCentroid(polygon);
  return { polygon, area, ce, luff: sail.luffM * (1 - f) };
}

/** A headsail's clew rolled to `furl` (a fraction of LP): toward the luff, along the LP line. */
export function furledClew(sail, furl) {
  const t = sail.tackM, h = sail.headM, c = sail.clewM;
  const l = [h[0] - t[0], h[1] - t[1], h[2] - t[2]];
  const ll = l[0] * l[0] + l[1] * l[1] + l[2] * l[2] || 1;
  const s = ((c[0] - t[0]) * l[0] + (c[1] - t[1]) * l[1] + (c[2] - t[2]) * l[2]) / ll;
  const foot = [t[0] + s * l[0], t[1] + s * l[1], t[2] + s * l[2]];
  return [foot[0] + (c[0] - foot[0]) * (1 - furl), foot[1] + (c[1] - foot[1]) * (1 - furl), foot[2] + (c[2] - foot[2]) * (1 - furl)];
}

/**
 * A headsail furled by `furl` (0 none): polygon, area, CE and luff. Its
 * polygon's clew (the corner nearest `clewM`) moves; the contract's own
 * figures when unfurled.
 */
export function furled(sail, furl) {
  if (!(furl > EPS)) return { polygon: sail.polygonM, area: sail.areaM2, ce: sail.ceM, luff: sail.luffM };
  if (furl >= 1 - EPS) return { polygon: [], area: 0, ce: sail.tackM, luff: sail.luffM };
  const c = sail.clewM;
  let k = 0, best = Infinity;
  sail.polygonM.forEach((p, i) => {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    if (d < best) [best, k] = [d, i];
  });
  const clew = furledClew(sail, furl);
  const polygon = sail.polygonM.map((p, i) => (i === k ? clew : p));
  const { area, ce } = areaCentroid(polygon);
  return { polygon, area, ce, luff: sail.luffM };
}

/** A sail's own aspect ratio (2·luff²/area: the deck's mirror) and Helmbold's lift slope on it. */
export const sailSlope = (luff, area) => (area > 0 ? liftSlope((2 * luff * luff) / area) : 0);

/**
 * The sails of a contract (spec.rig, in the body frame) as physics.js flies
 * them, or null when it states none. Each: its id, whether it's the main,
 * its family's constants (`model`), its sheeting range (radians: `min`,
 * `max`, and a headsail's goose-winged `wing`), its pivot (the tack) and
 * luff axis (unit, tack to head), and `shape(f)`: its area, CE, lift slope
 * at a reef or furl f, cached on the last f.
 */
export function rigSails(rig) {
  if (!rig || !Array.isArray(rig.sails) || !rig.sails.length || !Array.isArray(rig.sets) || !rig.sets.length) return null;
  const DEG = Math.PI / 180;
  const sm = rig.sailModel ?? {};
  const sails = rig.sails
    .filter((s) => s.areaM2 > 0 && Array.isArray(s.polygonM) && s.polygonM.length >= 3)
    .map((s) => {
      const main = (s.model?.family ?? s.kind) === "main";
      const t = s.tackM, h = s.headM;
      const ul = Math.hypot(h[0] - t[0], h[1] - t[1], h[2] - t[2]) || 1;
      const sh = s.sheeting ?? {};
      const range = s.model?.sheet ?? [0, 85];
      const wing = !main && sh.wing ? { from: sh.wing.fromBeta, lo: Math.abs(sh.wing.sheet[1]) * DEG, hi: Math.abs(sh.wing.sheet[0]) * DEG, q: sh.wing.qFactor } : null;
      let lastF = NaN, cur = null;
      return {
        id: s.id,
        main,
        model: s.model,
        source: s,
        min: (Number.isFinite(sh.minDeg) ? sh.minDeg : range[0]) * DEG,
        max: (Number.isFinite(sh.maxDeg) ? sh.maxDeg : range[1]) * DEG,
        // backed (held to windward, pressed by its air against its sheet) its head can't twist open past the
        // shrouds as an eased one's does: its sheet's travel there is the family's (§6.2), within its own
        backMax: Math.min(Number.isFinite(sh.maxDeg) ? sh.maxDeg : range[1], range[1]) * DEG,
        wing,
        pivot: t,
        axis: [(h[0] - t[0]) / ul, (h[1] - t[1]) / ul, (h[2] - t[2]) / ul],
        furl: main ? 0 : (s.furl ?? 0),
        shape(f) {
          if (f === lastF) return cur;
          lastF = f;
          const g = main ? reefed(s, f) : furled(s, f);
          const full = !(f > EPS);
          cur = { area: g.area, ce: g.ce, luff: g.luff, slope: full && Number.isFinite(s.liftSlope) ? s.liftSlope : sailSlope(g.luff, g.area) };
          return cur;
        },
      };
    });
  if (!sails.length) return null;
  const it = sm.interaction ?? {};
  return {
    sails,
    main: sails.find((s) => s.main) ?? null,
    heads: sails.filter((s) => !s.main),
    rho: sm.rhoAirKgM3 ?? 1.225,
    cnExp: sm.cnExp ?? 0.3,
    flatMin: sm.flatMin ?? 0.5,
    kInt: it.kIntDeg ?? 4,
    upwash: it.upwash ?? [30, 90],
    blanket: it.blanket ?? { max: 0.35, from: 90, to: 160 },
    // the rig's effective span (§6.3), the same in every set: ARe = h_e²/A for the area set
    he: rig.sets[0].heM,
  };
}

/**
 * Where a sail's CE is when it has swung θ (radians, + to starboard) about
 * its luff, into out (body frame): pivot + c∥ + c⊥·cos θ + (u × c⊥)·sin θ,
 * c the CE from the pivot, u the luff.
 */
export function swungCE(out, sail, ce, theta) {
  const p = sail.pivot, u = sail.axis;
  const rx = ce[0] - p[0], ry = ce[1] - p[1], rz = ce[2] - p[2];
  const d = rx * u[0] + ry * u[1] + rz * u[2];
  const px = rx - d * u[0], py = ry - d * u[1], pz = rz - d * u[2];
  const wx = u[1] * pz - u[2] * py, wy = u[2] * px - u[0] * pz, wz = u[0] * py - u[1] * px;
  const c = Math.cos(theta), s = Math.sin(theta);
  out[0] = p[0] + d * u[0] + px * c + wx * s;
  out[1] = p[1] + d * u[1] + py * c + wy * s;
  out[2] = p[2] + d * u[2] + pz * c + wz * s;
  return out;
}
