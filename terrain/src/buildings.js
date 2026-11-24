// Buildings from OpenStreetMap footprints (look-osm.js), extruded: walls to
// an eave, then a gable roof over a footprint that is nearly its oriented
// rectangle (ridge along the long side), else a flat roof. OSM rarely says
// how tall a building is (in Ucluelet 2 of about 460 do), so heights,
// pitches and colours are assumptions by kind and by what covers the ground
// there (cover.js): houses about 5.5 m to the eave with a 32° gable, hotels
// 9.5 m, shops 5.5 m flat, industrial sheds 8.5 m with a low metal gable.
// Colours are the West Coast vernacular, picked by a hash of the OSM id
// (README, "The look"): general, not checked house by house.
//
// Pure.

import earcut from "earcut";
import { rgb } from "./shapes.js";
import { dtan, dsin, dcos, len } from "./detmath.js";
import { COVER } from "./cover.js";
import { ringArea } from "./cover.js";

/** Assumed heights (to the eave, m) and roof pitches (degrees) by class. */
export const CLASSES = Object.freeze({
  house: { eave: 5.5, pitch: 32, small: 3.4 },
  hotel: { eave: 9.5, pitch: 18 },
  commercial: { eave: 5.5, pitch: 0 },
  industrial: { eave: 8.5, pitch: 8 },
  shed: { eave: 2.8, pitch: 25 },
  civic: { eave: 7, pitch: 30 },
});

/** The palette (sRGB), weighted: walls and roofs for houses; cladding for industrial. Art direction. */
export const PALETTE = Object.freeze({
  walls: [["#8d867b", 30], ["#9c6b45", 15], ["#e6e4dd", 15], ["#3f5b45", 7], ["#8e2f27", 7], ["#5f7a8c", 7], ["#2f3e55", 6], ["#c49a3a", 6], ["#3e7a78", 7]],
  roofs: [["#3d3f42", 45], ["#3f5a48", 20], ["#7d2b25", 15], ["#9ea3a6", 20]],
  cladding: [["#d9dbd8", 50], ["#b8bcbc", 35], ["#9cc3ae", 15]],
  metalRoofs: [["#9ea3a6", 60], ["#3f5a72", 25], ["#8b3a26", 15]],
  trim: "#ecebe6",
  // an industrial building at the water (a fish plant): cream corrugated cladding
  plant: "#d8d2bf",
});

/**
 * A house as the West Coast builds one (art direction, the town's
 * photographs' general look): any building tagged a house (RESIDENTIAL), or
 * untagged with a footprint under `small` m² where it would be a house, is
 * drawn as its oriented rectangle under a gable of `pitch` degrees (by hash,
 * its ridge along the long side, `overhang` m over the walls), at most
 * `storeys` storeys, `windows` windows a wall a storey, and on `porch` of
 * them (by hash) a deck `deep` m deep along the long wall on the downhill or
 * water side. Its walls and roof from the palette's `houseWalls` and
 * `houseRoofs` where it has them.
 */
export const HOUSE = Object.freeze({ small: 220, pitch: Object.freeze([25, 35]), overhang: 0.5, storeys: 2, windows: 2, porch: 0.4, deep: 2.4 });
/** The tags that make a building a house. */
export const RESIDENTIAL = /^(house|detached|residential|semidetached_house|cabin|bungalow)$/;
/** Whether building `b` of class `cls` (classOf) and footprint area `area` (m²) is drawn as a house (HOUSE). Pure. */
export const isResidential = (b, cls, area) => cls === "house" && (RESIDENTIAL.test(b.kind ?? "") || ((b.kind ?? "yes") === "yes" && area < HOUSE.small));

/** What a building's details are drawn in: trim (corner boards, the eave's band), windows, cream cladding's ribs, a pile deck's piles and its edge. Art direction. */
export const DETAIL = Object.freeze({ trim: "#e8e6df", glass: "#2b3136", piles: "#2e2721", deckEdge: "#3a3631", deckTop: "#8d8a82", storey: 2.8 });

/**
 * A building's facade details (no geometry of its own changes): white corner
 * boards and a band under the eave on every wall, and a row of dark windows
 * a storey (about 1.1 m tall, 1.2 m wide, one every 3 m, clear of the
 * corners), each 3 to 5 cm proud of its wall. For houses and the like; an
 * industrial building takes `ribs` instead (vertical ribs every 0.9 m, the
 * walls' colour darker: corrugated cladding). Exported for tests.
 */
