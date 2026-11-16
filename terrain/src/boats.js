// Boats moored along a harbour's floats: dressing, not data. Nobody maps
// which boat is in which slip, so a float's slips are filled by hash of
// its OSM id and the slip's index (the same boats every build): a slip
// every 12 m along each side, about five in six taken (a place may fill
// some floats fuller: its look's `moored`; never two empty slips running),
// and where a place says along its fixed piers too, each a troller (a wheelhouse
// aft of amidships, two tall trolling poles raised in a V), a small seiner
// or crabber (the wheelhouse forward, a short mast and boom), an aluminium
// sportfisher or a cruising sailboat (a mast, a boom, on some a blue
// cover). A working boat is painted as the West Coast fleet is: most hulls
// navy, dark green, red, black or light blue, the rest white; the
// wheelhouse and its top always white or pale grey; red bottom paint with a
// white boot stripe over it; two to four orange buoys hung over her rail.
// Hulls rise to the bow. Sizes are typical of a West Coast small-craft
// harbour; everything here is an assumption, and the layer says so.
//
// Pure.

import { len, dsin, dcos } from "./detmath.js";
import { hashString } from "./buildings.js";
import { kindOf, KINDS } from "./structures.js";
import { soup, rgb, widen } from "./shapes.js";
import { insideRing } from "./terrain-sample.js";
import { quadOut, quadUp, triOut } from "./buildings.js";

/** A working boat's hull colours (most of the fleet: Ucluelet_Dock, the fish plant's), and how many hulls take one rather than white. */
export const WORKING = Object.freeze({
  hulls: Object.freeze(["#23324a", "#2f4a3c", "#8e2f27", "#1f2022", "#4f7ea0"]),
  painted: 0.6,
  white: "#f0f0ec",
  houses: Object.freeze(["#f0f0ec", "#d9dbd8"]),
  bottom: "#7a2a24",
  stripe: "#ecebe6",
  buoy: "#e0482e",
  buoys: Object.freeze([2, 4]),
});
/**
 * What a boat shows from above (art direction, the harbour photographs'
 * general look): a working boat's deck painted green-grey, or tan on about
 * 30% (by her hash), inside a 0.7 m bulwark whose inner face is her hull's
 * colour; every boat's gunwale capped with a white rail, so each has a crisp
 * rim against the floats (structures.js: wet timber, darker than any deck);
 * a sailboat's deck pale with a dark cockpit well; any other's glassfibre
 * white-grey. `rail` is the cap rail's width (m), `gap` the water between a
 * boat and her float or pier (m), `clear` how far a boat's footprint keeps
 * off any other float, pier or wall (m).
 */
export const DECKS = Object.freeze({ working: Object.freeze(["#7a887c", "#a08c69"]), tan: 0.3, sailboat: "#d9d6cc", cockpit: "#3b3f44", other: "#c9c7c0", cap: "#e9e8e3", rail: 0.18, gap: 0.7, clear: 0.3 });

/** How wide a pole, mast or boom is drawn (m): enough to hold at 150 m. */
export const SPAR = 0.14;

