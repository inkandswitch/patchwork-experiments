// What's drawn on a die's faces, as flat line art. Pure: no DOM, no three.js.
//
// A mark (die.js: a number, spots, a short text, a symbol) becomes STROKES
// (polylines of one width, round at every joint and end) and DISCS, in its
// own box. A face's marks are set side by side, fitted inside a circle on
// the face and turned as the face says. The same art is lifted onto the
// solid for its GLB (die-glb.js) and drawn flat in the 2D panel (tool.js),
// so the panel shows exactly what the scene will.
//
// The art is this package's own: a plain stroke alphabet on a 4 × 6 grid and
// a handful of symbols on a 2 × 2 one.

import { add, cross, dot, scale, sub, unit } from "./m3.js";

/** A stroke's width, as a part of a mark's height. */
export const STROKE = 0.13;

// Numerals, capitals and a little punctuation: polylines on a 4 × 6 grid, y up.
const FONT = {
  0: ["1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0"],
  1: ["1,5 2,6 2,0", "1,0 3,0"],
  2: ["0,5 1,6 3,6 4,5 4,4 0,0 4,0"],
  3: ["0,5 1,6 3,6 4,5 4,4 3,3.2 1.5,3.2", "3,3.2 4,2.2 4,1 3,0 1,0 0,1"],
  4: ["3,0 3,6 0,2 4,2"],
  5: ["4,6 0,6 0,3.5 3,3.5 4,2.5 4,1 3,0 1,0 0,1"],
  6: ["4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.5 3,3.5 1,3.5 0,2.5"],
  7: ["0,6 4,6 1.5,0"],
  8: ["1,3.2 0,4.2 0,5 1,6 3,6 4,5 4,4.2 3,3.2 1,3.2 0,2.2 0,1 1,0 3,0 4,1 4,2.2 3,3.2"],
  9: ["0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,3.5 1,2.5 3,2.5 4,3.5"],
  A: ["0,0 2,6 4,0", "0.8,2 3.2,2"],
  B: ["0,0 0,6 3,6 4,5 4,4.2 3,3.2 0,3.2", "3,3.2 4,2.2 4,1 3,0 0,0"],
  C: ["4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1"],
  D: ["0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0"],
  E: ["4,6 0,6 0,0 4,0", "0,3.2 3,3.2"],
  F: ["4,6 0,6 0,0", "0,3.2 3,3.2"],
  G: ["4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2.2,3"],
  H: ["0,0 0,6", "4,0 4,6", "0,3.2 4,3.2"],
  I: ["1,0 3,0", "1,6 3,6", "2,0 2,6"],
  J: ["1,6 4,6", "3,6 3,1 2,0 1,0 0,1"],
  K: ["0,0 0,6", "4,6 0,2.6", "1.4,3.6 4,0"],
  L: ["0,6 0,0 4,0"],
  M: ["0,0 0,6 2,3 4,6 4,0"],
  N: ["0,0 0,6 4,0 4,6"],
  O: ["1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0"],
  P: ["0,0 0,6 3,6 4,5 4,3.8 3,2.8 0,2.8"],
  Q: ["1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0", "2.5,1.5 4,0"],
  R: ["0,0 0,6 3,6 4,5 4,3.8 3,2.8 0,2.8", "2,2.8 4,0"],
  S: ["4,5 3,6 1,6 0,5 0,4 1,3.2 3,3.2 4,2.2 4,1 3,0 1,0 0,1"],
  T: ["0,6 4,6", "2,6 2,0"],
  U: ["0,6 0,1 1,0 3,0 4,1 4,6"],
  V: ["0,6 2,0 4,6"],
  W: ["0,6 1,0 2,3.5 3,0 4,6"],
  X: ["0,0 4,6", "0,6 4,0"],
  Y: ["0,6 2,3 4,6", "2,3 2,0"],
  Z: ["0,6 4,6 0,0 4,0"],
  "+": ["0.5,3 3.5,3", "2,1.5 2,4.5"],
  "-": ["0.5,3 3.5,3"],
  "/": ["0.5,0 3.5,6"],
  "!": ["2,6 2,2", "2,0.3 2,0"],
  "?": ["0,5 1,6 3,6 4,5 4,4 2,2.6 2,2", "2,0.3 2,0"],
  ".": ["2,0.3 2,0"],
  ":": ["2,4.2 2,3.9", "2,1.5 2,1.2"],
  "%": ["0.5,0 3.5,6", "0.6,5.4 0.6,5", "3.4,1 3.4,0.6"],
};
const parse = (s) => s.split(" ").map((p) => p.split(",").map(Number));
const GLYPH_W = 4 / 6;
const GLYPH_GAP = 0.2;
const SPACE_W = 0.4;

