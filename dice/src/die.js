// A die as a document: its shape, its size, and what each of its faces shows.
// Pure: no DOM, no three.js, no stage.
//
//   {
//     "@patchwork": { type: "die" },
//     title: "d6",
//     shape: "d6",                 // one of solids.js SHAPES
//     size: 0.016,                 // metres across (solids.js: how high it stands; a coin's diameter)
//     body: "#f4efe2", ink: "#1f2328",
//     turnOnly: false,             // true: turned by hand, never rolled (a doubling cube)
//     faces: [                     // one per outcome, in the solid's order (solids.js)
//       { marks: [{ kind: "pips", value: 1 }],   // what's drawn on it: any number of marks, side by side
//         name?: "one",            // what it's called when read out; else its marks, read in order
//         color?: "#aa0000",       // this face's own colour (the side itself; not on a d4, whose sides are shared)
//         ink?: "#ffffff",         // its marks' own colour
//         turn?: 90 },             // its marks turned this many degrees anticlockwise from their default
//     ],
//     rolls: [{ face: 3, how: "rolled", at: 1731300000000, draw?, by? }],   // the panel's last few (tool.js); never read by a scene
//     round?: { … },               // the panel's draw by lots (panel-lots.js, lots.js); never read by a scene
//   }
//
// A mark is { kind, value }:
//   "number"  an integer, drawn in numerals            "pips"    1 to 9, drawn as spots
//   "text"    a short label ("00", "H")                "symbol"  one of marks.js SYMBOLS ("plus", "sword", …)
// A face with no marks is blank. Faces may repeat, and a face may carry
// several marks (two swords; a shield and a 2).
//
// A die is a thing, not a rule: it has faces, it can be rolled, read, turned
// to a face by hand and moved about. What a face is worth is the game's
// business, so nothing here adds faces up or compares them; reading a die
// gives the face's index and its label, a string.
//
// A LAYOUT is which face goes where on the solid, and it is just the order of
// `faces`: the same twenty numbers arranged as a standard d20 (opposite faces
// adding to 21) or as a spindown (each number next to the one before) are two
// lists. PRESETS below are the dice people actually use, by generic names.
//
// Every reader takes a doc through `dieOf`, which gives a whole, valid die
// whatever the doc holds: an unknown shape is a d6, a missing face is blank,
// a malformed mark is left out. Nothing is migrated or written back.

import { SYMBOLS } from "./marks.js";
import { neighbours, shapeName, shapeSides, solid } from "./solids.js";

export const DIE_TYPE = "die";
export const DEFAULT_BODY = "#f4efe2";
export const DEFAULT_INK = "#1f2328";
/** The most marks a face may carry. */
export const MAX_MARKS = 6;
/** How long a text mark, and a face's name, may be. */
export const MAX_TEXT = 6;
export const MAX_NAME = 24;
/** A die's size, smallest and largest (m). */
export const MIN_SIZE = 0.004;
export const MAX_SIZE = 0.5;
/** How many of the panel's rolls a doc keeps. */
export const KEPT_ROLLS = 8;

/** How big each shape usually is (m across): a 16 mm d6, a 20 mm d20, a 24 mm coin. */
export const USUAL_SIZE = Object.freeze({ d4: 0.016, d6: 0.016, d8: 0.016, d10: 0.017, d12: 0.018, d20: 0.02, coin: 0.024 });

export const MARK_KINDS = Object.freeze(["number", "pips", "text", "symbol"]);

const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** A mark as it's drawn, or null when it isn't one. */
export function cleanMark(m) {
  if (!m || typeof m !== "object") return null;
  switch (m.kind) {
    case "number":
      return Number.isInteger(m.value) && m.value >= -999 && m.value <= 9999 ? { kind: "number", value: m.value } : null;
    case "pips":
      return Number.isInteger(m.value) && m.value >= 1 && m.value <= 9 ? { kind: "pips", value: m.value } : null;
    case "text": {
      const t = typeof m.value === "string" ? m.value.trim().slice(0, MAX_TEXT) : "";
      return t ? { kind: "text", value: t } : null;
    }
    case "symbol":
      return SYMBOLS.includes(m.value) ? { kind: "symbol", value: m.value } : null;
  }
  return null;
}

/** What a mark is called when read out. */
export const markLabel = (m) => String(m.value);

