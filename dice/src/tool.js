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
// On its own the die can be used too: Roll lands it on a face nobody chose,
// drawn by lots between everyone who has this die's panel open (panel-lots.js:
// the round in the doc's `round`, who is here from the doc's ephemeral
// messages), and a face's "Show" turns it there by hand. While the draw is
// under way the panel shows the die tumbling, for everyone looking; once it's
// drawn, the face is its seed's, and whoever asked writes it into the doc's
// `rolls` (anyone else does, after a moment, if they don't), so everyone
// sees the last few, each checked against its draw where the doc still has
// it. Every drawn roll is written, whatever becomes of it: one its asker
// threw away for another before writing it, everyone who saw it drawn writes
// (`again: true`, "rolled again before it came down"); its asker opened its
// part first, so it knew the face no sooner than they did. Its asker writes
// only an attempt its own client made, and nobody writes one somebody says
// was written in their name (lots.js "forged"). They are the panel's alone:
// a die in a scene is rolled there, and its place in the scene says what it
// shows.
//
// Plain DOM, drawn again whole on every change of the doc. Fields commit on
// change (Enter, or leaving the field), so drawing again never takes a field
// out from under someone typing in it.

import css from "./styles.css?inline";
import { KEPT_ROLLS, MARK_KINDS, MAX_MARKS, MAX_NAME, MAX_SIZE, MAX_TEXT, MIN_SIZE, PRESETS, SHAPE_PRESET, dieOf, presetDoc } from "./die.js";
import { SYMBOLS, dieMarks, flatSide } from "./marks.js";
import { panelLots } from "./panel-lots.js";
import { faceOfSeed, seedFromLots } from "./roll.js";
import { SHAPES, shapeName, solid } from "./solids.js";

/** How long a roll here may wait for its draw before it gives up and says so (ms). */
export const PANEL_THROW_MS = 15_000;
/** How long, once a roll is drawn, the others leave its asker to write it (ms). */
export const PANEL_GRACE_MS = 1500;
/** The least a roll tumbles here before it lands, however soon it's drawn (ms). */
export const PANEL_AIR_MS = 350;

/** Who is looking: the scene's viewer when docked, else the account's contact, else this browser's own id. */
function viewerOf(element) {
  if (typeof element?.viewerId === "string" && element.viewerId) return element.viewerId;
  const contact = globalThis.accountDocHandle?.doc?.()?.contactUrl;
  if (typeof contact === "string" && contact) return contact;
  const fresh = `viewer:${Math.random().toString(36).slice(2, 12)}`;
  try {
    const ls = globalThis.localStorage;
    const v = ls?.getItem("die-viewer");
    if (v) return v;
    ls?.setItem("die-viewer", fresh);
  } catch {}
  return fresh;
}

/** The panel's rolls as the doc keeps them, each draw once (two who wrote one at once both left it). */
export function rollsOf(doc, n) {
  const seen = new Set();
  return (Array.isArray(doc?.rolls) ? doc.rolls : []).filter((r) => {
    if (!Number.isInteger(r?.face) || r.face < 0 || r.face >= n) return false;
    if (typeof r.draw !== "string") return true;
    if (seen.has(r.draw)) return false;
    seen.add(r.draw);
    return true;
  });
}

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

/** The face the panel's die shows: where its last roll or turn left it (not one rolled again before it came down), else face 0. */
export function showingFace(doc, n) {
  const last = Array.isArray(doc?.rolls) ? doc.rolls.findLast((r) => !r?.again) : null;
  return Number.isInteger(last?.face) && last.face >= 0 && last.face < n ? last.face : 0;
}

/** The face a drawn roll lands on: its seed's remainder, as a die thrown alone in a scene. Null until it's drawn. */
export const faceOfDraw = (st, n) => (st?.public ? faceOfSeed(seedFromLots(st.seed), n) : null);