const ring = (r, n = 20) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
const star = (R, r) => Array.from({ length: 10 }, (_, i) => {
  const a = Math.PI / 2 + (i * Math.PI) / 5;
  const k = i % 2 ? r : R;
  return [k * Math.cos(a), k * Math.sin(a)];
});

// Symbols: on a square from −1 to 1, y up. `closed`: the stroke joins its end to its start.
const SYMBOL_ART = {
  plus: { strokes: [{ points: [[-0.8, 0], [0.8, 0]] }, { points: [[0, -0.8], [0, 0.8]] }] },
  minus: { strokes: [{ points: [[-0.8, 0], [0.8, 0]] }] },
  cross: { strokes: [{ points: [[-0.7, -0.7], [0.7, 0.7]] }, { points: [[-0.7, 0.7], [0.7, -0.7]] }] },
  check: { strokes: [{ points: [[-0.75, 0], [-0.25, -0.6], [0.75, 0.7]] }] },
  dot: { discs: [{ c: [0, 0], r: 0.5 }] },
  ring: { strokes: [{ points: ring(0.75), closed: true }] },
  star: { strokes: [{ points: star(0.9, 0.38), closed: true }] },
  diamond: { strokes: [{ points: [[0, 0.9], [0.62, 0], [0, -0.9], [-0.62, 0]], closed: true }] },
  heart: { strokes: [{ points: [[0, -0.85], [-0.85, 0.1], [-0.85, 0.55], [-0.5, 0.85], [-0.15, 0.8], [0, 0.5], [0.15, 0.8], [0.5, 0.85], [0.85, 0.55], [0.85, 0.1]], closed: true }] },
  arrow: { strokes: [{ points: [[0, -0.85], [0, 0.85]] }, { points: [[-0.55, 0.3], [0, 0.85], [0.55, 0.3]] }] },
  bolt: { strokes: [{ points: [[0.25, 0.9], [-0.45, -0.05], [0.1, -0.05], [-0.25, -0.9], [0.5, 0.2], [-0.05, 0.2]], closed: true }] },
  sword: { strokes: [{ points: [[0, -0.9], [0, 0.6]] }, { points: [[-0.2, 0.6], [0, 0.9], [0.2, 0.6]] }, { points: [[-0.45, -0.4], [0.45, -0.4]] }] },
  shield: { strokes: [{ points: [[-0.7, 0.8], [0.7, 0.8], [0.7, 0], [0, -0.9], [-0.7, 0]], closed: true }] },
  crown: { strokes: [{ points: [[-0.8, -0.6], [-0.8, 0.5], [-0.4, 0], [0, 0.7], [0.4, 0], [0.8, 0.5], [0.8, -0.6]], closed: true }] },
};

/** The symbols a mark may be. */
export const SYMBOLS = Object.freeze(Object.keys(SYMBOL_ART));

/** Where a face's spots go, on a 3 × 3 grid ([across, up], each −1, 0 or 1). */
const PIPS = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
  6: [[-1, 1], [-1, 0], [-1, -1], [1, 1], [1, 0], [1, -1]],
  7: [[-1, 1], [-1, 0], [-1, -1], [0, 0], [1, 1], [1, 0], [1, -1]],
  8: [[-1, 1], [-1, 0], [-1, -1], [0, 1], [0, -1], [1, 1], [1, 0], [1, -1]],
  9: [[-1, 1], [-1, 0], [-1, -1], [0, 1], [0, 0], [0, -1], [1, 1], [1, 0], [1, -1]],
};
const PIP_R = 0.13;
const PIP_STEP = 0.33;

const PAD = STROKE / 2;

/** A run of characters as strokes, on a line 1 high, from x = 0: { w, strokes }. Unknown characters are left out. */
function lineArt(string) {
  const strokes = [];
  let x = 0;
  let any = false;
  for (const ch of String(string).toUpperCase()) {
    if (ch === " ") {
      x += SPACE_W;
      continue;
    }
    const g = FONT[ch];
    if (!g) continue;
    if (any) x += GLYPH_GAP;
    for (const s of g) strokes.push({ points: parse(s).map(([px, py]) => [x + px / 6, py / 6]) });
    x += GLYPH_W;
    any = true;
  }
  return { w: x, strokes };
}