/** What a face is called when read out: its name, else its marks in order, else "blank". */
export function faceLabel(face) {
  if (face?.name) return face.name;
  const marks = face?.marks ?? [];
  return marks.length ? marks.map(markLabel).join(" ") : "blank";
}

function cleanFace(f) {
  const marks = (Array.isArray(f?.marks) ? f.marks : []).map(cleanMark).filter(Boolean).slice(0, MAX_MARKS);
  const name = typeof f?.name === "string" ? f.name.trim().slice(0, MAX_NAME) : "";
  const turn = Number.isFinite(f?.turn) ? ((f.turn % 360) + 360) % 360 : 0;
  const face = { marks, name: name || null, color: isColor(f?.color) ? f.color.toLowerCase() : null, ink: isColor(f?.ink) ? f.ink.toLowerCase() : null, turn };
  return { ...face, label: faceLabel(face) };
}

/**
 * The die a doc describes, whole and valid.
 * @returns {{ shape, name, size, body, ink, turnOnly, underline, faces: { marks, name, color, ink, turn, label }[] }}
 *   `underline`: its 6 and 9 are told apart by a line under each (it has both).
 */
export function dieOf(doc) {
  const shape = solid(doc?.shape) ? doc.shape : "d6";
  const n = shapeSides(shape);
  const size = Number.isFinite(doc?.size) && doc.size > 0 ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, doc.size)) : USUAL_SIZE[shape];
  const given = Array.isArray(doc?.faces) ? doc.faces : [];
  const faces = Array.from({ length: n }, (_, i) => cleanFace(given[i]));
  const lone = (v) => faces.some((f) => f.marks.length === 1 && f.marks[0].kind === "number" && f.marks[0].value === v);
  return {
    shape,
    name: shapeName(shape),
    size,
    body: isColor(doc?.body) ? doc.body.toLowerCase() : DEFAULT_BODY,
    ink: isColor(doc?.ink) ? doc.ink.toLowerCase() : DEFAULT_INK,
    turnOnly: doc?.turnOnly === true,
    underline: lone(6) && lone(9),
    faces,
  };
}

/** Everything a die's geometry is made from, as one string: not its title, nor its rolls. */
export function dieKey(doc) {
  const d = dieOf(doc);
  return JSON.stringify([d.shape, d.size, d.body, d.ink, d.turnOnly, d.faces.map((f) => [f.marks.map((m) => [m.kind, m.value]), f.name, f.color, f.ink, f.turn])]);
}

// ─── layouts ────────────────────────────────────────────────────────────────

const num = (value) => ({ marks: [{ kind: "number", value }] });
const pips = (value) => ({ marks: [{ kind: "pips", value }] });
const text = (value) => ({ marks: [{ kind: "text", value }] });
const sym = (...values) => ({ marks: values.map((value) => ({ kind: "symbol", value })) });
const blank = () => ({ marks: [] });

/**
 * The usual way a die is numbered: `values` (lowest first) set out so that
 * opposite faces hold the lowest and highest left, in the solid's order. So a
 * d6's opposite faces add to 7, a d20's to 21, a d10's (0 to 9) to 9. A shape
 * with no opposite faces (a d4) takes them in order.
 * @returns {any[]}  values by outcome index
 */
export function opposed(shape, values) {
  const s = solid(shape);
  const out = new Array(s.outcomes.length).fill(undefined);
  let lo = 0;
  let hi = values.length - 1;
  s.outcomes.forEach((o, i) => {
    if (out[i] !== undefined) return;
    out[i] = values[lo++];
    if (o.opposite != null && out[o.opposite] === undefined) out[o.opposite] = values[hi--];
  });
  return out;
}

/**
 * A spindown: `values` (highest first) set out so each is on a face sharing
 * an edge with the one before: a path through every face, found depth first
 * from outcome 0 (the same one every time). Null if the shape has none.
 */