export function facade(s, ring, { floor, eave, trim = DETAIL.trim, glass = DETAIL.glass, windows = true, ribs = null, storey = DETAIL.storey, perWall = Infinity }) {
  const pts = dedupe(ring);
  if (pts.length < 3) return 0;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const T = rgb(trim), G = rgb(glass), R = ribs ? rgb(ribs).map((c) => c * 0.72) : null;
  let quads = 0;
  for (let a = 0; a < pts.length; a++) {
    const A = pts[a], B = pts[(a + 1) % pts.length];
    const dx = B[0] - A[0], dz = B[1] - A[1], L = len(dx, dz);
    if (L < 1.5) continue;
    const ux = dx / L, uz = dz / L;
    // the wall's outward normal: away from the footprint's middle
    let nx = uz, nz = -ux;
    if (nx * ((A[0] + B[0]) / 2 - cx) + nz * ((A[1] + B[1]) / 2 - cz) < 0) (nx = -nx), (nz = -nz);
    const P = (t, y, off) => [A[0] + ux * t + nx * off, y, A[1] + uz * t + nz * off];
    const face = (t0, t1, y0, y1, off, col) => {
      const m = P((t0 + t1) / 2, (y0 + y1) / 2, off + 1);
      quadOut(s, P(t0, y0, off), P(t1, y0, off), P(t1, y1, off), P(t0, y1, off), col, m);
      quads++;
    };
    if (ribs) {
      for (let t = 0.9; t < L - 0.45; t += 0.9) face(t - 0.04, t + 0.04, floor, eave, 0.04, R);
      continue;
    }
    // corner boards at both ends, the eave's band
    face(0, 0.16, floor, eave, 0.05, T);
    face(L - 0.16, L, floor, eave, 0.05, T);
    face(0, L, eave - 0.28, eave, 0.05, T);
    if (!windows || L < 3) continue;
    const n = Math.min(perWall, Math.max(1, Math.floor((L - 1.2) / 3)));
    for (let y = floor; y + storey <= eave + 0.4; y += storey) {
      for (let q = 0; q < n; q++) {
        const t = (L * (q + 0.5)) / n;
        face(t - 0.6, t + 0.6, y + 0.9, Math.min(y + 2.0, eave - 0.35), 0.03, G);
      }
    }
  }
  return quads;
}

/**
 * A pile deck at the water (a fish plant's, a wharf shed's): its building's
 * oriented box, reaching seaward (to the box's side with the lower ground,
 * waterSide) in steps of DECK_REACH.step metres, at most `reach`, until
 * the ground under every pile of its outer row is DECK_REACH.depth metres
 * under the lower low water `mlw` (about a metre under mean low water), so
 * its outer piles stand in the water at nearly any tide. Where the water isn't that deep within reach, the deck is the
 * box alone. → { box, ring, side, out (metres seaward), reached, building
 * (its building's box, turned as the deck's) } or null
 * (no box). Pure.
 */
export const DECK_REACH = Object.freeze({ step: 2, reach: 50, depth: 0.5, every: 4, inset: 0.3 });
export function deckOf(pts, groundAt, { mlw = -1.2 } = {}) {
  const b0 = orientedBox(dedupe(pts));
  if (!b0) return null;
  // the side the water is: whichever of the four has the lowest ground 3 m out from its middle (the box turned so that side is +v or −v)
  const g = (dx, dz) => groundAt(b0.c[0] + dx, b0.c[1] + dz) ?? Infinity;
  const ends = Math.min(g(b0.u[0] * (b0.hu + 3), b0.u[1] * (b0.hu + 3)), g(-b0.u[0] * (b0.hu + 3), -b0.u[1] * (b0.hu + 3)));
  const sides = Math.min(g(b0.v[0] * (b0.hv + 3), b0.v[1] * (b0.hv + 3)), g(-b0.v[0] * (b0.hv + 3), -b0.v[1] * (b0.hv + 3)));
  const box = ends < sides ? { ...b0, u: b0.v, v: b0.u, hu: b0.hv, hv: b0.hu } : b0;
  const side = waterSide(box, groundAt);
  const grow = (e) => ({ ...box, c: [box.c[0] + box.v[0] * side * (e / 2), box.c[1] + box.v[1] * side * (e / 2)], hv: box.hv + e / 2 });
  const deep = (b) => pileSpots(b, side).filter((p) => p.outer).every((p) => {
    const g = groundAt(p.x, p.z);
    return g != null && g <= mlw - DECK_REACH.depth;
  });
  let e = 0, reached = deep(grow(0));
  while (!reached && e < DECK_REACH.reach) {
    e += DECK_REACH.step;
    reached = deep(grow(e));
  }
  if (!reached) e = 0;
  const b = grow(e);
  return { box: b, ring: rectangle(b), side, out: e, reached, building: box };
}

/**
 * Where a deck's piles stand: rows across its box from one long side to the
 * other, `inset` in from each and no more than `every` apart, so a row
 * stands at the outer edge (on the `side` the water is: `outer`) and one
 * at the inner; columns the same along it. Pure.
 */
