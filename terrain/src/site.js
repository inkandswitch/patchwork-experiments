// A place's own structures, drawn from data in its Terrain doc (`site`,
// `landmarks`): what open data can't shape (README, "Ucluelet": the
// boatyard at 1970 Harbour Crescent from the as-built survey and Rising
// Tide's public plans; landmarks such as a squat lighthouse or a radar
// dome). Each structure is plain data, lat/lon and heights about mean
// water, with where it comes from and what is assumed; this file only
// knows kinds of things (a hangar, a box of a building, a pile wharf, a
// fixed pier, a haul-out pier, a travel lift, a ramp, a floating dock with
// a solar canopy, a charger, a lighthouse, a dome), never a particular
// place. Each kind's geometry is generic; its sizes come from the data.
//
// Pure.

import { soup, rgb, widen, cylinder, prism } from "./shapes.js";
import { house, quadOut, quadUp, triOut, orientedBox } from "./buildings.js";
import { hash01 } from "./palette.js";
import { len, dsin, dcos } from "./detmath.js";

const unit = (a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = len(dx, dz);
  return [dx / l, dz / l, l];
};
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mid = (a, b) => lerp2(a, b, 0.5);

/**
 * Everything a site and its landmarks draw: { layers: { [layerId]: { positions, colors } }, made: [{ id, kind, layer }], replaces: Set of OSM ids, measures }.
 * @param {{ structures: object[] } | null} site
 * @param {object[]} landmarks
 * @param {{ toLocal(lat, lon): [number, number] }} frame
 * @param {(x: number, z: number) => number | null} groundAt  metres about MWL (null off the grid)
 * @param {(h: number) => number} sinkAt  how far below the ground a foundation must reach for the drawn ground not to show under it
 */
export function siteMesh(site, landmarks, frame, groundAt, sinkAt) {
  const soups = new Map();
  const of = (layer) => {
    if (!soups.has(layer)) soups.set(layer, soup());
    return soups.get(layer);
  };
  // to the millimetre: the projection's last bits may differ between engines (its Math.sin, Math.atan…), the GLB mustn't
  const L = ([lat, lon]) => frame.toLocal(lat, lon).map((v) => Math.round(v * 1000) / 1000);
  const ground = (x, z) => groundAt(x, z) ?? 0;
  const footOf = (pts) => Math.min(...pts.map(([x, z]) => ground(x, z) - sinkAt(ground(x, z))));
  const byId = new Map((site?.structures ?? []).map((s) => [s.id, s]));
  const made = [], measures = {};
  for (const st of site?.structures ?? []) {
    const s = of(st.layer ?? "site");
    const draw = KINDS[st.kind];
    if (!draw) continue;
    const m = draw(s, st, { L, ground, footOf, sinkAt, byId });
    made.push({ id: st.id, kind: st.kind, layer: st.layer ?? "site" });
    if (m) measures[st.id] = m;
  }
  const replaces = new Set();
  for (const lm of landmarks ?? []) {
    const draw = KINDS[lm.kind];
    if (!draw) continue;
    const [x, z] = L(lm.at);
    if (groundAt(x, z) == null) continue;
    const m = draw(of(lm.layer ?? "landmarks"), lm, { L, ground, footOf, sinkAt, byId });
    made.push({ id: lm.id, kind: lm.kind, layer: lm.layer ?? "landmarks" });
    if (m) measures[lm.id] = m;
    if (lm.replaces) replaces.add(lm.replaces);
  }
  const layers = {};
  for (const [id, s] of soups) if (s.count) layers[id] = s.done();
  return { layers, made, replaces, measures };
}

/**
 * A door face's sliding leaves, about `count` of them over main.from…main.to
 * (metres along the face), none over the small door: the stretches either
 * side of it share the leaves by length, at least one each. → [[d0, d1], …]
 * in order along the face.
 */
export function doorLeaves(main, small, count) {
  const runs = small && small.to > main.from && small.from < main.to ? [[main.from, small.from], [small.to, main.to]].filter(([a, b]) => b - a > 0.01) : [[main.from, main.to]];
  const total = runs.reduce((t, [a, b]) => t + (b - a), 0);
  const out = [];
  for (const [a, b] of runs) {
    const k = Math.max(1, Math.round((count * (b - a)) / total));
    for (let q = 0; q < k; q++) out.push([a + ((b - a) * q) / k, a + ((b - a) * (q + 1)) / k]);
  }
  return out;
}