export function spindown(shape, values) {
  const s = solid(shape);
  const n = s.outcomes.length;
  const next = Array.from({ length: n }, (_, i) => neighbours(s, i));
  const path = [0];
  const used = new Set([0]);
  const walk = () => {
    if (path.length === n) return true;
    for (const j of next[path.at(-1)]) {
      if (used.has(j)) continue;
      used.add(j);
      path.push(j);
      if (walk()) return true;
      path.pop();
      used.delete(j);
    }
    return false;
  };
  if (!walk()) return null;
  const out = new Array(n);
  path.forEach((face, k) => (out[face] = values[k]));
  return out;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const numbered = (shape, from = 1) => opposed(shape, range(from, from + shapeSides(shape) - 1)).map(num);

/**
 * The dice on offer: each a whole die doc but for "@patchwork". By generic
 * names; the conventions are the ones real dice follow.
 */
export const PRESETS = Object.freeze({
  d6: { name: "d6, spots", make: () => die("d6", "d6", opposed("d6", range(1, 6)).map(pips)) },
  "d6-numerals": { name: "d6, numerals", make: () => die("d6", "d6", numbered("d6")) },
  d4: { name: "d4", make: () => die("d4", "d4", numbered("d4")) },
  d8: { name: "d8", make: () => die("d8", "d8", numbered("d8")) },
  // a d10 runs 0 to 9; its partner for percentages runs 00 to 90, on the same faces
  d10: { name: "d10 (0–9)", make: () => die("d10", "d10", numbered("d10", 0)) },
  "d10-tens": { name: "d10, tens (00–90)", make: () => die("d10 tens", "d10", opposed("d10", range(0, 9)).map((v) => text(`${v}0`)), { body: "#2d3a55", ink: "#f4efe2" }) },
  d12: { name: "d12", make: () => die("d12", "d12", numbered("d12")) },
  d20: { name: "d20", make: () => die("d20", "d20", numbered("d20")) },
  // the same twenty numbers, each beside the one before, for counting down by turning it
  "d20-spindown": { name: "d20, spindown", make: () => die("d20 spindown", "d20", spindown("d20", range(1, 20).reverse()).map(num), { body: "#3b2f4a", ink: "#f4efe2" }) },
  coin: { name: "Coin", make: () => die("Coin", "coin", [{ ...text("H"), name: "heads" }, { ...text("T"), name: "tails" }], { body: "#c9a24a", ink: "#5a4310" }) },
  // two plus, two minus, two blank: opposite faces alike
  "plus-minus": { name: "Plus/minus die", make: () => die("Plus/minus die", "d6", opposed("d6", ["plus", "minus", "blank", "blank", "minus", "plus"]).map((v) => (v === "blank" ? blank() : sym(v)))) },
  // a d6 numbered 1 to 3 twice, opposite faces alike
  d3: { name: "d3 (a d6, 1–3 twice)", make: () => die("d3", "d6", opposed("d6", [1, 2, 3, 3, 2, 1]).map(num)) },
  // 2 to 64, turned by hand to show the stakes; never rolled
  doubling: { name: "Doubling cube", make: () => die("Doubling cube", "d6", opposed("d6", [2, 4, 8, 16, 32, 64]).map(num), { size: 0.03, turnOnly: true }) },
  // a d6 whose 6 is a mark of its maker's: it still reads "6"
  "d6-logo": { name: "d6, a symbol for the 6", make: () => die("d6", "d6", opposed("d6", range(1, 6)).map((v) => (v === 6 ? { ...sym("star"), name: "6" } : pips(v)))) },
  // icons that also carry counts: one or two swords, one or two shields, a blank
  icons: {
    name: "Icon die (swords and shields)",
    make: () => die("Icon die", "d6", opposed("d6", ["sword", "sword", "shield", "blank", "shield2", "sword2"]).map((v) => (v === "blank" ? blank() : v.endsWith("2") ? { ...sym(v.slice(0, -1), v.slice(0, -1)), name: `2 ${v.slice(0, -1)}s` } : sym(v))), { body: "#7a1f1f", ink: "#f4efe2" }),
  },
});

function die(title, shape, faces, more = {}) {
  return { title, shape, size: USUAL_SIZE[shape], body: DEFAULT_BODY, ink: DEFAULT_INK, turnOnly: false, faces, rolls: [], ...more };
}

/** A new die doc's fields from a preset (default: a d6 with spots). */
export function presetDoc(id = "d6") {
  return (PRESETS[id] ?? PRESETS.d6).make();
}

/** The preset a shape starts as when a die is changed to it. */
export const SHAPE_PRESET = Object.freeze({ d4: "d4", d6: "d6", d8: "d8", d10: "d10", d12: "d12", d20: "d20", coin: "coin" });