/**
 * One mark's art in its own box, origin at the box's lower left: { w, h,
 * strokes: [{ points, closed? }], discs: [{ c, r }] }, strokes STROKE wide.
 * The box takes in the strokes' width. `underline`: a line under a lone 6 or
 * 9, to tell them apart.
 */
export function markArt(mark, { underline = false } = {}) {
  let w, h, strokes = [], discs = [];
  if (mark.kind === "pips") {
    // spots on a 3 × 3 grid filling the box
    return { w: 1, h: 1, strokes, discs: (PIPS[mark.value] ?? []).map(([a, b]) => ({ c: [0.5 + a * PIP_STEP, 0.5 + b * PIP_STEP], r: PIP_R })) };
  }
  if (mark.kind === "symbol") {
    const art = SYMBOL_ART[mark.value] ?? {};
    const fit = (p) => [(p[0] + 1) / 2, (p[1] + 1) / 2];
    strokes = (art.strokes ?? []).map((s) => ({ points: s.points.map(fit), ...(s.closed ? { closed: true } : {}) }));
    discs = (art.discs ?? []).map((d) => ({ c: fit(d.c), r: d.r / 2 }));
    w = h = 1;
  } else {
    const line = lineArt(mark.kind === "number" ? String(mark.value) : mark.value);
    strokes = line.strokes;
    w = Math.max(line.w, 0.2);
    h = 1;
    if (underline && mark.kind === "number" && (mark.value === 6 || mark.value === 9)) {
      const drop = 0.3;
      strokes = strokes.map((s) => ({ ...s, points: s.points.map(([x, y]) => [x, y + drop]) }));
      strokes.push({ points: [[0, 0], [w, 0]] });
      h += drop;
    }
  }
  const shift = ([x, y]) => [x + PAD, y + PAD];
  return {
    w: w + 2 * PAD,
    h: h + 2 * PAD,
    strokes: strokes.map((s) => ({ ...s, points: s.points.map(shift) })),
    discs: discs.map((d) => ({ c: shift(d.c), r: d.r })),
  };
}

const MARK_GAP = 0.16;
/** How many marks go in a row: up to three in one, then two rows. */
const perRow = (n) => (n <= 3 ? n : Math.ceil(n / 2));

/**
 * A face's marks, set out to fit a circle of radius `rho` about the origin
 * and turned `turn` degrees anticlockwise: { strokes: [{ points, closed?,
 * width }], discs: [{ c, r }] }, x to the right and y up. Everything drawn,
 * widths included, lies within the circle (the marks' boxes, set in rows,
 * are scaled until the corners of the whole touch it), so a face that holds
 * the circle holds its marks however they're turned.
 */
export function layoutMarks(marks, rho, turn = 0, opts = {}) {
  const arts = marks.map((m) => markArt(m, opts));
  if (!arts.length) return { strokes: [], discs: [] };
  const n = perRow(arts.length);
  const rows = [];
  for (let i = 0; i < arts.length; i += n) rows.push(arts.slice(i, i + n));
  const rowW = (r) => r.reduce((s, a) => s + a.w, 0) + MARK_GAP * (r.length - 1);
  const rowH = (r) => Math.max(...r.map((a) => a.h));
  const W = Math.max(...rows.map(rowW));
  const H = rows.reduce((s, r) => s + rowH(r), 0) + MARK_GAP * (rows.length - 1);
  const f = rho / (Math.hypot(W, H) / 2);
  const a = (turn * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const place = (x, y) => {
    const px = (x - W / 2) * f, py = (y - H / 2) * f;
    return [px * ca - py * sa, px * sa + py * ca];
  };
  const out = { strokes: [], discs: [] };
  let top = H;
  for (const row of rows) {
    const h = rowH(row);
    let x = (W - rowW(row)) / 2;
    for (const art of row) {
      const y = top - h + (h - art.h) / 2;
      for (const s of art.strokes) out.strokes.push({ points: s.points.map(([px, py]) => place(x + px, y + py)), ...(s.closed ? { closed: true } : {}), width: STROKE * f });
      for (const d of art.discs) out.discs.push({ c: place(x + d.c[0], y + d.c[1]), r: d.r * f });
      x += art.w + MARK_GAP;
    }
    top -= h + MARK_GAP;
  }
  return out;
}

// ─── where on the solid ─────────────────────────────────────────────────────

/** How much of the room on a face its marks take. */
const FILL = 0.74;

/** A side's middle, and how far its nearest edge is from it. */
export function polyRoom(s, poly) {
  const pts = poly.verts.map((v) => s.verts[v]);
  const c = scale(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length);
  let room = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    // inward, in the side's plane: the normal crossed with the edge (the corners run anticlockwise)
    const inward = unit(cross(poly.normal, sub(b, a)));
    room = Math.min(room, dot(sub(c, a), inward));
  }
  return { c, room };
}

