// The shapes a die can be, as geometry. Pure, no three.js, no stage.
//
// Each shape is given only as its corners. Everything else is derived from
// them: the flat sides (the convex hull's faces, each with its outward
// normal), which sides it can come to rest on, and so its OUTCOMES: the ways
// it can lie on a table. An outcome is named by the direction that points up
// when the die lies that way, `up`, in the die's own frame: the opposite of
// the normal of the side it rests on.
//
// What an outcome is READ from differs by shape, and says where its marks go
// (marks.js):
// - "face": the side facing up, the one whose normal is `up` (a d6, d8, d10,
//   d12, d20 and a coin all have a side opposite every side they rest on);
// - "vertex": the corner pointing up (a d4, which has no side on top: each of
//   its sides carries three marks, one by each corner, and the one read is the
//   one at the top corner, upright on all three sides that meet there).
//
// The frame every shape is given in: centred on its middle, at rest on the
// table showing outcome 0 (`up` = +Y), sized so it is 1 across (below).
// Outcomes are in a fixed order: by how high `up` points, then round the
// vertical. That order is what a die doc's `faces` list is indexed by, so a
// layout (which number is next to which) is data: the same solid numbered
// two ways is two lists (die.js).
//
// "Across", the one size a die has: how high it stands at rest; for a coin,
// its diameter. A standard d6 is 16 mm across.

import { add, apply, axisAngle, cross, dot, len, rotationBetween, scale, squareTo, sub, unit } from "./m3.js";

const PHI = (1 + Math.sqrt(5)) / 2;

/** Every way of putting + or − on each non-zero part of a point. */
function signs(p) {
  let out = [[]];
  for (const v of p) out = out.flatMap((q) => (v === 0 ? [[...q, 0]] : [[...q, v], [...q, -v]]));
  return out;
}
/** The three cyclic orders of a point's parts. */
const cyclic = ([a, b, c]) => [[a, b, c], [c, a, b], [b, c, a]];

/** How many sides a coin's rim is drawn with. */
export const COIN_SIDES = 24;
/** A coin's thickness, as a part of its diameter. */
export const COIN_THICK = 0.08;

/**
 * A d10 is a pentagonal trapezohedron: ten kites, five round each pole. Its
 * corners are the two poles and ten round the middle, alternately a little
 * above and a little below it. A kite is flat only when the pole is at one
 * height for a given zigzag: with the ring at radius 1 and heights ±c, the
 * pole, the mid-point of two upper corners (radius cos 36°, height c) and the
 * lower corner between them (radius 1, height −c) lie on one line seen side
 * on, which puts the pole at c (1 + cos 36°) / (1 − cos 36°).
 */
function d10Corners() {
  const k = Math.cos(Math.PI / 5);
  const pole = 1; // as high as the ring is wide
  const c = (pole * (1 - k)) / (1 + k);
  const out = [[0, pole, 0], [0, -pole, 0]];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    out.push([Math.cos(a), i % 2 ? -c : c, Math.sin(a)]);
  }
  return out;
}

function coinCorners() {
  const out = [];
  for (const y of [COIN_THICK, -COIN_THICK]) {
    for (let i = 0; i < COIN_SIDES; i++) {
      const a = (i * 2 * Math.PI) / COIN_SIDES;
      out.push([Math.cos(a), y, Math.sin(a)]);
    }
  }
  return out;
}

/**
 * The shapes. `corners`: the solid, centred on its middle, any size and any
 * way up. `read`: what an outcome is read from. `aim`: which way a mark's top
 * points on a side by default: at a corner of it, or at the middle of an edge
 * (a square's numbers stand square to it), or neither (a round side).
 * `rests`: which sides it can come to rest on (default: every one).
 */
const SPECS = {
  d4: { name: "d4", sides: 4, read: "vertex", aim: "vertex", corners: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] },
  d6: { name: "d6", sides: 6, read: "face", aim: "edge", corners: () => signs([1, 1, 1]) },
  d8: { name: "d8", sides: 8, read: "face", aim: "vertex", corners: () => cyclic([1, 0, 0]).flatMap(signs) },
  d10: { name: "d10", sides: 10, read: "face", aim: "vertex", corners: d10Corners },
  d12: { name: "d12", sides: 12, read: "face", aim: "vertex", corners: () => [...signs([1, 1, 1]), ...cyclic([0, 1 / PHI, PHI]).flatMap(signs)] },
  d20: { name: "d20", sides: 20, read: "face", aim: "vertex", corners: () => cyclic([0, 1, PHI]).flatMap(signs) },
  // a coin never comes to rest on its rim
  coin: { name: "Coin", sides: 2, read: "face", aim: "none", across: "diameter", corners: coinCorners, rests: (poly) => poly.verts.length > 4 },
};

/** The shapes' ids, in the order they're offered. */
export const SHAPES = Object.freeze(Object.keys(SPECS));
/** A shape's name for people. */
export const shapeName = (shape) => SPECS[shape]?.name ?? null;
/** How many outcomes a shape has. */
export const shapeSides = (shape) => SPECS[shape]?.sides ?? 0;

/**
 * The flat sides of a convex solid, from its corners alone: every plane
 * through three corners that has all the others on one side of it, once, with
 * every corner that lies in it, in order round the outward normal
 * (anticlockwise seen from outside).
 * @param {number[][]} verts  centred on the solid's middle
 * @returns {{ verts: number[], normal: number[], d: number }[]}  d: how far the side is from the middle
 */