export function pileSpots(box, side = 1, { every = DECK_REACH.every, inset = DECK_REACH.inset } = {}) {
  const { c, u, v, hu, hv } = box;
  const steps = (h) => {
    const span = Math.max(0, 2 * (h - inset));
    const n = Math.max(1, Math.ceil(span / every));
    return Array.from({ length: n + 1 }, (_, q) => -(h - inset) + (span * q) / n);
  };
  const rows = steps(hv), cols = steps(hu);
  const out = [];
  rows.forEach((b, r) => cols.forEach((a, q) => out.push({ x: c[0] + u[0] * a + v[0] * b, z: c[1] + u[1] * a + v[1] * b, outer: side > 0 ? r === rows.length - 1 : r === 0, col: q })));
  return out;
}

/** What a deck's details are drawn in: a fish plant's roller doors (one of these by hash), black tyre fenders on every `fenderEvery`th pile of its outer row. Art direction (the Southern Ridge photograph). */
export const DECK = Object.freeze({ doors: Object.freeze(["#3d6f9a", "#c9b04a"]), fender: "#1d1d1d", fenderEvery: 3 });

/**
 * A pile deck (deckOf's): a slab `thick` deep at `deck` over its box, a dark
 * band round its edge, and black piles at pileSpots wherever the ground is
 * below the deck, each from half a metre into the ground to the deck; a
 * black tyre fender hung on every DECK.fenderEvery-th pile of the outer row.
 * Returns how many piles.
 */
export function pileDeck(s, d, { deck, groundAt, thick = 0.5 }) {
  const pts = d.ring;
  const edge = rgb(DETAIL.deckEdge);
  const ccw = signedArea(pts) > 0 ? pts : pts.slice().reverse();
  for (let a = 0; a < ccw.length; a++) {
    const A = ccw[a], B = ccw[(a + 1) % ccw.length];
    s.quad([A[0], deck - thick, A[1]], [B[0], deck - thick, B[1]], [B[0], deck, B[1]], [A[0], deck, A[1]], edge);
  }
  // the deck's top where it reaches past the building (the building's floor covers the rest)
  if (d.out > 0) lid(s, ccw, deck, rgb(DETAIL.deckTop));
  let count = 0;
  for (const p of pileSpots(d.box, d.side)) {
    const g = groundAt(p.x, p.z);
    if (g == null || g > deck - thick - 0.3) continue;
    pile(s, p.x, p.z, Math.min(-6, g - 0.5), deck - thick, 0.2);
    count++;
    if (p.outer && p.col % DECK.fenderEvery === 0) {
      // a tyre hung on the pile's seaward face, a metre under the deck
      const ox = d.box.v[0] * d.side * 0.45, oz = d.box.v[1] * d.side * 0.45;
      fender(s, p.x + ox, p.z + oz, deck - thick - 1.3, deck - thick - 0.8, 0.42);
    }
  }
  return count;
}

/** A house's deck: HOUSE.deep m out from its long wall on `side` (of box.v), along 70% of it, at its floor, on four posts down to the ground. */
export function porch(s, box, { floor, side, groundAt }) {
  const { c, u, v } = box;
  const at = (a, b) => [c[0] + u[0] * a + v[0] * side * b, c[1] + u[1] * a + v[1] * side * b];
  const a0 = -box.hu * 0.7, a1 = box.hu * 0.7, b0 = box.hv, b1 = box.hv + HOUSE.deep;
  const ring = [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
  const top = floor + 0.05, col = rgb(DETAIL.deckTop);
  const ccw = signedArea(ring) > 0 ? ring : ring.slice().reverse();
  lid(s, ccw, top, col);
  const edge = rgb(DETAIL.deckEdge);
  for (let a = 0; a < 4; a++) {
    const A = ccw[a], B = ccw[(a + 1) % 4];
    s.quad([A[0], top - 0.25, A[1]], [B[0], top - 0.25, B[1]], [B[0], top, B[1]], [A[0], top, A[1]], edge);
  }
  for (const [a, b] of [[a0 + 0.2, b1 - 0.2], [a1 - 0.2, b1 - 0.2], [0, b1 - 0.2]]) {
    const [x, z] = at(a, b);
    const g = groundAt(x, z);
    if (g != null && g < top - 0.3) pile(s, x, z, g - 0.3, top - 0.25, 0.1);
  }
  return true;
}

/** A squat black cylinder (a tyre fender), eight-sided, capped. */
function fender(s, x, z, y0, y1, r) {
  const c = rgb(DECK.fender);
  const at = (k, y) => [x + r * dcos((k * Math.PI) / 4), y, z - r * dsin((k * Math.PI) / 4)];
  for (let k = 0; k < 8; k++) {
    s.quad(at(k, y0), at(k + 1, y0), at(k + 1, y1), at(k, y1), c);
    s.tri([x, y1, z], at(k, y1), at(k + 1, y1), c);
  }
}

/** A fish plant's roller doors: one or two (by `u`), on the long wall of `box` facing `side`, `colour`, up to 4.2 m tall from `floor`. */
export function rollerDoors(s, box, { floor, eave, side, u, colour }) {
  const n = u < 0.5 ? 1 : 2;
  const w = Math.min(3.6, (2 * box.hu) / (n + 1.5)), hgt = Math.min(4.2, eave - floor - 1.2);
  if (w < 1.5 || hgt < 1.5) return 0;
  const { c, u: U, v } = box;
  const at = (a, y) => [c[0] + U[0] * a + v[0] * side * (box.hv + 0.08), y, c[1] + U[1] * a + v[1] * side * (box.hv + 0.08)];
  const col = rgb(colour), slat = col.map((x) => x * 0.8);
  for (let q = 0; q < n; q++) {
    const a = n === 1 ? 0 : (q ? 1 : -1) * box.hu * 0.4;
    const toward = [c[0] + v[0] * side * (box.hv + 5), floor, c[1] + v[1] * side * (box.hv + 5)];
    quadOut(s, at(a - w / 2, floor), at(a + w / 2, floor), at(a + w / 2, floor + hgt), at(a - w / 2, floor + hgt), col, toward);
    // the roll's box over it
    quadOut(s, at(a - w / 2 - 0.15, floor + hgt), at(a + w / 2 + 0.15, floor + hgt), at(a + w / 2 + 0.15, floor + hgt + 0.45), at(a - w / 2 - 0.15, floor + hgt + 0.45), slat, toward);
  }
  return n;
}

/** A six-sided pile, dark, from y0 to y1. */
function pile(s, x, z, y0, y1, r) {
  const c = rgb(DETAIL.piles);
  for (let k = 0; k < 6; k++) {
    const t0 = (k * Math.PI) / 3, t1 = ((k + 1) * Math.PI) / 3;
    const a = [x + r * dcos(t0), z - r * dsin(t0)], b = [x + r * dcos(t1), z - r * dsin(t1)];
    s.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], c);
  }
}