export const BOATS = Object.freeze({
  troller: { length: [10, 13], beam: 0.32, hull: "#f0f0ec", trim: ["#3f5b45", "#8e2f27", "#2f3e55"], house: { at: 0.42, length: 0.25, height: 2.2 }, poles: true, sheer: 0.8, boot: "#7a2a24", working: true, freeboard: 1.3, bulwark: 0.7 },
  seiner: { length: [12, 16], beam: 0.33, hull: "#f0f0ec", trim: ["#8e2f27", "#2f3e55", "#3e7a78", "#c49a3a"], house: { at: 0.68, length: 0.28, height: 2.6 }, sheer: 0.9, working: true, derrick: 0.55, freeboard: 1.6, bulwark: 0.7 },
  sportfisher: { length: [6, 8.5], beam: 0.36, hull: "#c9ccce", trim: ["#2b2c2e"], house: { at: 0.55, length: 0.35, height: 1.6 }, sheer: 0.35, boot: "#3a3d40" },
  // a cruising sailboat: a low coachroof, a mast about 1.3 times her length, a boom (a blue cover over it on some)
  sailboat: { length: [8, 12], beam: 0.32, hull: "#eeefec", trim: ["#1f4e79", "#2b2c2e", "#8e2f27"], house: { at: 0.45, length: 0.35, height: 0.7 }, mast: 1.3, freeboard: 0.8, sheer: 0.35, boot: "#1f3348" },
  // not moored by hash (MIX): placed about a harbour by a place's look
  // grey aluminium hulls: the whale-watching boats and water taxis at the Whiskey Dock and the 52 Steps
  whalewatch: { length: [10, 13], beam: 0.33, hull: "#aeb3b5", trim: ["#1f4e79", "#c8372d"], house: { at: 0.5, length: 0.5, height: 2.3 } },
  watertaxi: { length: [8, 10], beam: 0.35, hull: "#b8bcbe", trim: ["#c8372d", "#1f4e79"], house: { at: 0.58, length: 0.4, height: 1.9 } },
});
/** The boats a slip takes by hash, weighted: a harbour's floats; a place's look may give its own mix about some piers (`mixAt`). */
export const MIX = Object.freeze([["troller", 30], ["seiner", 15], ["sportfisher", 25], ["sailboat", 30]].map((e) => Object.freeze(e)));
/** Where boats lie alongside a fixed pier (a place's look's `moorPiers`): a slip every `every` m along each side (an area pier's: along its outline, outside it), `taken` of them, only where the water under a boat is at least `depth` m (at mean water, or at chart datum where the place says). */
export const PIER_MOORING = Object.freeze({ every: 12, taken: 0.6, depth: 2 });

/**
 * The boats along every float (OSM `man_made=pier` + `floating=yes`) with a
 * point inside, and, where `piers` is given ({ within(x, z), taken, every,
 * depth, groundAt(x, z) (m about mean water), datum (how far under mean
 * water the depth is measured from, m: 0, or chart datum's) }), along every
 * fixed pier with a point within (an area pier's outline, outside it), each
 * boat only where the water under her is at least `depth` there: [{ id,
 * type, x, z, heading, length, beam, trim, pier? }]. A place's `mixAt(x, z)`
 * may give its own mix about some piers or floats (by the structure's
 * first point). Pure.
 */
export function mooredBoats(structures, { inside = () => true, every = 12, taken = 0.85, takenAt = null, piers = null, mixAt = null } = {}) {
  const out = [];
  // every float's, pier's and wall's outline, so no boat is moored over one (a float's bend, a finger beside it)
  const rings = structureRings(structures);
  const clearOf = (x, z, ux, uz, length, beam) => !rings.some((r) => overlaps(footprint(x, z, ux, uz, length, beam, DECKS.clear), r));
  for (const st of structures) {
    const kind = kindOf(st);
    if (!st.points.some(([x, z]) => inside(x, z))) continue;
    const pier = kind === "pier" && piers && st.points.some(([x, z]) => piers.within(x, z));
    if ((kind !== "float" || st.area) && !pier) continue;
    // an area pier: its outline, closed, boats on its outside only (by its winding), no half-width out
    const outline = st.area ? [...st.points, st.points[0]] : st.points;
    const outside = st.area ? (ringSign(st.points) > 0 ? [1] : [-1]) : [-1, 1];
    const width = st.area ? 0 : st.width > 0 && st.width < 50 ? st.width : pier ? 3 : 2.4;
    // a float's share of slips taken: the place's where it says (takenAt, by the float's first point), else `taken`; a pier's, the piers'
    const share = pier ? piers.taken ?? PIER_MOORING.taken : takenAt?.(st.points[0][0], st.points[0][1]) ?? taken;
    const mix = mixAt?.(st.points[0][0], st.points[0][1]) ?? MIX;
    const step = pier ? piers.every ?? PIER_MOORING.every : every;
    const deep = pier ? (x, z) => {
      const g = piers.groundAt(x, z);
      return g != null && g <= -(piers.datum ?? 0) - (piers.depth ?? PIER_MOORING.depth);
    } : () => true;
    // the sides whose last slip with water enough for a boat was left empty
    const empty = new Set();
    // whether slip `key` would hold her boat (the boat her hash makes): in the grid and deep enough at her ends and middle
    const fits = (key, side, d, ax, az, ux, uz) => {
      const b = boatAt(key, mix);
      const off = width / 2 + b.beam / 2 + DECKS.gap;
      const x = ax + ux * d - uz * off * side, z = az + uz * d + ux * off * side;
      return inside(x, z) && deep(x, z) && deep(x + ux * b.length * 0.45, z + uz * b.length * 0.45) && deep(x - ux * b.length * 0.45, z - uz * b.length * 0.45);
    };
    let slot = 0;
    for (let q = 0; q + 1 < outline.length; q++) {
      const [ax, az] = outline[q], [bx, bz] = outline[q + 1];
      const L = len(bx - ax, bz - az);
      if (L < step) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let d = step / 2; d + step / 2 <= L; d += step, slot++) {
        for (const side of outside) {
          const key = `${st.id}#${slot}${side > 0 ? "s" : "p"}`;
          // a slip its hash leaves empty is taken all the same after an empty one on the same side: never two empty slips running (at least a boat every two slips), unless none are to be taken
          const free = hashString(key, 1) >= share;
          if (free && (share <= 0 || !empty.has(side))) {
            if (fits(key, side, d, ax, az, ux, uz)) empty.add(side);
            continue;
          }
          const { type, length, beam } = boatAt(key, mix);
          const B = BOATS[type];
          const off = width / 2 + beam / 2 + DECKS.gap;
          const x = ax + ux * d - uz * off * side, z = az + uz * d + ux * off * side;
          // her ends and her middle in the water deep enough (a pier's: `depth` at chart datum)
          if (!inside(x, z) || !deep(x, z) || !deep(x + ux * length * 0.45, z + uz * length * 0.45) || !deep(x - ux * length * 0.45, z - uz * length * 0.45)) continue;
          // and clear of every float, pier and wall by DECKS.clear
          if (!clearOf(x, z, ux, uz, length, beam)) continue;
          empty.delete(side);
          // bow one way or the other along the float
          const heading = hashString(key, 4) < 0.5 ? Math.atan2(ux, -uz) : Math.atan2(-ux, uz);
          out.push({ id: key, type, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, heading, length: Math.round(length * 100) / 100, beam: Math.round(beam * 100) / 100, trim: B.trim[Math.floor(hashString(key, 5) * B.trim.length)], ...(pier ? { pier: true } : {}) });
        }
      }
    }
  }
  return out;
}

