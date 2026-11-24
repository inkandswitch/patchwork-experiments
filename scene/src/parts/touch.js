// scene.touch: the touch controls (STAGE.md, "Keys"). With no keyboard, the keys
// the open gesture, the hands (each held tool) and the body declare are shown as controls
// a finger holds: the pad's arrows bottom left, the rest as buttons bottom
// right, each under the layer it is for. Which controls, and which key each
// presses, is ../touch-keys.js (pure); this only draws them, and a finger on
// one holds its key (../hold-key.js).
//
// The pad presses keys as a keyboard does: a finger down on a control sends
// the keydown a keyboard sends for its code to the view's root, where the
// router hears keys, and the finger coming up (or cancelled, or its capture
// lost) the keyup. So a pad key goes the key order every key goes (the
// gesture, the hands top down, the body, the key map), and a shown control works by
// the same construction as a shown key. Fingers are each their own:
// Forward, Run and a look drag on the canvas at once. A control held by two
// fingers is down until the last comes up.
//
// A control is a layer's (that body, that hand, that gesture: its `serial`)
// key. It shows while the input is touch (the view's `pointer.touch`) and
// there are controls; when its layer goes (the body changed, the carry took
// its key, a new tool) or the pad hides, it lets go of what it held and is
// gone, so a lit control is always a key its layer holds. The router lets go
// of every key on a blur or a hidden page, and so does the pad. Letting go
// twice is nothing: the router ignores a keyup for a key it doesn't hold.

import css from "./touch.css?inline";
import { keyHolder } from "../stage/public.js";
import { touchControls } from "./touch-keys.js";
import { arrange, holdKey } from "./hold-key.js";

/** The pad's places, as arrows. */
const GLYPH = { up: "▲", down: "▼", left: "◀", right: "▶" };

/** Which layer a control is for: that body, hand or gesture (each is its own serial; the router's), as one string. */
const layerOf = (c, view) => `${c.from}:${keyHolder(c.code, view)?.layer?.serial ?? ""}`;

/** A control's identity: its layer, its code and what it shows (a control kept across renders keeps its finger). */
const idOf = (c, view) => JSON.stringify([layerOf(c, view), c.code, c.label, c.slot]);

/**
 * Each layer's name over its buttons: the body's label, the hand's name. A
 * gesture has none to say (the stage knows no gesture's name, and a part's
 * word for one, "Carrying", would be wrong for every other): its group
 * shows unnamed. Pure.
 * @param {{ code: string, from: "body" | "hand" | "gesture" }} control  @param {object} view
 * @returns {string | null}
 */
export function layerName(control, view) {
  const layer = keyHolder(control.code, view)?.layer;
  if (control.from === "body") return String(layer?.label ?? layer?.id ?? "Body");
  if (control.from === "hand") return String(layer?.name ?? "Held");
  return null;
}

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("touch-layer");
  const pad = document.createElement("div");
  pad.className = "touch-pad";
  const buttons = document.createElement("div");
  buttons.className = "touch-buttons";
  overlay.append(pad, buttons);
  // a long press is a held key here, not the browser's menu or a selection
  api.listen(overlay, "contextmenu", (e) => e.preventDefault());

  const shown = new Map(); // id → { control, el, hold }

  /** A control going: its fingers let go (its key up), and it's gone. */
  function drop(id) {
    const c = shown.get(id);
    c.hold.letGo();
    shown.delete(id);
    c.el.remove();
  }
  /** Every finger lets go, the controls stay (the router lets go of every key then, too). */
  const letGoAll = () => {
    for (const c of shown.values()) c.hold.letGo();
  };
  api.listen(window, "blur", letGoAll);
  api.listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") letGoAll();
  });

  function make(control) {
    const el = document.createElement("button");
    el.type = "button";
    el.tabIndex = -1;
    el.className = control.slot ? "touch-key touch-arrow" : "touch-key";
    el.dataset.code = control.code;
    el.dataset.from = control.from;
    if (control.slot) {
      el.dataset.slot = control.slot;
      el.setAttribute("aria-label", control.label);
      el.title = control.label;
      const g = document.createElement("span");
      g.className = "touch-glyph";
      g.textContent = GLYPH[control.slot];
      g.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "touch-name";
      name.textContent = control.label;
      el.append(g, name);
    } else el.textContent = control.label;
    const hold = holdKey(el, api.root, control.code, (on) => {
      if (on) el.dataset.held = "";
      else delete el.dataset.held;
    });
    return { control, el, hold };
  }

  const groups = new Map(); // layer (layerOf) → { el, name }
  function groupOf(l, from) {
    let g = groups.get(l);
    if (!g) {
      const el = document.createElement("div");
      el.className = "touch-group";
      el.dataset.from = from;
      el.setAttribute("role", "group");
      const name = document.createElement("div");
      name.className = "touch-layer-name";
      groups.set(l, (g = { el, name }));
    }
    return g;
  }

  let key = "";
  function render() {
    const view = api.view.get();
    const controls = view.pointer?.touch ? touchControls(view) : [];
    const id = (c) => idOf(c, view);
    const name = (c) => layerName(c, view);
    const layer = (c) => layerOf(c, view);
    const next = JSON.stringify([controls.map(id), controls.map(name)]);
    if (next === key) return;
    key = next;
    const ids = new Set(controls.map(id));
    for (const k of [...shown.keys()]) if (!ids.has(k)) drop(k);
    for (const control of controls) if (!shown.has(id(control))) shown.set(id(control), make(control));
    const elOf = (c) => shown.get(id(c)).el;
    // (moving as few as can be: a control under a finger keeps its capture, ../hold-key.js arrange)
    // the pad's arrows (each in its place: CSS, by data-slot); the buttons in a group per layer, in the key order
    arrange(pad, controls.filter((c) => c.slot).map(elOf));
    const buttonsOf = controls.filter((c) => !c.slot);
    const layers = [...new Set(buttonsOf.map(layer))];
    for (const l of layers) {
      const mine = buttonsOf.filter((c) => layer(c) === l);
      const g = groupOf(l, mine[0].from);
      const said = name(mine[0]);
      g.name.textContent = said ?? "";
      g.name.hidden = said == null;
      g.el.setAttribute("aria-label", said ?? "Keys of what you're doing");
      arrange(g.el, [g.name, ...mine.map(elOf)]);
    }
    for (const [l, g] of [...groups]) if (!layers.includes(l)) (g.el.remove(), groups.delete(l));
    arrange(buttons, layers.map((l) => groups.get(l).el));
    pad.hidden = !pad.childElementCount;
    buttons.hidden = !layers.length;
  }

  return {
    update() {
      render();
    },
    dispose() {
      for (const id of [...shown.keys()]) drop(id);
    },
  };
}

export default { create };