/** A string's 32-bit FNV-1a hash, in [0, 1). */
export function hashString(s, seed = 0) {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const weighted = (list, u) => {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let x = u * total;
  for (const [c, w] of list) {
    if (x < w) return c;
    x -= w;
  }
  return list.at(-1)[0];
};

/** A building's class, from its tags and the ground's cover there. */
export function classOf(b, cover) {
  const k = b.kind ?? "yes", u = b.use ?? "";
  if (/^(hotel|motel|guest_house|hostel)$/.test(u) || k === "hotel") return "hotel";
  if (/^(shed|garage|garages|hut|roof|carport|greenhouse|kiosk|toilets)$/.test(k)) return "shed";
  if (/^(industrial|warehouse|manufacture|boathouse|hangar|storage_tank|service)$/.test(k) || (k === "yes" && cover === COVER.yard)) return "industrial";
  if (/^(commercial|retail|office|supermarket)$/.test(k)) return "commercial";
  if (/^(church|school|public|civic|government|fire_station|community_centre)$/.test(k) || /^(school|community_centre|townhall|place_of_worship)$/.test(u)) return "civic";
  return "house";
}

/** The oriented rectangle of least area round a ring (one side along one of its edges): { c, u, v, hu, hv, area }; u the long axis. */
export function orientedBox(pts) {
  let best = null;
  for (let a = 0; a < pts.length; a++) {
    const b = (a + 1) % pts.length;
    const dx = pts[b][0] - pts[a][0], dz = pts[b][1] - pts[a][1];
    const l = len(dx, dz);
    if (l < 1e-6) continue;
    const u = [dx / l, dz / l], v = [-u[1], u[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const pu = p[0] * u[0] + p[1] * u[1], pv = p[0] * v[0] + p[1] * v[1];
      u0 = Math.min(u0, pu), u1 = Math.max(u1, pu), v0 = Math.min(v0, pv), v1 = Math.max(v1, pv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      best = { c: [cu * u[0] + cv * v[0], cu * u[1] + cv * v[1]], u, v, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, area };
    }
  }
  // u the long axis
  if (best && best.hv > best.hu) best = { ...best, u: best.v, v: [-best.u[0], -best.u[1]], hu: best.hv, hv: best.hu };
  return best;
}

/**
 * Walls (base to eave) round a ring, and a roof: a gable over its oriented
 * rectangle (the ridge `rise` above the eave, along u) or a flat lid.
 * Exported for the site's buildings (site.js) too.
 */
export function house(s, ring, { base, eave, rise = 0, roof = "gable", walls, roofColour, overhang = 0.35, box = null }) {
  const pts = dedupe(ring);
  if (pts.length < 3) return false;
  const w = rgb(walls), wd = w.map((c) => c * 0.82), r = rgb(roofColour);
  // walls, outward faces (the ring made counter-clockwise from above)
  const ccw = signedArea(pts) > 0 ? pts : pts.slice().reverse();
  for (let a = 0; a < ccw.length; a++) {
    const b = (a + 1) % ccw.length;
    const A = ccw[a], B = ccw[b];
    // shade the walls by which way they face, a little: the sun is not in the GLB
    const c = (B[0] - A[0]) * 0.3 + (B[1] - A[1]) * 0.7 > 0 ? w : wd;
    s.quad([A[0], base, A[1]], [B[0], base, B[1]], [B[0], eave, B[1]], [A[0], eave, A[1]], c);
  }
  const bx = box ?? orientedBox(pts);
  if (roof === "gable" && bx && rise > 0.05) {
    const { c, u, v } = bx;
    const hu = bx.hu + overhang, hv = bx.hv + overhang;
    const at = (su, sv, y) => [c[0] + u[0] * su + v[0] * sv, y, c[1] + u[1] * su + v[1] * sv];
    const drop = (overhang * rise) / bx.hv;
    const e0 = eave - drop;
    // the two slopes
    quadUp(s, at(-hu, -hv, e0), at(hu, -hv, e0), at(hu, 0, eave + rise), at(-hu, 0, eave + rise), r);
    quadUp(s, at(hu, hv, e0), at(-hu, hv, e0), at(-hu, 0, eave + rise), at(hu, 0, eave + rise), r);
    // the gable ends (in the walls' colour), from the eave up
    triOut(s, at(-bx.hu, -bx.hv, eave), at(-bx.hu, bx.hv, eave), at(-bx.hu, 0, eave + rise), w, at(-bx.hu - 1, 0, eave));
    triOut(s, at(bx.hu, bx.hv, eave), at(bx.hu, -bx.hv, eave), at(bx.hu, 0, eave + rise), w, at(bx.hu + 1, 0, eave));
  } else if (roof === "shed" && bx && rise > 0.05) {
    // a mono-pitch roof: high along the ring's first edge's side (v < 0), low on the other; the walls go up to it
    const { c, u, v } = bx;
    const at = (su, sv, y) => [c[0] + u[0] * su + v[0] * sv, y, c[1] + u[1] * su + v[1] * sv];
    quadUp(s, at(-bx.hu, bx.hv, eave), at(bx.hu, bx.hv, eave), at(bx.hu, -bx.hv, eave + rise), at(-bx.hu, -bx.hv, eave + rise), r);
    quadOut(s, at(-bx.hu, -bx.hv, eave), at(bx.hu, -bx.hv, eave), at(bx.hu, -bx.hv, eave + rise), at(-bx.hu, -bx.hv, eave + rise), w, at(0, -bx.hv - 1, eave));
    triOut(s, at(-bx.hu, -bx.hv, eave), at(-bx.hu, bx.hv, eave), at(-bx.hu, -bx.hv, eave + rise), w, at(-bx.hu - 1, 0, eave));
    triOut(s, at(bx.hu, bx.hv, eave), at(bx.hu, -bx.hv, eave), at(bx.hu, -bx.hv, eave + rise), w, at(bx.hu + 1, 0, eave));
  } else {
    lid(s, ccw, eave, r);
  }
  return true;
}

/**
 * A soup (shapes.js's interface) that keeps one primitive a colour,
 * positions only (a glTF primitive's baseColorFactor carries its colour):
 * for thousands of buildings in a dozen colours, half the bytes of colour
 * per vertex.
 */
export function paletteSoup() {
  const by = new Map();
  const tri = (a, b, c, rgb) => {
    const key = rgb.map((x) => x.toFixed(5)).join(",");
    let e = by.get(key);
    if (!e) by.set(key, (e = { color: rgb.slice(0, 3), pos: [] }));
    e.pos.push(...a, ...b, ...c);
  };
  return {
    tri,
    quad(a, b, c, d, rgb) {
      tri(a, b, c, rgb);
      tri(a, c, d, rgb);
    },
    get count() {
      let n = 0;
      for (const e of by.values()) n += e.pos.length / 3;
      return n;
    },
    done() {
      return { primitives: [...by.keys()].sort().map((k) => ({ positions: new Float32Array(by.get(k).pos), color: by.get(k).color })) };
    },
  };
}

/**
 * Every OSM building: { primitives: [{ positions, color }], made, skipped }.
 * @param {object[]} buildings  look-osm.js buildings
 * @param {{ groundAt(x, z): number | null, sinkAt(h): number, coverAt(x, z): number, leaveOut?(b): boolean, palette? }} o
 */
export function buildingMesh(buildings, { groundAt, sinkAt, coverAt, leaveOut = () => false, palette = PALETTE, details = false, deckAbove = null, mlw = -1.2 }) {
  const s = paletteSoup();
  let made = 0, decks = 0, reached = 0;
  const skipped = [];
  for (const b of buildings) {
    if (leaveOut(b)) continue;
    const f = footing(b, groundAt);
    if (!f) {
      skipped.push(b.id);
      continue;
    }
    let { pts } = f;
    const { lo, hi } = f;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    // at the water (where `deckAbove` is given: its lowest ground under it, the shore), on a pile deck above the highest tide, not walls down into the sea
    const onDeck = deckAbove != null && lo < 1;
    // a building on a pile deck is a fish plant or a wharf shed (cream ribbed cladding, roller doors, a low metal roof), unless the place draws it itself (an override's colour or form)
    const cls = onDeck && palette.plant && !b.colour && !b.form ? "industrial" : classOf(b, coverAt(cx, cz));
    const C = CLASSES[cls];
    const area = ringArea(pts);
    const box = orientedBox(pts);
    // a house (HOUSE): its oriented rectangle under a gable, whatever its footprint's jogs; not a place's own landmark
    const homey = palette.houseWalls && !b.form && !b.colour && box && isResidential(b, cls, area);
    const rectangular = box && (homey || area / (4 * box.hu * box.hv) > 0.8);
    // a footprint that is nearly its rectangle is drawn as the rectangle: four walls, not the survey's every jog
    if (rectangular && (homey || area / (4 * box.hu * box.hv) > 0.92)) pts = rectangle(box);
    const levels = b.levels ? Math.min(b.levels, homey ? HOUSE.storeys : Infinity) * 3 : null;
    const eaveH0 = b.height ? Math.max(2.5, b.height - (C.pitch ? dtan((C.pitch * Math.PI) / 180) * (box?.hv ?? 0) : 0)) : levels ?? (cls === "house" && area < 70 ? C.small : C.eave);
    const eaveH = homey ? Math.min(eaveH0, HOUSE.storeys * DETAIL.storey + 0.4) : eaveH0;
    const pitch = homey ? HOUSE.pitch[0] + (HOUSE.pitch[1] - HOUSE.pitch[0]) * hashString(b.id, 6) : /flat/.test(b.roof ?? "") ? 0 : C.pitch;
    const rise = rectangular && pitch ? Math.min(dtan((pitch * Math.PI) / 180) * box.hv, 8) : 0;
    const industrial = cls === "industrial";
    const walls = b.colour && /^#[0-9a-f]{6}$/i.test(b.colour) ? b.colour : weighted(industrial ? palette.cladding : homey ? palette.houseWalls : palette.walls, hashString(b.id, 1));
    const roofColour = b.roofColour && /^#[0-9a-f]{6}$/i.test(b.roofColour) ? b.roofColour : weighted(industrial ? palette.metalRoofs : homey ? palette.houseRoofs ?? palette.roofs : palette.roofs, hashString(b.id, 2));
    const floor = onDeck ? Math.max(hi, deckAbove) : hi;
    const base = onDeck ? floor - 0.5 : lo - sinkAt(lo);
    const cream = onDeck && industrial && palette.plant ? palette.plant : null;
    // a place's own form for a landmark (its look's buildings.overrides): cross-gables to the water, or a curved metal roof
    const form = rectangular ? b.form ?? null : null;
    const fRise = form === "gables" ? Math.max(rise, 0.45 * box.hv) : rise;
    house(s, pts, { base, eave: floor + eaveH, rise: form === "curved" ? 0 : fRise, roof: form === "curved" ? "none" : fRise > 0 ? "gable" : "flat", walls: cream ?? walls, roofColour, box, ...(homey ? { overhang: HOUSE.overhang } : {}) });
    // a house's deck or porch on its downhill (or water) side, on some
    if (homey && hashString(b.id, 7) < HOUSE.porch) porch(s, box, { floor, side: waterSide(box, groundAt), groundAt });
    if (form === "gables") crossGables(s, box, { eave: floor + eaveH, rise: fRise, bays: b.gables ?? 4, side: waterSide(box, groundAt), walls, roofColour, trim: b.trim ?? DETAIL.trim });
    if (form === "curved") barrel(s, box, { eave: floor + eaveH, rise: b.rise ?? Math.max(1.2, 0.35 * box.hv), walls, roofColour });
    if (b.stone) band(s, pts, base, floor + (b.stoneHeight ?? 1.4), b.stone);
    const d = onDeck ? deckOf(pts, groundAt, { mlw }) : null;
    if (d) (pileDeck(s, d, { deck: floor, groundAt }), decks++, (reached += d.reached ? 1 : 0));
    if (details) facade(s, pts, { floor, eave: floor + eaveH, ...(industrial ? { ribs: cream ?? walls } : {}), windows: cls !== "shed" && !industrial, ...(b.trim ? { trim: b.trim } : {}), ...(homey ? { perWall: HOUSE.windows } : {}) });
    // a fish plant's roller doors to its deck, blue or yellow by hash
    if (d && cream) rollerDoors(s, d.building, { floor, eave: floor + eaveH, side: d.side, u: hashString(b.id, 4), colour: DECK.doors[hashString(b.id, 5) < 0.5 ? 0 : 1] });
    made++;
  }
  return { ...s.done(), made, skipped, decks, reached };
}

/** A building's footprint, simplified, and the lowest and highest ground under its corners: null where it's too small, off the grid, or not above the water. Pure. */
export function footing(b, groundAt) {
  const pts = simplify(dedupe(b.points), 0.4);
  if (pts.length < 3 || ringArea(pts) < 6) return null;
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of pts) {
    const g = groundAt(x, z);
    if (g == null) return null;
    (lo = Math.min(lo, g)), (hi = Math.max(hi, g));
  }
  return hi <= 0.2 ? null : { pts, lo, hi };
}

/** The pile decks buildingMesh draws (deckOf), for the buildings it draws at the water (`deckAbove` given, lowest ground under 1 m): their rings, so the ground under them can be coloured first. Pure. */
export function deckRings(buildings, { groundAt, leaveOut = () => false, deckAbove = null, mlw = -1.2 }) {
  if (deckAbove == null) return [];
  const out = [];
  for (const b of buildings) {
    if (leaveOut(b)) continue;
    const f = footing(b, groundAt);
    if (!f || f.lo >= 1) continue;
    const d = deckOf(f.pts, groundAt, { mlw });
    if (d) out.push(d.ring);
  }
  return out;
}

/** Which long side of a box faces the water: +1 (its +v side) or −1, the side whose middle has the lower ground. */
export function waterSide(box, groundAt) {
  const g = (sv) => groundAt(box.c[0] + box.v[0] * sv, box.c[1] + box.v[1] * sv) ?? 0;
  return g(box.hv + 3) <= g(-box.hv - 3) ? 1 : -1;
}

/**
 * Cross-gables along a gabled box's long side `side` (+1 its +v side): `bays`
 * gable bays, each a wall triangle on the facade from the eave to 0.85 of the
 * main roof's rise, a white rake trim, and two roof slopes running back into
 * the main roof (Whiskey Landing's four to the water). Returns the bays made.
 */
export function crossGables(s, box, { eave, rise, bays, side, walls, roofColour, trim }) {
  const { c, u, v, hu, hv } = box;
  const at = (su, sv, y) => [c[0] + u[0] * su + v[0] * side * sv, y, c[1] + u[1] * su + v[1] * side * sv];
  const W = rgb(walls), R = rgb(roofColour), T = rgb(trim);
  const pitch = (2 * hu) / bays, half = (pitch * 0.66) / 2, g = rise * 0.85, front = hv + 0.35;
  for (let q = 0; q < bays; q++) {
    const m = -hu + pitch * (q + 0.5);
    const out = at(m, hv + 5, eave);
    triOut(s, at(m - half, hv + 0.05, eave), at(m + half, hv + 0.05, eave), at(m, hv + 0.05, eave + g), W, out);
    // the rake trim: a band under each slope's edge
    quadOut(s, at(m - half, front, eave - 0.05), at(m, front, eave + g - 0.05), at(m, front, eave + g + 0.12), at(m - half, front, eave + 0.12), T, out);
    quadOut(s, at(m, front, eave + g - 0.05), at(m + half, front, eave - 0.05), at(m + half, front, eave + 0.12), at(m, front, eave + g + 0.12), T, out);
    // the slopes, back to the main roof's ridge line (where they're under it, the main roof hides them)
    quadUp(s, at(m - half, front, eave), at(m, front, eave + g), at(m, 0, eave + g), at(m - half, 0, eave), R);
    quadUp(s, at(m, front, eave + g), at(m + half, front, eave), at(m + half, 0, eave), at(m, 0, eave + g), R);
  }
  return bays;
}

/** A curved metal roof over a box: a half-ellipse `rise` high across its short span, 8 strips along its length, its ends closed in the walls' colour. */
export function barrel(s, box, { eave, rise, walls, roofColour, segments = 8 }) {
  const { c, u, v, hu, hv } = box;
  const at = (su, k) => {
    const t = (Math.PI * k) / segments;
    return [c[0] + u[0] * su + v[0] * hv * dcos(t), eave + rise * dsin(t), c[1] + u[1] * su + v[1] * hv * dcos(t)];
  };
  const R = rgb(roofColour), W = rgb(walls);
  for (let k = 0; k < segments; k++) {
    const t = (Math.PI * (k + 0.5)) / segments;
    const out = [c[0] + v[0] * hv * 3 * dcos(t), eave + rise * 3 * dsin(t), c[1] + v[1] * hv * 3 * dcos(t)];
    quadOut(s, at(-hu - 0.3, k), at(hu + 0.3, k), at(hu + 0.3, k + 1), at(-hu - 0.3, k + 1), R.map((x) => x * (0.85 + 0.2 * dsin(t))), out);
    for (const e of [-1, 1]) triOut(s, [c[0] + u[0] * hu * e, eave, c[1] + u[1] * hu * e], at(hu * e, k), at(hu * e, k + 1), W, [c[0] + u[0] * hu * e * 3, eave, c[1] + u[1] * hu * e * 3]);
  }
}

/** A band round a ring a hand proud of its walls (a stone base): from y0 to y1. */
export function band(s, ring, y0, y1, colour) {
  const pts = dedupe(ring);
  const ccw = signedArea(pts) > 0 ? pts : pts.slice().reverse();
  const cx = ccw.reduce((a, p) => a + p[0], 0) / ccw.length, cz = ccw.reduce((a, p) => a + p[1], 0) / ccw.length;
  const C = rgb(colour);
  for (let a = 0; a < ccw.length; a++) {
    const A = ccw[a], B = ccw[(a + 1) % ccw.length];
    let nx = B[1] - A[1], nz = -(B[0] - A[0]);
    // outward: away from the middle
    if (nx * ((A[0] + B[0]) / 2 - cx) + nz * ((A[1] + B[1]) / 2 - cz) < 0) (nx = -nx), (nz = -nz);
    const l = len(nx, nz) || 1;
    const o = 0.1, ax = A[0] + (nx / l) * o, az = A[1] + (nz / l) * o, bx = B[0] + (nx / l) * o, bz = B[1] + (nz / l) * o;
    quadOut(s, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], C, [ax + (ax - cx), y0, az + (az - cz)]);
  }
}

// ─── geometry helpers ───

/** An oriented box's four corners. */
export function rectangle({ c, u, v, hu, hv }) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + u[0] * hu * a + v[0] * hv * b, c[1] + u[1] * hu * a + v[1] * hv * b]);
}