/** Every structure's outline as mooredBoats keeps boats off it: an area's ring as drawn, a line widened (its width tag, else its kind's): [{ ring, box }]. Pure. */
export function structureRings(structures) {
  const out = [];
  for (const st of structures) {
    const k = KINDS[kindOf(st)];
    if (!k) continue;
    const width = st.width > 0 && st.width < 50 ? st.width : k.width;
    const ring = st.area ? st.points : widen(st.points, width);
    if (!ring || ring.length < 3) continue;
    out.push({ ring, box: boxOf(ring) });
  }
  return out;
}

/** A boat's footprint at (x, z) along (ux, uz), her length by her beam, grown by `grow` all round: its four corners. Pure. */
export function footprint(x, z, ux, uz, length, beam, grow = 0) {
  const a = length / 2 + grow, b = beam / 2 + grow;
  return [[-a, -b], [a, -b], [a, b], [-a, b]].map(([f, r]) => [x + ux * f - uz * r, z + uz * f + ux * r]);
}

const boxOf = (pts) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
  return [x0, z0, x1, z1];
};
const segsCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};

/** Whether a footprint (a ring) overlaps a structure's ({ ring, box }): any edges crossing, or a corner of either inside the other. Pure. */
export function overlaps(foot, { ring, box }) {
  const fb = boxOf(foot);
  if (fb[2] < box[0] || fb[0] > box[2] || fb[3] < box[1] || fb[1] > box[3]) return false;
  for (let a = 0; a < foot.length; a++) for (let c = 0; c < ring.length; c++) if (segsCross(foot[a], foot[(a + 1) % foot.length], ring[c], ring[(c + 1) % ring.length])) return true;
  return foot.some(([x, z]) => insideRing(ring, x, z)) || ring.some(([x, z]) => insideRing(foot, x, z));
}

/** The boat slip `key` takes by its hash, from `mix`: { type, length, beam }. */
function boatAt(key, mix) {
  const total = mix.reduce((a, [, w]) => a + w, 0);
  let u = hashString(key, 2) * total, type = mix[0][0];
  for (const [t, w] of mix) {
    if (u < w) {
      type = t;
      break;
    }
    u -= w;
  }
  const B = BOATS[type];
  const length = B.length[0] + (B.length[1] - B.length[0]) * hashString(key, 3);
  return { type, length, beam: B.beam * length };
}