/**
 * Where outcome `i`'s marks are drawn on a solid (1 across): one place on the
 * side facing up, or, for a shape read at its top corner, one on each side
 * that meets there, by that corner. Each: { poly, at, normal, up, right, rho }:
 * the side, the middle of the circle the marks fit in and its radius, and
 * the frame they're drawn in (`right` × `up` = `normal`, so they read the
 * right way round from outside).
 */
export function placements(s, i) {
  const o = s.outcomes[i];
  if (o.readPoly != null) {
    const poly = s.polys[o.readPoly];
    const { c, room } = polyRoom(s, poly);
    const n = poly.normal;
    // the default top of a mark: as near to straight up the side as the shape allows; on a level side, towards −Z
    const flat = sub([0, 1, 0], scale(n, n[1]));
    const ref = Math.abs(n[1]) > 0.99 ? [0, 0, -1] : unit(flat);
    const pts = poly.verts.map((v) => s.verts[v]);
    let up = ref;
    if (s.aim !== "none") {
      const aims = s.aim === "edge" ? pts.map((p, k) => scale(add(p, pts[(k + 1) % pts.length]), 0.5)) : pts;
      let best = -Infinity;
      for (const p of aims) {
        const d = unit(sub(p, c));
        const score = dot(d, ref);
        if (score > best + 1e-9) {
          best = score;
          up = d;
        }
      }
    }
    return [{ poly: o.readPoly, at: c, normal: n, up, right: cross(up, n), rho: room * FILL }];
  }
  const corner = s.verts[o.readVert];
  const out = [];
  s.polys.forEach((poly, p) => {
    if (!poly.verts.includes(o.readVert)) return;
    const { c, room } = polyRoom(s, poly);
    // half way out to the corner: the room there is half the middle's, and three such circles keep clear of each other
    const at = scale(add(c, corner), 0.5);
    const up = unit(sub(corner, c));
    out.push({ poly: p, at, normal: poly.normal, up, right: cross(up, poly.normal), rho: (room / 2) * FILL });
  });
  return out;
}

/** A point of a placement's drawing (x right, y up) on the solid. */
export const lift = (pl, [x, y]) => add(pl.at, add(scale(pl.right, x), scale(pl.up, y)));

/**
 * Everything drawn on a die (die.js dieOf), on its solid, 1 across:
 * [{ face, poly, placement, strokes, discs, ink }], one per place a face's
 * marks appear.
 */
export function dieMarks(die, s) {
  const out = [];
  die.faces.forEach((face, i) => {
    if (!face.marks.length) return;
    for (const pl of placements(s, i)) {
      const art = layoutMarks(face.marks, pl.rho, face.turn, { underline: die.underline });
      out.push({ face: i, poly: pl.poly, placement: pl, ...art, ink: face.ink ?? die.ink });
    }
  });
  return out;
}

/**
 * One side of a die laid flat, for a picture of it: its outline and what's
 * drawn on it, x right and y up about its middle, in the frame of the first
 * thing drawn there (else any). { points, items: [{ face, strokes, discs, ink }], color }.
 */
export function flatSide(die, s, p, marks = dieMarks(die, s)) {
  const poly = s.polys[p];
  const mine = marks.filter((m) => m.poly === p);
  const { c } = polyRoom(s, poly);
  let up, right;
  const reads = s.outcomes.findIndex((o) => o.readPoly === p);
  if (reads >= 0) ({ up, right } = placements(s, reads)[0]);
  else {
    up = unit(sub(s.verts[poly.verts[0]], c));
    right = cross(up, poly.normal);
  }
  const flat = (q) => [dot(sub(q, c), right), dot(sub(q, c), up)];
  return {
    points: poly.verts.map((v) => flat(s.verts[v])),
    items: mine.map((m) => ({
      face: m.face,
      ink: m.ink,
      strokes: m.strokes.map((st) => ({ ...st, points: st.points.map((q) => flat(lift(m.placement, q))) })),
      discs: m.discs.map((d) => ({ c: flat(lift(m.placement, d.c)), r: d.r })),
    })),
    color: reads >= 0 ? (die.faces[reads].color ?? die.body) : die.body,
  };
}