/** A closed ring simplified (Douglas–Peucker, `tol` metres), keeping at least a triangle. */
export function simplify(ring, tol) {
  if (ring.length <= 4) return ring;
  // split at the point farthest from the first, simplify both halves as open lines
  let far = 0, best = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = len(ring[k][0] - ring[0][0], ring[k][1] - ring[0][1]);
    if (d > best) (best = d), (far = k);
  }
  const a = dp(ring.slice(0, far + 1), tol), b = dp([...ring.slice(far), ring[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : ring;
}
function dp(line, tol) {
  if (line.length <= 2) return line;
  const [x0, z0] = line[0], [x1, z1] = line.at(-1);
  const L = len(x1 - x0, z1 - z0) || 1e-9;
  let best = -1, at = 0;
  for (let k = 1; k + 1 < line.length; k++) {
    const d = Math.abs((x1 - x0) * (z0 - line[k][1]) - (x0 - line[k][0]) * (z1 - z0)) / L;
    if (d > best) (best = d), (at = k);
  }
  if (best <= tol) return [line[0], line.at(-1)];
  return [...dp(line.slice(0, at + 1), tol).slice(0, -1), ...dp(line.slice(at), tol)];
}

export function dedupe(ring) {
  let pts = ring.filter((p, k) => k === 0 || p[0] !== ring[k - 1][0] || p[1] !== ring[k - 1][1]);
  if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts = pts.slice(0, -1);
  return pts;
}

/** Signed area, positive counter-clockwise seen from above (x east, z south). */
export function signedArea(pts) {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x1, z1] = pts[k], [x2, z2] = pts[(k + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return -s / 2;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A quad a b c d wound to face up (+Y). */
export function quadUp(s, a, b, c, d, col) {
  const n = cross(sub(b, a), sub(d, a));
  if (n[1] >= 0) s.quad(a, b, c, d, col);
  else s.quad(a, d, c, b, col);
}
/** A quad wound to face toward `toward`. */
export function quadOut(s, a, b, c, d, col, toward) {
  const n = cross(sub(b, a), sub(d, a));
  const t = sub(toward, a);
  if (n[0] * t[0] + n[1] * t[1] + n[2] * t[2] >= 0) s.quad(a, b, c, d, col);
  else s.quad(a, d, c, b, col);
}
/** A triangle wound to face toward `toward`. */
export function triOut(s, a, b, c, col, toward) {
  const n = cross(sub(b, a), sub(c, a));
  const t = sub(toward, a);
  if (n[0] * t[0] + n[1] * t[1] + n[2] * t[2] >= 0) s.tri(a, b, c, col);
  else s.tri(a, c, b, col);
}

/** A flat lid over a ring at height y, facing up (earcut). */
export function lid(s, ccw, y, col) {
  const ids = earcut(ccw.flat());
  for (let t = 0; t < ids.length; t += 3) {
    const a = [ccw[ids[t]][0], y, ccw[ids[t]][1]], b = [ccw[ids[t + 1]][0], y, ccw[ids[t + 1]][1]], c = [ccw[ids[t + 2]][0], y, ccw[ids[t + 2]][1]];
    const n = cross(sub(b, a), sub(c, a));
    if (n[1] >= 0) s.tri(a, b, c, col);
    else s.tri(a, c, b, col);
  }
}