/** Which side of its edges a ring's outside is, in mooredBoats' terms: +1 or −1 by the ring's winding in (x, z). */
function ringSign(pts) {
  let a = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x1, z1] = pts[k], [x2, z2] = pts[(k + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a > 0 ? -1 : 1;
}

/** A boat's own hash in [0, 1) by its id and a seed. */
const own = (b, seed) => hashString(String(b.id), seed);

/**
 * How a boat is painted, by its type and its own hash: { hull, house, roof,
 * rail, bottom, stripe, buoys }. A working boat (troller, seiner): a hull in
 * one of WORKING.hulls for `painted` of them, else white; her wheelhouse
 * and its top white or pale grey; red bottom paint and a white boot stripe;
 * 2 to 4 buoys; her rail her trim colour on a white hull, white on a painted
 * one. Any other: her type's hull, a white house and top (a roof is never
 * the trim colour), her trim on the rail. Pure.
 */
export function paintOf(b) {
  return { ...hullPaint(b), ...deckPaint(b) };
}

/** A boat's deck and cap rail (DECKS), by her type and her own hash: { deck, cap, cockpit? }. Pure. */
export function deckPaint(b) {
  const B = BOATS[b.type];
  if (B.working) return { deck: DECKS.working[own(b, 11) < DECKS.tan ? 1 : 0], cap: DECKS.cap };
  if (b.type === "sailboat") return { deck: DECKS.sailboat, cap: DECKS.cap, cockpit: DECKS.cockpit };
  return { deck: DECKS.other, cap: DECKS.cap };
}

function hullPaint(b) {
  const B = BOATS[b.type];
  if (B.working) {
    const painted = own(b, 6) < WORKING.painted;
    const hull = painted ? WORKING.hulls[Math.floor(own(b, 7) * WORKING.hulls.length)] : WORKING.white;
    const house = WORKING.houses[Math.floor(own(b, 9) * WORKING.houses.length)];
    const [lo, hi] = WORKING.buoys;
    return { hull, house, roof: house, rail: painted ? WORKING.stripe : b.trim, bottom: WORKING.bottom, stripe: WORKING.stripe, buoys: lo + Math.min(hi - lo, Math.floor(own(b, 10) * (hi - lo + 1))) };
  }
  return { hull: B.hull, house: B.hull, roof: b.type === "sportfisher" ? b.trim : WORKING.houses[0], rail: b.trim, bottom: B.boot ?? "#2a2c2e", stripe: B.boot ?? "#2a2c2e", buoys: 0 };
}

/** The boats as one flat-shaded soup. */
export function boatMesh(boats) {
  const s = soup();
  for (const b of boats) {
    const B = BOATS[b.type];
    const fx = dsin(b.heading), fz = -dcos(b.heading); // forward
    const rx = -fz, rz = fx; // starboard
    const at = (f, r, y) => [b.x + fx * f + rx * r, y, b.z + fz * f + rz * r];
    const Lh = b.length / 2, Bh = b.beam / 2, fb = B.freeboard ?? 0.9, keel = -0.6;
    const paint = paintOf(b);
    const hull = rgb(paint.hull), rail = rgb(paint.rail), deck = rgb(paint.deck), cap = rgb(paint.cap), bottom = rgb(paint.bottom), stripe = rgb(paint.stripe), house = rgb(paint.house), roof = rgb(paint.roof);
    // the deck under the bulwark's top (a working boat's 0.7 m; any other's a low toe rail)
    const bw = B.bulwark ?? 0.1;
    // hull: a box aft, a wedge to the bow, its sheer rising forward (the bow `sheer` above the stern)
    const sheer = B.sheer ?? 0.6;
    const topAt = (f) => fb + sheer * Math.max(0, (f + Lh) / (2 * Lh)) ** 2;
    const sides = [[-Lh, -Bh], [Lh * 0.45, -Bh], [Lh, 0], [Lh * 0.45, Bh], [-Lh, Bh]];
    for (let k = 0; k < sides.length; k++) {
      const [f0, r0] = sides[k], [f1, r1] = sides[(k + 1) % sides.length];
      const out = at(((f0 + f1) / 2) * 1.5, ((r0 + r1) / 2) * 3, 0);
      const t0 = topAt(f0), t1 = topAt(f1);
      // the bottom paint, showing a little over the water, and the boot stripe over it
      quadOut(s, at(f0, r0, keel), at(f1, r1, keel), at(f1, r1, 0.12), at(f0, r0, 0.12), bottom, out);
      quadOut(s, at(f0, r0, 0.12), at(f1, r1, 0.12), at(f1, r1, 0.3), at(f0, r0, 0.3), stripe, out);
      quadOut(s, at(f0, r0, 0.3), at(f1, r1, 0.3), at(f1, r1, t1 - 0.15), at(f0, r0, t0 - 0.15), hull, out);
      quadOut(s, at(f0, r0, t0 - 0.15), at(f1, r1, t1 - 0.15), at(f1, r1, t1), at(f0, r0, t0), rail, [out[0], out[1] + 0.01, out[2]]);
    }
    // the gunwale's white cap rail (DECKS.rail wide, inward), the bulwark's inner face in her hull's colour down to the deck
    const inner = sides.map(([f, r]) => [f === Lh ? Lh - DECKS.rail * 2.5 : f === -Lh ? -Lh + DECKS.rail : f, r === 0 ? 0 : r - Math.sign(r) * DECKS.rail]);
    const deckAt = (f) => topAt(f) - bw;
    for (let k = 0; k < sides.length; k++) {
      const q = (k + 1) % sides.length;
      const [f0, r0] = sides[k], [f1, r1] = sides[q], [g0, s0] = inner[k], [g1, s1] = inner[q];
      quadUp(s, at(f0, r0, topAt(f0) + 0.02), at(f1, r1, topAt(f1) + 0.02), at(g1, s1, topAt(g1) + 0.02), at(g0, s0, topAt(g0) + 0.02), cap);
      quadOut(s, at(g0, s0, deckAt(g0)), at(g1, s1, deckAt(g1)), at(g1, s1, topAt(g1)), at(g0, s0, topAt(g0)), hull.map((v) => v * 0.85), at(0, 0, topAt(0)));
    }
    const mid = deckAt(inner[1][0]);
    quadUp(s, at(inner[0][0], inner[0][1], deckAt(inner[0][0])), at(inner[1][0], inner[1][1], mid), at(inner[3][0], inner[3][1], mid), at(inner[4][0], inner[4][1], deckAt(inner[4][0])), deck);
    triOut(s, at(inner[1][0], inner[1][1], mid), at(inner[2][0], 0, deckAt(inner[2][0])), at(inner[3][0], inner[3][1], mid), deck, at(Lh * 0.7, 0, mid + 5));
    // the wheelhouse (a sailboat's coachroof): white walls and top (paintOf), a dark band of windows
    const hc = -Lh + b.length * B.house.at, hl = (b.length * B.house.length) / 2, hw = Bh * 0.75, base = deckAt(hc), top = topAt(hc) + B.house.height;
    // a sailboat's cockpit well, dark, aft of her coachroof
    if (paint.cockpit) quadUp(s, at(-Lh * 0.85, -hw * 0.85, deckAt(-Lh * 0.85) + 0.01), at(hc - hl, -hw * 0.85, deckAt(hc - hl) + 0.01), at(hc - hl, hw * 0.85, deckAt(hc - hl) + 0.01), at(-Lh * 0.85, hw * 0.85, deckAt(-Lh * 0.85) + 0.01), rgb(paint.cockpit));
    const box = [[hc - hl, -hw], [hc + hl, -hw], [hc + hl, hw], [hc - hl, hw]];
    const glass = rgb("#26313a");
    for (let k = 0; k < 4; k++) {
      const [f0, r0] = box[k], [f1, r1] = box[(k + 1) % 4];
      const out = at(hc + ((f0 + f1) / 2 - hc) * 3, ((r0 + r1) / 2) * 3, base);
      quadOut(s, at(f0, r0, base), at(f1, r1, base), at(f1, r1, top), at(f0, r0, top), house, out);
      if (B.house.height > 1.2) quadOut(s, at(f0, r0, top - 0.75), at(f1, r1, top - 0.75), at(f1, r1, top - 0.25), at(f0, r0, top - 0.25), glass, [out[0], out[1] + 0.01, out[2]].map((v, i) => v + [fx, 0, fz][i] * 0.001));
    }
    quadUp(s, at(hc - hl, -hw, top), at(hc + hl, -hw, top), at(hc + hl, hw, top), at(hc - hl, hw, top), roof);
    // a spar: two thin crossed quads, seen from any side
    const spar = (p0, p1, w, col) => {
      for (const [dx, dz] of [[w, 0], [0, w]]) {
        s.quad([p0[0] - dx, p0[1], p0[2] - dz], [p0[0] + dx, p0[1], p0[2] + dz], [p1[0] + dx, p1[1], p1[2] + dz], [p1[0] - dx, p1[1], p1[2] - dz], col);
        s.quad([p0[0] + dx, p0[1], p0[2] + dz], [p0[0] - dx, p0[1], p0[2] - dz], [p1[0] - dx, p1[1], p1[2] - dz], [p1[0] + dx, p1[1], p1[2] + dz], col);
      }
    };
    // a troller's poles, raised in a V from the wheelhouse's sides: each about 1.5 times her length, 20° out from upright
    if (B.poles) for (const r of [-1, 1]) {
      const p0 = at(hc, r * hw, top), pl = 1.5 * b.length;
      spar(p0, at(hc - 0.6, r * (hw + pl * 0.34), top + pl * 0.94), SPAR / 2, rgb("#d8d6d0"));
    }
    // a seiner's short mast at the wheelhouse's front (`derrick` of her length) and its boom reaching aft over the deck
    if (B.derrick) {
      const mf = hc + hl + 0.2, foot = topAt(mf), mh = B.derrick * b.length;
      spar(at(mf, 0, foot), at(mf, 0, foot + mh), SPAR / 2, rgb("#d8d6d0"));
      spar(at(mf, 0, foot + 1.2), at(-Lh * 0.7, 0, foot + mh * 0.62), SPAR / 2, rgb("#c9c7c1"));
    }
    // a working boat's buoys hung over her rail (2 to 4, alternating sides, spread along her), each an octahedron about 0.7 m across
    for (let q = 0; q < paint.buoys; q++) {
      const side = q % 2 ? 1 : -1, f = -Lh * 0.6 + ((q + 0.5) / paint.buoys) * Lh * 1.1, y = topAt(f) - 0.45, r = side * (Bh + 0.36), R = 0.36;
      const c = at(f, r, y), col = rgb(WORKING.buoy);
      const pts = [[R, 0, 0], [0, 0, R], [-R, 0, 0], [0, 0, -R]].map(([dx, , dz]) => [c[0] + dx, c[1], c[2] + dz]);
      const up = [c[0], c[1] + R * 1.2, c[2]], dn = [c[0], c[1] - R * 1.2, c[2]];
      // each face toward the outside: away from the buoy's middle
      const away = (p, q, w) => [0, 1, 2].map((i) => 2 * ((p[i] + q[i] + w[i]) / 3) - c[i]);
      for (let e = 0; e < 4; e++) {
        triOut(s, pts[e], pts[(e + 1) % 4], up, col, away(pts[e], pts[(e + 1) % 4], up));
        triOut(s, pts[(e + 1) % 4], pts[e], dn, col.map((v) => v * 0.8), away(pts[e], pts[(e + 1) % 4], dn));
      }
    }
    // a sailboat's mast (about 1.3 times her length) and boom; some with a blue canvas cover over the boom
    if (B.mast) {
      const mf = hc + hl + 0.3, foot = topAt(mf), boomY = foot + 1.7;
      spar(at(mf, 0, foot), at(mf, 0, foot + B.mast * b.length), SPAR / 2, rgb("#cfd1d2"));
      spar(at(mf, 0, boomY), at(-Lh * 0.8, 0, boomY - 0.1), SPAR / 2, rgb("#bfc1c2"));
      if (own(b, 7) < 0.45) {
        const cover = rgb(own(b, 8) < 0.7 ? "#1f4e79" : "#2f5f8f"), half = 0.45;
        const a0 = at(mf - 0.2, 0, boomY + 0.25), a1 = at(-Lh * 0.75, 0, boomY + 0.15);
        for (const r of [-1, 1]) quadOut(s, a0, a1, at(-Lh * 0.75, r * half, boomY - 0.45), at(mf - 0.2, r * half, boomY - 0.4), cover, at((mf - Lh * 0.75) / 2, r * 3, boomY));
      }
    }
  }
  return s.done();
}