/** A box (an oriented rectangle in plan) from y0 to y1: { c, u, hu, hv } as buildings.js orientedBox, walls and both lids. */
function block(s, c, u, hu, hv, y0, y1, hex) {
  const v = [-u[1], u[0]];
  const at = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b];
  return prism(s, [at(-hu, -hv), at(hu, -hv), at(hu, hv), at(-hu, hv)], y0, y1, hex);
}

/** A sloping slab along a line (a ramp, a gangway): `width` wide, its top from y0 at the start to y1 at the end, `thick` deep. */
function ramp(s, a, b, width, y0, y1, thick, hex) {
  const [ux, uz] = unit(a, b);
  const v = [-uz * (width / 2), ux * (width / 2)];
  const P = (p, dv, y) => [p[0] + v[0] * dv, y, p[1] + v[1] * dv];
  const c = rgb(hex), side = c.map((x) => x * 0.8);
  quadUp(s, P(a, -1, y0), P(b, -1, y1), P(b, 1, y1), P(a, 1, y0), c);
  quadUp(s, P(a, 1, y0 - thick), P(b, 1, y1 - thick), P(b, -1, y1 - thick), P(a, -1, y0 - thick), c);
  const mid3 = [(a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2];
  for (const dv of [-1, 1]) quadOut(s, P(a, dv, y0 - thick), P(b, dv, y1 - thick), P(b, dv, y1), P(a, dv, y0), side, [mid3[0] + v[0] * dv * 4, mid3[1], mid3[2] + v[1] * dv * 4]);
}

/** Piles along a line every `every` metres, at offsets `across` from it, from below the bottom to `top`. */
function piles(s, a, b, every, across, top, ground, hex, r = 0.18) {
  const [ux, uz, span] = unit(a, b);
  const v = [-uz, ux];
  const count = Math.max(1, Math.round(span / every));
  for (let q = 0; q <= count; q++) {
    const p = lerp2(a, b, q / count);
    for (const o of across) {
      const x = p[0] + v[0] * o, z = p[1] + v[1] * o;
      const g = ground(x, z);
      if (g >= top - 0.2) continue; // on land: no pile shows
      cylinder(s, x, z, g - 1, top, r, r, hex, 6);
    }
  }
}

/**
 * Corrugated cladding and trim over a building's walls (art direction: a
 * plain box reads as a placeholder): a darker rib every `every` metres
 * standing 4 cm off each wall from `y0` to `y1`, and a trim band 0.3 m deep
 * under the eave, 6 cm off. `P` is the ring of corners, either way round.
 */
export function cladding(s, P, y0, y1, { walls, trim, every = 0.9 }) {
  const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cz = P.reduce((a, p) => a + p[1], 0) / P.length;
  const rib = rgb(walls).map((x) => x * 0.72), band = rgb(trim);
  const strip = (A, B, off, ya, yb, col) => {
    const m = mid(A, B);
    // the wall's own normal, the side away from the middle
    const [ux, uz] = unit(A, B);
    const side = (m[0] - cx) * -uz + (m[1] - cz) * ux >= 0 ? 1 : -1;
    const o = [-uz * side, ux * side];
    const a = [A[0] + o[0] * off, A[1] + o[1] * off], b = [B[0] + o[0] * off, B[1] + o[1] * off];
    quadOut(s, [a[0], ya, a[1]], [b[0], ya, b[1]], [b[0], yb, b[1]], [a[0], yb, a[1]], col, [m[0] + o[0] * 5, (ya + yb) / 2, m[1] + o[1] * 5]);
  };
  let ribs = 0;
  for (let k = 0; k < P.length; k++) {
    const A = P[k], B = P[(k + 1) % P.length];
    const L = len(B[0] - A[0], B[1] - A[1]);
    const n = Math.floor(L / every);
    for (let q = 1; q < n; q++) {
      const t0 = (q * every - 0.12) / L, t1 = (q * every + 0.12) / L;
      strip(lerp2(A, B, t0), lerp2(A, B, t1), 0.04, y0, y1 - 0.3, rib);
      ribs++;
    }
    strip(A, B, 0.06, y1 - 0.3, y1, band);
  }
  return ribs;
}

export const KINDS = {
  /** A hangar: a low gable over four corners (N, E, S, W), the gables on the faces doors.face and the one opposite; board-sheathed walls; sliding doors and a header band on the door face. */
  hangar(s, st, { L, footOf }) {
    const P = st.corners.map(L);
    const C = st.colours;
    const f = st.doors?.face ?? 3; // the door face runs P[f] → P[f+1]
    const g0 = P[f], g1 = P[(f + 1) % 4], o0 = P[(f + 2) % 4], o1 = P[(f + 3) % 4];
    const ridgeA = mid(g0, g1), ridgeB = mid(o0, o1);
    const [ux, uz, length] = unit(ridgeA, ridgeB);
    const span = len(g1[0] - g0[0], g1[1] - g0[1]);
    const c = mid(ridgeA, ridgeB);
    const box = { c, u: [ux, uz], v: [-uz, ux], hu: length / 2, hv: span / 2 };
    const foot = footOf(P);
    // the slab and foundation
    prism(s, P, foot, st.floor, C.slab);
    // walls, as boards: vertical strips about 1.2 m wide, three weathered tones by hash
    for (let a = 0; a < 4; a++) {
      const A = P[a], B = P[(a + 1) % 4];
      const el = unit(A, B)[2];
      const strips = Math.max(1, Math.round(el / 1.2));
      // outward: away from the middle
      const m = mid(A, B);
      const ol = len(m[0] - c[0], m[1] - c[1]);
      const out = [(m[0] - c[0]) / ol, (m[1] - c[1]) / ol];
      for (let q = 0; q < strips; q++) {
        const p0 = lerp2(A, B, q / strips), p1 = lerp2(A, B, (q + 1) / strips);
        const col = rgb(C.walls[Math.floor(hash01(a * 997 + q, 5) * C.walls.length)]);
        quadOut(s, [p0[0], st.floor, p0[1]], [p1[0], st.floor, p1[1]], [p1[0], st.eave, p1[1]], [p0[0], st.eave, p0[1]], col, [(p0[0] + p1[0]) / 2 + out[0] * 5, st.floor + 1, (p0[1] + p1[1]) / 2 + out[1] * 5]);
      }
    }
    // the gable ends
    const rise = st.ridge - st.eave;
    const at = (su, sv, y) => [c[0] + box.u[0] * su + box.v[0] * sv, y, c[1] + box.u[1] * su + box.v[1] * sv];
    triOut(s, at(-box.hu, -box.hv, st.eave), at(-box.hu, box.hv, st.eave), at(-box.hu, 0, st.ridge), rgb(C.header), at(-box.hu - 5, 0, st.eave));
    triOut(s, at(box.hu, -box.hv, st.eave), at(box.hu, box.hv, st.eave), at(box.hu, 0, st.ridge), rgb(C.walls[0]), at(box.hu + 5, 0, st.eave));
    // the roof: overhangs 0.6 m at the sides, 1.2 m over the door face (the survey's dashed ROOF OH; its offset isn't dimensioned)
    const r = rgb(C.roof);
    const sideOh = 0.6, frontOh = 1.2, backOh = 0.4;
    const drop = (sideOh * rise) / box.hv;
    const u0 = -box.hu - frontOh, u1 = box.hu + backOh;
    quadUp(s, at(u0, -box.hv - sideOh, st.eave - drop), at(u1, -box.hv - sideOh, st.eave - drop), at(u1, 0, st.ridge), at(u0, 0, st.ridge), r);
    quadUp(s, at(u1, box.hv + sideOh, st.eave - drop), at(u0, box.hv + sideOh, st.eave - drop), at(u0, 0, st.ridge), at(u1, 0, st.ridge), r);
    // the roof's underside, so it reads as a roof from below
    quadUp(s, at(u0, 0, st.ridge - 0.25), at(u1, 0, st.ridge - 0.25), at(u1, -box.hv - sideOh, st.eave - drop - 0.25), at(u0, -box.hv - sideOh, st.eave - drop - 0.25), r.map((x) => x * 0.5));
    // fascia trim along the eaves
    const t = rgb(C.trim);
    for (const sv of [-1, 1]) quadOut(s, at(u0, sv * (box.hv + sideOh), st.eave - drop - 0.3), at(u1, sv * (box.hv + sideOh), st.eave - drop - 0.3), at(u1, sv * (box.hv + sideOh), st.eave - drop), at(u0, sv * (box.hv + sideOh), st.eave - drop), t, at(0, sv * (box.hv + 10), st.eave));
    // the rake trim up both gables' roof edges, white, so the low pitch reads
    for (const uu of [u0, u1]) for (const sv of [-1, 1]) {
      const lo = at(uu, sv * (box.hv + sideOh), st.eave - drop), hi = at(uu, 0, st.ridge);
      quadOut(s, [lo[0], lo[1] - 0.35, lo[2]], [hi[0], hi[1] - 0.35, hi[2]], hi, lo, t, at(uu + (uu < 0 ? -10 : 10), sv * box.hv * 0.5, st.eave));
    }
    // the door face: the header band from the door head to the eave, the sliding leaves below it, the small door
    const D = st.doors;
    const along = (d) => lerp2(g0, g1, d / span);
    const outN = [-box.u[0], -box.u[1]];
    const face = (d0, d1, y0, y1, off, hex) => {
      const p0 = along(d0), p1 = along(d1);
      const q0 = [p0[0] + outN[0] * off, p0[1] + outN[1] * off], q1 = [p1[0] + outN[0] * off, p1[1] + outN[1] * off];
      quadOut(s, [q0[0], y0, q0[1]], [q1[0], y0, q1[1]], [q1[0], y1, q1[1]], [q0[0], y1, q0[1]], rgb(hex), [(q0[0] + q1[0]) / 2 + outN[0] * 5, y0 + 1, (q0[1] + q1[1]) / 2 + outN[1] * 5]);
    };
    face(0, span, st.floor + D.main.head, st.eave, 0.05, C.header);
    const leaves = doorLeaves(D.main, D.small, 8);
    leaves.forEach(([d0, d1], q) => face(d0 + 0.03, d1 - 0.03, st.floor, st.floor + D.main.head - 0.05, 0.12 + (q % 2) * 0.1, C.doors[Math.floor(hash01(q, 9) * C.doors.length)]));
    if (D.small) face(D.small.from, D.small.to, st.floor, st.floor + D.small.head, 0.3, "#2f2a26");
    return { length, span, area: length * span, floor: st.floor, eave: st.eave, ridge: st.ridge, pitch: (Math.atan(rise / box.hv) * 180) / Math.PI, doorHead: D.main.head, leaves, small: D.small ? [D.small.from, D.small.to] : null, bearing: ((Math.atan2(ux, -uz) * 180) / Math.PI + 360) % 360 };
  },

  /** A building on four corners: walls and a flat, gable or mono-pitch roof (buildings.js house). */
  box(s, st, { L, footOf }) {
    const P = st.corners.map(L);
    const foot = footOf(P);
    const eave = st.eave ?? (st.roof === "flat" ? st.top : st.top - 1);
    const box = orientedBox(P);
    const b = st.roof === "shed" ? { ...box, u: unit(P[0], P[1]).slice(0, 2), v: (() => { const [x, z] = unit(P[0], P[1]); return [-z, x]; })(), hu: len(P[1][0] - P[0][0], P[1][1] - P[0][1]) / 2, hv: len(P[2][0] - P[1][0], P[2][1] - P[1][1]) / 2, c: [(P[0][0] + P[2][0]) / 2, (P[0][1] + P[2][1]) / 2] } : box;
    house(s, P, { base: foot, eave, rise: st.top - eave, roof: st.roof, walls: st.colours.walls, roofColour: st.colours.roof, overhang: 0.3, box: b });
    const ribs = st.cladding === "corrugated" ? cladding(s, P, foot, eave, { walls: st.colours.walls, trim: st.colours.trim ?? st.colours.roof }) : 0;
    return { top: st.top, eave, ...(ribs ? { ribs } : {}) };
  },

  /** A pile wharf: a deck on its corners, piles every 4 m beneath, and a shed on it. */
  wharf(s, st, { L, ground }) {
    const P = st.corners.map(L);
    prism(s, P, st.deck - 0.6, st.deck, st.colours.deck);
    const box = orientedBox(P);
    // the outer end is the one further from the shore: the end whose middle is lowest
    const endA = [box.c[0] + box.u[0] * box.hu, box.c[1] + box.u[1] * box.hu], endB = [box.c[0] - box.u[0] * box.hu, box.c[1] - box.u[1] * box.hu];
    const out = ground(...endA) < ground(...endB) ? 1 : -1;
    const u = [box.u[0] * out, box.u[1] * out];
    const rows = Math.max(1, Math.round((2 * box.hv) / 4));
    for (let q = 0; q <= rows; q++) {
      const sv = -box.hv + (2 * box.hv * q) / rows;
      const a = [box.c[0] - u[0] * box.hu + box.v[0] * sv, box.c[1] - u[1] * box.hu + box.v[1] * sv], b = [box.c[0] + u[0] * box.hu + box.v[0] * sv, box.c[1] + u[1] * box.hu + box.v[1] * sv];
      piles(s, a, b, 4, [0], st.deck - 0.6, ground, st.colours.piles, 0.17);
    }
    if (st.shed) {
      const [a0, a1] = st.shed.along, [c0, c1] = st.shed.across;
      const su0 = -box.hu + 2 * box.hu * a0, su1 = -box.hu + 2 * box.hu * a1, sv0 = -box.hv + 2 * box.hv * c0, sv1 = -box.hv + 2 * box.hv * c1;
      const at = (su, sv) => [box.c[0] + u[0] * su + box.v[0] * sv, box.c[1] + u[1] * su + box.v[1] * sv];
      const ring = [at(su0, sv0), at(su1, sv0), at(su1, sv1), at(su0, sv1)];
      house(s, ring, { base: st.deck, eave: st.deck + st.shed.height, rise: 0.8, roof: "gable", walls: st.shed.colour, roofColour: st.shed.roof, overhang: 0.3 });
      if (st.shed.cladding === "corrugated") cladding(s, ring, st.deck, st.deck + st.shed.height, { walls: st.shed.colour, trim: st.shed.trim ?? st.shed.roof });
    }
    return { length: 2 * box.hu, width: 2 * box.hv, deck: st.deck };
  },

  /** A fixed pier along a line: a deck `width` wide on bents of two piles every 4 m. */
  pier(s, st, { L, ground }) {
    const line = st.line.map(L);
    prism(s, widen(line, st.width), st.deck - 0.5, st.deck, st.colours.deck);
    for (let q = 0; q + 1 < line.length; q++) piles(s, line[q], line[q + 1], 4, [-st.width / 2 + 0.3, st.width / 2 - 0.3], st.deck - 0.5, ground, st.colours.piles);
    return { length: unit(line[0], line.at(-1))[2], width: st.width, deck: st.deck };
  },

  /** A haul-out pier: concrete runway walls along each line, piles beneath, perforated screens on their outer faces. */
  haulout(s, st, { L, ground }) {
    const lines = st.runways.map((r) => r.map(L));
    const toe = -2.6;
    const centre = mid(mid(lines[0][0], lines[0][1]), mid(lines[1][0], lines[1][1]));
    for (const line of lines) {
      prism(s, widen(line, st.width), toe, st.deck, st.colours.concrete);
      piles(s, line[0], line[1], 4, [0], toe, ground, st.colours.piles, 0.3);
      // the screen on the outer face, from the deck down toward the water
      const [ux, uz, runLength] = unit(line[0], line[1]);
      let v = [-uz, ux];
      const m = mid(line[0], line[1]);
      if ((m[0] - centre[0]) * v[0] + (m[1] - centre[1]) * v[1] < 0) v = [-v[0], -v[1]];
      const off = st.width / 2 + 0.06;
      const panels = Math.max(1, Math.round(runLength / 3));
      for (let q = 0; q < panels; q++) {
        const p0 = lerp2(line[0], line[1], q / panels + 0.01), p1 = lerp2(line[0], line[1], (q + 1) / panels - 0.01);
        if (ground(...p0) > st.deck - 1 && ground(...p1) > st.deck - 1) continue; // on land
        const A = [p0[0] + v[0] * off, p0[1] + v[1] * off], B = [p1[0] + v[0] * off, p1[1] + v[1] * off];
        quadOut(s, [A[0], st.deck - 2.8, A[1]], [B[0], st.deck - 2.8, B[1]], [B[0], st.deck - 0.2, B[1]], [A[0], st.deck - 0.2, A[1]], rgb(st.colours.screen), [A[0] + v[0] * 5, st.deck, A[1] + v[1] * 5]);
      }
    }
    const lengths = lines.map((l) => unit(l[0], l[1])[2]);
    const spacing = len(mid(...lines[0])[0] - mid(...lines[1])[0], mid(...lines[0])[1] - mid(...lines[1])[1]);
    const bearing = ((Math.atan2(unit(...lines[0])[0], -unit(...lines[0])[1]) * 180) / Math.PI + 360) % 360;
    return { lengths, spacing, well: spacing - st.width, width: st.width, deck: st.deck, bearing };
  },

  /** A travel lift standing on a haul-out pier's runways: four legs on wheels, side beams, end beams, slings. */
  travelift(s, st, { byId, L }) {
    const pier = byId.get(st.on);
    if (!pier) return null;
    const lines = pier.runways.map((r) => r.map(L));
    const a = lerp2(lines[0][0], lines[0][1], st.at), b = lerp2(lines[1][0], lines[1][1], st.at);
    const c = mid(a, b);
    const [ux, uz] = unit(lines[0][0], lines[0][1]);
    const across = unit(a, b);
    const half = across[2] / 2;
    const v = [across[0], across[1]];
    const { length, height, clear } = st.size;
    const deck = pier.deck;
    const at = (su, sv) => [c[0] + ux * su + v[0] * sv, c[1] + uz * su + v[1] * sv];
    const C = st.colours;
    for (const su of [-length / 2, length / 2]) {
      for (const sv of [-half, half]) {
        const p = at(su, sv);
        // a wheel, then the leg
        block(s, p, [ux, uz], 0.7, 0.45, deck, deck + 1.1, C.wheels);
        block(s, p, [ux, uz], 0.35, 0.35, deck + 1.1, deck + height - 1.1, C.frame);
      }
    }
    // side beams along each runway, end beams across (the boat comes in under the open end, toward the water)
    for (const sv of [-half, half]) block(s, at(0, sv), [ux, uz], length / 2 + 0.4, 0.45, deck + height - 1.2, deck + height, C.frame);
    block(s, at(-length / 2, 0), [ux, uz], 0.45, half + 0.45, deck + clear, deck + height - 1.2, C.frame);
    // slings, hanging from the side beams into the well
    for (const su of [-2.2, 2.2]) for (const sv of [-half + 0.5, half - 0.5]) block(s, at(su, sv), [ux, uz], 0.12, 0.08, deck - 2.5, deck + height - 1.2, C.slings);
    return { length, height, clear, gauge: across[2] };
  },

  /** A sloping deck along a line: a launch ramp, a gangway. */
  ramp(s, st, { L }) {
    const [a, b] = st.line.map(L);
    ramp(s, a, b, st.width, st.from, st.to, 0.35, st.colours.deck);
    return { length: unit(a, b)[2], width: st.width };
  },

  /** A floating dock along a line, guide piles both sides, a solar canopy on posts over it. */
  dock(s, st, { L, ground }) {
    const line = st.line.map(L);
    prism(s, widen(line, st.width), -0.6, st.top, st.colours.deck);
    const [a, b] = [line[0], line.at(-1)];
    const [ux, uz, armLength] = unit(a, b);
    const v = [-uz, ux];
    // guide piles off both sides
    piles(s, a, b, st.guidePiles.every, [-(st.width / 2 + 0.35), st.width / 2 + 0.35], 5.5, ground, st.guidePiles.colour, 0.2);
    // the canopy: posts along the north edge, a panel over the deck, tilted a little toward the sun (south)
    if (st.canopy) {
      const K = st.canopy;
      const north = v[1] < 0 ? 1 : -1; // the side whose z is smaller
      const posts = Math.max(1, Math.round(armLength / K.every));
      const yTop = st.top + K.height;
      for (let q = 0; q <= posts; q++) {
        const p = lerp2(a, b, q / posts);
        const px = p[0] + v[0] * north * (st.width / 2 - 0.25), pz = p[1] + v[1] * north * (st.width / 2 - 0.25);
        cylinder(s, px, pz, st.top, yTop + 0.3, 0.1, 0.1, K.frame, 6);
      }
      const P = (t, sv, y) => [a[0] + (b[0] - a[0]) * t + v[0] * sv, y, a[1] + (b[1] - a[1]) * t + v[1] * sv];
      const hiSide = north * (K.width / 2), loSide = -north * (K.width / 2);
      quadUp(s, P(0, hiSide, yTop + 0.35), P(1, hiSide, yTop + 0.35), P(1, loSide, yTop - 0.15), P(0, loSide, yTop - 0.15), rgb(K.colour));
      quadUp(s, P(1, hiSide, yTop + 0.2), P(0, hiSide, yTop + 0.2), P(0, loSide, yTop - 0.3), P(1, loSide, yTop - 0.3), rgb(K.frame).map((x) => x * 0.6));
    }
    return { length: armLength, width: st.width, top: st.top, bearing: ((Math.atan2(ux, -uz) * 180) / Math.PI + 360) % 360 };
  },

  /** A charging pedestal on a dock, at the point on its line nearest `at`, on the dock's south edge. */
  charger(s, st, { L, byId }) {
    const dock = byId.get(st.on);
    if (!dock) return null;
    const [a, b] = [L(dock.line[0]), L(dock.line.at(-1))];
    const p = L(st.at);
    const [ux, uz, armLength] = unit(a, b);
    const t = Math.max(0, Math.min(armLength, (p[0] - a[0]) * ux + (p[1] - a[1]) * uz));
    const v = [-uz, ux];
    const south = v[1] > 0 ? 1 : -1;
    const c = [a[0] + ux * t + v[0] * south * (dock.width / 2 - 0.45), a[1] + uz * t + v[1] * south * (dock.width / 2 - 0.45)];
    block(s, c, [ux, uz], 0.3, 0.2, dock.top, dock.top + 1.7, st.colours.body);
    block(s, [c[0] + v[0] * south * 0.21, c[1] + v[1] * south * 0.21], [ux, uz], 0.22, 0.02, dock.top + 1.1, dock.top + 1.55, st.colours.face);
    return { along: t, height: 1.7 };
  },

  /** A squat lighthouse: a square base, a square tower, a balcony, a lantern and its roof. */
  "squat-lighthouse"(s, lm, { L, ground, sinkAt }) {
    const [x, z] = L(lm.at);
    const g = ground(x, z);
    const Z = lm.size, C = lm.colours;
    block(s, [x, z], [1, 0], Z.base / 2, Z.base / 2, g - sinkAt(g) - 1, g + Z.baseHeight, C.walls);
    block(s, [x, z], [1, 0], Z.tower / 2, Z.tower / 2, g + Z.baseHeight, g + Z.towerHeight, C.walls);
    block(s, [x, z], [1, 0], Z.tower / 2 + 0.6, Z.tower / 2 + 0.6, g + Z.towerHeight, g + Z.towerHeight + 0.25, C.balcony);
    cylinder(s, x, z, g + Z.towerHeight + 0.25, g + Z.towerHeight + 0.25 + Z.lanternHeight, Z.lantern, Z.lantern, C.lantern, 8);
    cylinder(s, x, z, g + Z.towerHeight + 0.25 + Z.lanternHeight, g + Z.towerHeight + 1.2 + Z.lanternHeight, Z.lantern * 1.15, 0, C.roof, 8);
    return { ground: g, top: g + Z.towerHeight + 1.2 + Z.lanternHeight };
  },

  /** A radome on a drum. */
  dome(s, lm, { L, ground, sinkAt }) {
    const [x, z] = L(lm.at);
    const g = ground(x, z);
    const { radius, drum } = lm.size;
    cylinder(s, x, z, g - sinkAt(g) - 1, g + drum, radius * 0.92, radius * 0.92, lm.colours.drum, 16);
    const rings = 6;
    for (let q = 0; q < rings; q++) {
      const a0 = (q / rings) * (Math.PI / 2), a1 = ((q + 1) / rings) * (Math.PI / 2);
      cylinder(s, x, z, g + drum + radius * dsin(a0), g + drum + radius * dsin(a1), radius * dcos(a0), q === rings - 1 ? 0 : radius * dcos(a1), lm.colours.dome, 16);
    }
    return { ground: g, top: g + drum + radius };
  },
};

/** Whether a point (lat, lon) is inside a { south, west, north, east } box. */
export const inBox = (box, lat, lon) => lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
