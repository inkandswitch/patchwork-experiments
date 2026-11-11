// The die's own 2D panel: a `patchwork:tool` for a die doc (die.js). It
// works on its own, outside any scene, and is also what the dice extension
// docks beside a scene for a selected die (extension.js).
//
// It shows the die as it is: every face laid flat with exactly what the
// scene draws on it (marks.js flatSide, the same art the GLB is made from),
// and lets you change its shape, size and colours, and each face: its marks
// (any number, each a number, spots, a text or a symbol), what it's called,
// its own colours, and which way its marks are turned.
//
// On its own the die can be used too: Roll lands it on a face drawn at
// random, and a face's "Show" turns it there by hand. The last few are kept
// in the doc (`rolls`), so everyone looking at the die sees them. They are
// the panel's alone: a die in a scene is rolled there, and its place in the
// scene says what it shows.
//
// Plain DOM, drawn again whole on every change of the doc. Fields commit on
// change (Enter, or leaving the field), so drawing again never takes a field
// out from under someone typing in it.

import css from "./styles.css?inline";
import { KEPT_ROLLS, MARK_KINDS, MAX_MARKS, MAX_NAME, MAX_SIZE, MAX_TEXT, MIN_SIZE, PRESETS, SHAPE_PRESET, dieOf, presetDoc } from "./die.js";
import { SYMBOLS, dieMarks, flatSide } from "./marks.js";
import { drawSeed, faceOfSeed } from "./roll.js";
import { SHAPES, shapeName, solid } from "./solids.js";

const SVG = "http://www.w3.org/2000/svg";

function el(tag, props = {}, ...children) {
  const e = tag === "svg" || props.svg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "svg") continue;
    if (k === "class") e.setAttribute("class", v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value" && !props.svg) continue;
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  e.append(...children.filter((c) => c != null));
  // a value last: a select's is one of its options, which are its children
  if ("value" in props && !props.svg) e.value = String(props.value);
  return e;
}

const KIND_NAMES = { number: "Number", pips: "Spots", text: "Text", symbol: "Symbol" };
/** What a mark starts as when its kind is chosen. */
const FRESH = { number: 1, pips: 1, text: "A", symbol: SYMBOLS[0] };

/**
 * A picture of the side outcome `i` is read from, laid flat. On a shape read
 * at its top corner (a d4) that is one of the sides meeting there, with the
 * other corners' marks faint.
 */
export function facePicture(die, s, i, marks = dieMarks(die, s)) {
  const o = s.outcomes[i];
  const p = o.readPoly ?? s.polys.findIndex((poly) => poly.verts.includes(o.readVert));
  const side = flatSide(die, s, p, marks);
  const xs = side.points.map((q) => q[0]), ys = side.points.map((q) => q[1]);
  const pad = 0.04;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const n = (v) => +v.toFixed(5);
  // y up on the die, down on the screen
  const at = ([x, y]) => `${n(x)},${n(-y)}`;
  const svg = el("svg", { viewBox: `${n(x0)} ${n(-y1)} ${n(x1 - x0)} ${n(y1 - y0)}`, role: "img", "aria-label": die.faces[i].label });
  svg.append(el("polygon", { svg: true, points: side.points.map(at).join(" "), fill: side.color, stroke: die.ink, "stroke-opacity": 0.35, "stroke-width": 0.01, "stroke-linejoin": "round" }));
  for (const item of side.items) {
    const g = el("g", { svg: true, "data-face": item.face, opacity: item.face === i ? 1 : 0.3 });
    for (const st of item.strokes) {
      g.append(el(st.closed ? "polygon" : "polyline", { svg: true, points: st.points.map(at).join(" "), fill: "none", stroke: item.ink, "stroke-width": n(st.width), "stroke-linecap": "round", "stroke-linejoin": "round" }));
    }
    for (const d of item.discs) g.append(el("circle", { svg: true, cx: n(d.c[0]), cy: n(-d.c[1]), r: n(d.r), fill: item.ink }));
    svg.append(g);
  }
  return svg;
}

/** The face the panel's die shows: where its last roll or turn left it, else face 0. */
export function showingFace(doc, n) {
  const last = Array.isArray(doc?.rolls) ? doc.rolls.at(-1) : null;
  return Number.isInteger(last?.face) && last.face >= 0 && last.face < n ? last.face : 0;
}

