// scene.touch: the touch controls (TOOLS.md §5). With no keyboard, the keys
// the open gesture, the held tool and the body declare are shown as controls
// a finger holds: the pad's arrows bottom left, the rest as buttons bottom
// right, each under the layer it is for. Which controls, and which key each
// presses, is ../touch-keys.js (pure); this only draws them and presses.
//
// The pad is a keyboard. A finger down on a control sends the keydown a
// keyboard sends for its code (the US layout's key with it) to the view's
// root, where the router hears keys; the finger coming up (or cancelled, or
// its capture lost) sends the keyup. So a pad key goes the key order every
// key goes (the gesture, the tool, the body, the key map), and a shown
// control works by the same construction as a shown key. Fingers are each
// their own: Forward, Run and a look drag on the canvas at once. A control
// held by two fingers is down until the last comes up.
//
// It shows while the input is touch (the view's `pointer.touch`) and there
// are controls. A control that goes while held (the body changed, a carry
// took its key) or a pad that hides lets go of what it held; the router
// ignores a keyup for a key it doesn't hold, so letting go twice is
// nothing. A press on a control keeps focus where it is (preventDefault),
// so the key map's focus watch never cancels a held verb under a finger.

import css from "./touch.css?inline";
import { touchControls } from "../touch-keys.js";

/** The pad's places, as arrows. */
const GLYPH = { up: "▲", down: "▼", left: "◀", right: "▶" };

/** A control's identity: its layer, its code and what it shows (a control kept across renders keeps its finger). */
const idOf = (c) => JSON.stringify([c.from, c.code, c.label, c.slot]);

/** Each layer's name over its buttons. Pure. */
export function layerName(from, view) {
  if (from === "body") return String(view?.body?.label ?? view?.body?.id ?? "Body");
  if (from === "tool") return String(view?.held?.name ?? "Held");
  return "Carrying";
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

  const shown = new Map(); // id → { control, el, fingers: Set<pointerId> }
  const fingers = new Map(); // pointerId → id

  const send = (type, { code, key }) => api.root.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));

  function down(id, e) {
    const c = shown.get(id);
    if (!c || fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, id);
    c.fingers.add(e.pointerId);
    if (c.fingers.size > 1) return;
    c.el.dataset.held = "";
    send("keydown", c.control);
  }
  function up(pointerId) {
    const id = fingers.get(pointerId);
    if (id === undefined) return;
    fingers.delete(pointerId);
    const c = shown.get(id);
    if (!c || !c.fingers.delete(pointerId) || c.fingers.size) return;
    delete c.el.dataset.held;
    send("keyup", c.control);
  }
  /** A control going: its fingers let go (its key up), and it's gone. */
  function drop(id) {
    const c = shown.get(id);
    for (const p of [...c.fingers]) up(p);
    shown.delete(id);
    c.el.remove();
  }

  function make(control, id) {
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
    el.addEventListener("pointerdown", (e) => {
      // focus stays where it is (on the view's root): the key map cancels held verbs when focus leaves
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // a synthetic pointer can't be captured
      }
      down(id, e);
    });
    const off = (e) => up(e.pointerId);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("lostpointercapture", off);
    // a finger on the pad isn't where anyone looks (the use prompt follows the pointer)
    el.addEventListener("pointermove", (e) => e.stopPropagation());
    return el;
  }

  // Elements are put in place without moving one that's already there: a
  // control under a finger has its pointer captured, and taking it out of
  // the document, even to put it back, can lose that.
  function arrange(parent, els) {
    for (const el of [...parent.children]) if (!els.includes(el)) el.remove();
    els.forEach((el, i) => {
      if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null);
    });
  }
  const groups = new Map(); // from → { el, name }
  function groupOf(from) {
    let g = groups.get(from);
    if (!g) {
      const el = document.createElement("div");
      el.className = "touch-group";
      el.dataset.from = from;
      el.setAttribute("role", "group");
      const name = document.createElement("div");
      name.className = "touch-layer-name";
      groups.set(from, (g = { el, name }));
    }
    return g;
  }

  let key = "";
  function render() {
    const view = api.view.get();
    const controls = view.pointer?.touch ? touchControls(view) : [];
    const next = JSON.stringify([controls.map(idOf), controls.map((c) => layerName(c.from, view))]);
    if (next === key) return;
    key = next;
    const ids = new Set(controls.map(idOf));
    for (const id of [...shown.keys()]) if (!ids.has(id)) drop(id);
    for (const control of controls) {
      const id = idOf(control);
      if (!shown.has(id)) shown.set(id, { control, el: make(control, id), fingers: new Set() });
    }
    const elOf = (c) => shown.get(idOf(c)).el;
    // the pad's arrows (each in its place: CSS, by data-slot); the buttons in a group per layer, in the key order
    arrange(pad, controls.filter((c) => c.slot).map(elOf));
    const layers = [...new Set(controls.filter((c) => !c.slot).map((c) => c.from))];
    for (const from of layers) {
      const g = groupOf(from);
      g.name.textContent = layerName(from, view);
      g.el.setAttribute("aria-label", g.name.textContent);
      arrange(g.el, [g.name, ...controls.filter((c) => !c.slot && c.from === from).map(elOf)]);
    }
    arrange(buttons, layers.map((from) => groups.get(from).el));
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