export default function DieTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = el("div", { class: "die-tool" });
  element.append(style, root);

  const change = (fn) => handle.change(fn);
  const viewer = viewerOf(element);
  const repo = element?.repo ?? globalThis.repo ?? null;
  let dead = false;

  // ── who's who, for saying who drew a roll ──
  const names = new Map();
  function nameOf(v) {
    if (v === viewer) return "you";
    if (names.has(v)) return names.get(v) ?? "someone";
    names.set(v, null);
    if (typeof v === "string" && v.startsWith("automerge:"))
      Promise.resolve(repo?.find?.(v))
        .then((h) => {
          const n = h?.doc?.()?.name;
          if (!dead && typeof n === "string" && n.trim()) names.set(v, n.trim());
        })
        .catch(() => {});
    return "someone";
  }
  const list = (vs) => (vs.length > 1 ? `${vs.slice(0, -1).join(", ")} and ${vs.at(-1)}` : vs[0] ?? "nobody");
  const cap = (t) => t.replace(/^./, (c) => c.toUpperCase());

  // ── rolling: by lots among everyone with this panel open ──
  let pending = null; // this panel's own roll: { draw, at }
  let note = null; // what to say about it, if it didn't land
  let drawnSeen = null; // the last attempt this panel saw drawn, until it's written down: { id, draw, by, face }
  const seenAt = new Map(); // draw → when this panel first saw it
  const early = new Set(); // draws this panel saw before they were drawn (only those it may write for someone else)
  const timers = new Set();
  const after = (ms, fn) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!dead) fn();
    }, ms);
    timers.add(t);
  };
  let storage = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {}
  const lots = panelLots(handle, { viewer, name: nameOf, storage, onChange: () => !dead && update() });
  const landed = (doc, draw) => Array.isArray(doc?.rolls) && doc.rolls.some((r) => r?.draw === draw);

  /** Do what the draw on the die now calls for: land it once it's drawn, give up on ours if it can't be. */
  function settle() {
    const doc = handle.doc() ?? {};
    const n = solid(dieOf(doc).shape).outcomes.length;
    const st = lots.state();
    const now = Date.now();
    if (st && !seenAt.has(st.draw)) seenAt.set(st.draw, now);
    if (st && !st.public && !st.spoiled) early.add(st.draw);
    const forged = !!st?.forged?.length;
    // an attempt seen drawn and gone before it was written (its asker rolled again, or anything else replaced
    // it): written now, as drawn, by anyone who saw it coming
    if (drawnSeen && st?.id !== drawnSeen.id) {
      if (!landed(doc, drawnSeen.draw) && early.has(drawnSeen.draw)) land(drawnSeen.face, "rolled", { draw: drawnSeen.draw, by: drawnSeen.by, ...(st?.draw !== drawnSeen.draw ? { again: true } : {}) });
      drawnSeen = null;
    }
    if (st?.public && !forged && !landed(doc, st.draw)) drawnSeen = { id: st.id, draw: st.draw, by: st.by, face: faceOfDraw(st, n) };
    if (pending) {
      if (st && st.draw !== pending.draw) (pending = null), (note = `${st.by === viewer ? "You" : cap(nameOf(st.by))} rolled it before yours was drawn: that is the roll.`);
      else if (st?.spoiled) (pending = null), (note = "That roll didn't land: its lots were spoiled.");
      // only an attempt this panel made is its roll
      else if (st && !(st.by === viewer && st.own)) (pending = null), (note = st.by === viewer ? "Someone wrote the lots for that roll in your name: nothing was rolled." : `${cap(nameOf(st.by))} drew that roll again: nothing was rolled.`);
      else if (now - pending.at > PANEL_THROW_MS && !st?.public) (pending = null), (note = `That roll didn't land: its lots are still waiting for ${list((st?.waiting ?? []).map(nameOf))}. Nothing was rolled.`);
    }
    const face = faceOfDraw(st, n);
    if (face == null || forged || landed(doc, st.draw)) {
      if (pending && st && landed(doc, pending.draw)) pending = null;
      return;
    }
    // drawn and not written yet: whoever asked, once it's been in the air a moment; anyone who saw it drawn, after a grace
    const wait = st.by === viewer && st.own ? PANEL_AIR_MS - (now - (pending?.draw === st.draw ? pending.at : seenAt.get(st.draw))) : early.has(st.draw) ? PANEL_GRACE_MS - (now - seenAt.get(st.draw)) : Infinity;
    if (wait === Infinity) return;
    if (wait > 0) return void after(wait + 5, update);
    land(face, "rolled", { draw: st.draw, by: st.by });
    if (pending?.draw === st.draw) pending = null;
  }
  function roll() {
    note = null;
    const draw = lots.draw();
    if (!draw) return;
    pending = { draw, at: Date.now() };
    after(PANEL_THROW_MS + 50, update);
    update();
  }
  /** Write one face, making the list whole first (a doc may hold fewer faces than its shape has). */
  const changeFace = (i, fn) =>
    change((d) => {
      const n = solid(dieOf(d).shape).outcomes.length;
      if (!Array.isArray(d.faces)) d.faces = [];
      while (d.faces.length < n) d.faces.push({ marks: [] });
      if (!Array.isArray(d.faces[i].marks)) d.faces[i].marks = [];
      fn(d.faces[i]);
    });
  /** Land the panel's die on a face: rolled (by a draw, once), or turned there by hand. */
  const land = (face, how, more = {}) =>
    change((d) => {
      if (!Array.isArray(d.rolls)) d.rolls = [];
      if (more.draw && d.rolls.some((r) => r?.draw === more.draw)) return;
      d.rolls.push({ face, how, at: Date.now(), ...more });
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

  /** Is a draw under way on the die (asked, not yet written into its rolls, not given up on)? */
  function rollingNow(doc, st) {
    if (pending) return true;
    if (!st || st.spoiled || st.forged?.length || landed(doc, st.draw)) return false;
    return Date.now() - (seenAt.get(st.draw) ?? 0) < PANEL_THROW_MS + PANEL_GRACE_MS;
  }
  /** What to say about the last roll: who drew it, if the doc still has its draw and it lands where the roll says. */
  function drawnLine(doc, st, rolls, n) {
    const last = rolls.at(-1);
    if (!last || last.how !== "rolled" || typeof last.draw !== "string" || st?.draw !== last.draw || !st.public) return null;
    if (faceOfDraw(st, n) !== last.face) return { text: "This roll isn't the face its draw says: it was written by hand.", state: "warn" };
    const by = (st.contributors ?? []).map(nameOf);
    const alone = by.length < 2 && (st.members?.length ?? 1) > 1;
    // who was left out for not opening their part (they could have known it first, and stopped it)
    const left = (st.excluded ?? []).filter((v) => !(st.contributors ?? []).includes(v));
    const one = left.length === 1 && left[0] === viewer;
    const leftOut = left.length ? `; ${list(left.map(nameOf))} didn't open ${one ? "your" : "their"} part, and it was drawn again without ${one ? "you" : "them"}` : "";
    return { text: `${by.length > 1 ? `Drawn by ${list(by)}` : `Drawn by ${by[0] ?? "nobody"} alone${alone ? ": nobody else took part" : ""}`}${leftOut}.`, state: alone || left.length ? "warn" : "ok" };
  }
  /** What to say of rolls drawn and thrown away for another before they came down: their faces, and who rolled again. */
  function againLine(die, rolls) {
    const again = rolls.filter((r) => r.again);
    if (!again.length) return null;
    const who = [...new Set(again.map((r) => r.by))].map((v) => (typeof v === "string" ? nameOf(v) : "someone"));
    return { text: `${cap(list(who))} rolled again before ${again.length === 1 ? "a roll" : `${again.length} rolls`} came down: ${again.map((r) => die.faces[r.face].label).join(", ")}, as drawn.`, state: "warn" };
  }

  function table(doc, die, s, marks) {
    const n = s.outcomes.length;
    const showing = showingFace(doc, n);
    const rolls = rollsOf(doc, n);
    const st = lots.state();
    const rolling = rollingNow(doc, st);
    const lines = [];
    if (rolling) lines.push({ text: `Rolling: drawn by lots between ${lots.present().length > 1 ? `the ${lots.present().length} of you here` : "you alone (nobody else has it open)"}…`, state: "loading" });
    else {
      const drawn = drawnLine(doc, st, rolls, n);
      if (drawn) lines.push(drawn);
    }
    const thrownAway = againLine(die, rolls);
    if (thrownAway) lines.push(thrownAway);
    if (note) lines.push({ text: note, state: "warn" });
    for (const l of lots.hud()) lines.push(l);
    return el(
      "div",
      { class: "die-table", "data-rolling": rolling },
      el("div", { class: "die-shows" }, facePicture(die, s, showing, marks)),
      el(
        "div",
        { class: "die-now" },
        el("div", { class: "reads", "data-face": showing }, rolling ? "Rolling…" : `Shows ${die.faces[showing].label}`),
        el(
          "div",
          { class: "row" },
          el("button", { class: "roll", type: "button", "data-primary": true, disabled: die.turnOnly || rolling, title: die.turnOnly ? "This die is turned by hand, never rolled" : rolling ? "It's rolling" : "Roll it: drawn by lots with everyone who has this die open", onclick: roll }, "Roll"),
          " ",
          el("button", { class: "next", type: "button", disabled: rolling, title: "Turn it by hand to its next face", onclick: () => land((showing + 1) % n, "turned") }, "Turn"),
        ),
        el("ul", { class: "die-rolls", "aria-label": "The last few" }, ...rolls.map((r, k) => el("li", { "data-how": r.how === "turned" ? "turned" : r.again ? "again" : "rolled", "data-latest": k === rolls.length - 1, title: r.how === "turned" ? "turned by hand" : r.again ? "drawn, and rolled again before it came down" : "rolled" }, die.faces[r.face].label))),
        ...lines.map((l) => el("div", { class: "die-drawn", "data-state": l.state ?? "" }, l.text)),
      ),
    );
  }

  // while a roll is under way, the picture tumbles through the faces (that picture alone: fields being typed in stay put)
  let tumble = null;
  function animate(on) {
    if (!on) {
      clearInterval(tumble);
      tumble = null;
      return;
    }
    if (tumble) return;
    let k = 0;
    tumble = setInterval(() => {
      const shows = root.querySelector(".die-shows");
      if (!shows) return;
      const doc = handle.doc() ?? {};
      const die = dieOf(doc);
      const s = solid(die.shape);
      k = (k + 7) % s.outcomes.length;
      shows.replaceChildren(facePicture(die, s, k));
    }, 90);
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

  function update() {
    if (dead) return;
    settle();
    render();
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
    animate(!!root.querySelector(".die-table")?.hasAttribute("data-rolling"));
  }
  update();
  handle.on("change", update);

  return () => {
    dead = true;
    handle.off("change", update);
    lots.dispose();
    animate(false);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    root.remove();
    style.remove();
  };
}