export default function DieTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = el("div", { class: "die-tool" });
  element.append(style, root);

  const change = (fn) => handle.change(fn);
  /** Write one face, making the list whole first (a doc may hold fewer faces than its shape has). */
  const changeFace = (i, fn) =>
    change((d) => {
      const n = solid(dieOf(d).shape).outcomes.length;
      if (!Array.isArray(d.faces)) d.faces = [];
      while (d.faces.length < n) d.faces.push({ marks: [] });
      if (!Array.isArray(d.faces[i].marks)) d.faces[i].marks = [];
      fn(d.faces[i]);
    });
  /** Land the panel's die on a face: rolled, or turned there by hand. */
  const land = (face, how) =>
    change((d) => {
      if (!Array.isArray(d.rolls)) d.rolls = [];
      d.rolls.push({ face, how, at: Date.now() });
      while (d.rolls.length > KEPT_ROLLS) d.rolls.splice(0, 1);
    });

  function about(doc, die) {
    const mm = +(die.size * 1000).toFixed(2);
    return el(
      "div",
      { class: "die-about" },
      el(
        "label",
        {},
        "Shape",
        el(
          "select",
          {
            class: "shape",
            value: die.shape,
            // a new shape has other faces: it starts as that shape's usual die, in this one's colours
            onchange: (e) => change((d) => {
              const fresh = presetDoc(SHAPE_PRESET[e.target.value]);
              d.shape = fresh.shape;
              d.size = fresh.size;
              d.faces = fresh.faces;
              d.rolls = [];
            }),
          },
          ...SHAPES.map((s) => el("option", { value: s }, shapeName(s))),
        ),
      ),
      el("label", {}, "Size", el("input", { class: "size", type: "number", min: MIN_SIZE * 1000, max: MAX_SIZE * 1000, step: 1, value: mm, onchange: (e) => Number(e.target.value) > 0 && change((d) => (d.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(e.target.value) / 1000)))) }), el("span", { class: "muted" }, "mm")),
      el("label", {}, "Body", el("input", { class: "body", type: "color", value: die.body, onchange: (e) => change((d) => (d.body = e.target.value)) })),
      el("label", {}, "Ink", el("input", { class: "ink", type: "color", value: die.ink, onchange: (e) => change((d) => (d.ink = e.target.value)) })),
      el("label", { title: "A die that's turned by hand to show something, and never rolled (a doubling cube)" }, el("input", { class: "turn-only", type: "checkbox", checked: die.turnOnly, onchange: (e) => change((d) => (d.turnOnly = e.target.checked)) }), "Turned by hand, never rolled"),
      el(
        "label",
        {},
        "Start again as",
        el(
          "select",
          {
            class: "preset",
            value: "",
            onchange: (e) => {
              const id = e.target.value;
              if (!PRESETS[id]) return;
              change((d) => {
                const fresh = presetDoc(id);
                for (const k of ["shape", "size", "body", "ink", "turnOnly", "faces", "rolls"]) d[k] = fresh[k];
              });
            },
          },
          el("option", { value: "" }, "…"),
          ...Object.entries(PRESETS).map(([id, p]) => el("option", { value: id }, p.name)),
        ),
      ),
    );
  }

  function table(doc, die, s, marks) {
    const n = s.outcomes.length;
    const showing = showingFace(doc, n);
    const rolls = (Array.isArray(doc.rolls) ? doc.rolls : []).filter((r) => Number.isInteger(r?.face) && r.face >= 0 && r.face < n);
    return el(
      "div",
      { class: "die-table" },
      el("div", { class: "die-shows" }, facePicture(die, s, showing, marks)),
      el(
        "div",
        { class: "die-now" },
        el("div", { class: "reads", "data-face": showing }, `Shows ${die.faces[showing].label}`),
        el(
          "div",
          { class: "row" },
          el("button", { class: "roll", type: "button", "data-primary": true, disabled: die.turnOnly, title: die.turnOnly ? "This die is turned by hand, never rolled" : "Roll it", onclick: () => land(faceOfSeed(drawSeed(), n), "rolled") }, "Roll"),
          " ",
          el("button", { class: "next", type: "button", title: "Turn it by hand to its next face", onclick: () => land((showing + 1) % n, "turned") }, "Turn"),
        ),
        el("ul", { class: "die-rolls", "aria-label": "The last few" }, ...rolls.map((r, k) => el("li", { "data-how": r.how === "turned" ? "turned" : "rolled", "data-latest": k === rolls.length - 1, title: r.how === "turned" ? "turned by hand" : "rolled" }, die.faces[r.face].label))),
      ),
    );
  }

  function markRow(i, k, mark) {
    const set = (value) => changeFace(i, (f) => (f.marks[k].value = value));
    let value;
    if (mark.kind === "symbol") value = el("select", { class: "value", value: mark.value, onchange: (e) => set(e.target.value) }, ...SYMBOLS.map((sym) => el("option", { value: sym }, sym)));
    else if (mark.kind === "text") value = el("input", { class: "value", type: "text", maxlength: MAX_TEXT, value: mark.value, onchange: (e) => e.target.value.trim() && set(e.target.value.trim().slice(0, MAX_TEXT)) });
    else value = el("input", { class: "value", type: "number", step: 1, ...(mark.kind === "pips" ? { min: 1, max: 9 } : { min: -999, max: 9999 }), value: mark.value, onchange: (e) => Number.isInteger(Number(e.target.value)) && e.target.value !== "" && set(Number(e.target.value)) });
    return el(
      "div",
      { class: "die-mark" },
      el("select", { class: "kind", value: mark.kind, onchange: (e) => changeFace(i, (f) => (f.marks[k] = { kind: e.target.value, value: FRESH[e.target.value] })) }, ...MARK_KINDS.map((kind) => el("option", { value: kind }, KIND_NAMES[kind]))),
      value,
      el("button", { class: "remove", type: "button", title: "Take this mark off", onclick: () => changeFace(i, (f) => f.marks.splice(k, 1)) }, "×"),
    );
  }

  function faceCard(doc, die, s, marks, i, showing) {
    const face = die.faces[i];
    // a face's own colour or ink: a tick to have one, then the colour
    const own = (key, label, fallback) =>
      el(
        "label",
        {},
        el("input", { class: `own-${key}`, type: "checkbox", checked: face[key] != null, onchange: (e) => changeFace(i, (f) => (e.target.checked ? (f[key] = fallback) : delete f[key])) }),
        label,
        face[key] != null ? el("input", { class: key, type: "color", value: face[key], onchange: (e) => changeFace(i, (f) => (f[key] = e.target.value)) }) : null,
      );
    return el(
      "div",
      { class: "die-face", "data-face": i, "data-showing": i === showing },
      el("div", { class: "picture" }, facePicture(die, s, i, marks), el("button", { class: "show", type: "button", title: "Turn the die by hand to show this face", onclick: () => land(i, "turned") }, "Show")),
      el(
        "div",
        { class: "fields" },
        el("div", { class: "reads" }, face.label),
        ...face.marks.map((m, k) => markRow(i, k, m)),
        el(
          "div",
          { class: "row" },
          el("button", { class: "add", type: "button", disabled: face.marks.length >= MAX_MARKS, onclick: () => changeFace(i, (f) => f.marks.push({ kind: "number", value: 1 })) }, "Add a mark"),
          el(
            "label",
            { title: "Which way its marks are turned" },
            "Turn",
            el("select", { class: "turn", value: face.turn, onchange: (e) => changeFace(i, (f) => (Number(e.target.value) ? (f.turn = Number(e.target.value)) : delete f.turn)) }, ...[...new Set([0, 90, 180, 270, face.turn])].map((a) => el("option", { value: a }, `${a}°`))),
          ),
        ),
        el("div", { class: "row" }, el("input", { class: "name", type: "text", maxlength: MAX_NAME, placeholder: "Called…", title: "What this face is called when it's read out, if not its marks", value: face.name ?? "", onchange: (e) => changeFace(i, (f) => (e.target.value.trim() ? (f.name = e.target.value.trim().slice(0, MAX_NAME)) : delete f.name)) })),
        el("div", { class: "row" }, s.read === "face" ? own("color", "Colour", die.body) : null, own("ink", "Ink", die.ink)),
      ),
    );
  }

  function render() {
    const doc = handle.doc() ?? {};
    const die = dieOf(doc);
    const s = solid(die.shape);
    const marks = dieMarks(die, s);
    const showing = showingFace(doc, s.outcomes.length);
    root.dataset.shape = die.shape;
    root.replaceChildren(
      about(doc, die),
      el("h2", {}, "On its own"),
      table(doc, die, s, marks),
      el("h2", {}, s.read === "vertex" ? "Faces (read at the top corner)" : "Faces"),
      el("div", { class: "die-faces" }, ...die.faces.map((_, i) => faceCard(doc, die, s, marks, i, showing))),
    );
  }
  render();
  handle.on("change", render);

  return () => {
    handle.off("change", render);
    root.remove();
    style.remove();
  };
}