export function hullFaces(verts) {
  const size = Math.max(...verts.map(len)) || 1;
  const tol = size * 1e-7;
  const seen = new Set();
  const out = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let normal = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (len(normal) < size * size * 1e-9) continue; // three in a line
    normal = unit(normal);
    let d = dot(normal, verts[i]);
    if (d < 0) {
      normal = scale(normal, -1);
      d = -d;
    }
    if (d < tol) continue; // through the middle: no side
    let outside = false;
    const on = [];
    for (let v = 0; v < n; v++) {
      const h = dot(normal, verts[v]) - d;
      if (h > tol) {
        outside = true;
        break;
      }
      if (h > -tol) on.push(v);
    }
    if (outside) continue;
    const key = on.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    // in order round the normal: e1 × e2 = normal, so rising angle is anticlockwise from outside
    const c = scale(on.reduce((s, v) => add(s, verts[v]), [0, 0, 0]), 1 / on.length);
    const e1 = squareTo(normal);
    const e2 = cross(normal, e1);
    const angle = (v) => Math.atan2(dot(sub(verts[v], c), e2), dot(sub(verts[v], c), e1));
    on.sort((a, b) => angle(a) - angle(b));
    out.push({ verts: on, normal, d });
  }
  return out;
}

const near = (a, b, tol = 1e-6) => len(sub(a, b)) < tol;

const cache = new Map();

/**
 * A shape as a solid, in the frame the header gives.
 * @param {string} shape  one of SHAPES
 * @returns {{
 *   shape: string, name: string, read: "face" | "vertex", aim: "vertex" | "edge" | "none",
 *   verts: number[][],                                    // 1 across, centred
 *   polys: { verts: number[], normal: number[], d: number }[],   // every flat side
 *   outcomes: { up: number[], rest: number, poly: number, readPoly: number | null, readVert: number | null, opposite: number | null }[],
 * } | null}
 *   An outcome: `up`; `rest`, how far its middle is above the table lying that
 *   way; `poly`, the side it rests on; `readPoly`, the side facing up, or
 *   `readVert`, the corner pointing up; `opposite`, the outcome shown when
 *   it's turned over, if there is one.
 */
export function solid(shape) {
  if (!Object.hasOwn(SPECS, shape)) return null;
  if (!cache.has(shape)) cache.set(shape, freeze(build(shape, SPECS[shape])));
  return cache.get(shape);
}

function build(shape, spec) {
  let verts = spec.corners();
  const canRest = spec.rests ?? (() => true);
  // set it down on the first side it can rest on, so outcome 0 is up
  const first = hullFaces(verts).find(canRest);
  let turn = rotationBetween(scale(first.normal, -1), [0, 1, 0]);
  verts = verts.map((v) => apply(turn, v));
  // then turn it about the vertical so the mark on top has its top towards −Z
  // (it reads the right way up from the +Z side, looking down)
  if (spec.aim !== "none") {
    const polys = hullFaces(verts);
    const top = spec.read === "face" ? polys.find((p) => near(p.normal, [0, 1, 0])) : polys.find((p) => near(p.normal, [0, -1, 0]));
    const p = spec.aim === "edge" ? scale(add(verts[top.verts[0]], verts[top.verts[1]]), 0.5) : verts[top.verts[0]];
    // about +Y by θ takes the heading atan2(x, −z) to that minus θ
    turn = axisAngle([0, 1, 0], Math.atan2(p[0], -p[2]));
    verts = verts.map((v) => apply(turn, v));
  }
  // 1 across
  const ys = verts.map((v) => v[1]);
  const across = spec.across === "diameter" ? 2 * Math.max(...verts.map((v) => Math.hypot(v[0], v[2]))) : Math.max(...ys) - Math.min(...ys);
  verts = verts.map((v) => v.map((x) => x / across + 0)); // (+ 0: no −0)
  const polys = hullFaces(verts);

  const round = (x) => Math.round(x * 1e6);
  const heading = (u) => (Math.hypot(u[0], u[2]) < 1e-6 ? 0 : (Math.atan2(u[2], u[0]) + 2 * Math.PI) % (2 * Math.PI));
  const outcomes = polys
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => canRest(p))
    .map(({ p, i }) => ({ up: scale(p.normal, -1).map((x) => x + 0), rest: p.d, poly: i }))
    .sort((a, b) => round(b.up[1]) - round(a.up[1]) || round(heading(a.up)) - round(heading(b.up)));
  for (const o of outcomes) {
    const readPoly = polys.findIndex((p) => near(p.normal, o.up));
    const readVert = verts.findIndex((v) => near(unit(v), o.up));
    o.readPoly = spec.read === "face" && readPoly >= 0 ? readPoly : null;
    o.readVert = spec.read === "vertex" && readVert >= 0 ? readVert : null;
    const opposite = outcomes.findIndex((q) => near(q.up, scale(o.up, -1)));
    o.opposite = opposite >= 0 ? opposite : null;
  }
  return { shape, name: spec.name, read: spec.read, aim: spec.aim, verts, polys, outcomes };
}

function freeze(x) {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}

/** The outcomes whose read side shares an edge with outcome `i`'s (a face-read solid): what a die can tip to in one step. */
export function neighbours(s, i) {
  const mine = s.polys[s.outcomes[i].readPoly ?? s.outcomes[i].poly].verts;
  const out = [];
  s.outcomes.forEach((o, j) => {
    if (j === i) return;
    const theirs = s.polys[o.readPoly ?? o.poly].verts;
    if (theirs.filter((v) => mine.includes(v)).length === 2) out.push(j);
  });
  return out;
}

/** A solid's box, 1 across, standing on y = 0 showing outcome 0: { min, max }. */
export function standingBounds(s) {
  const h = s.outcomes[0].rest;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of s.verts) {
    const p = [v[0], v[1] + h, v[2]];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max };
}
