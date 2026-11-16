// Touch controls derived from declared keys (TOOLS.md §5). Pure: no DOM,
// no api.
//
// The open gesture, the held tool and the body declare the keys they take
// ([{ code, label }]). On touch there is no keyboard, so a pad shows those
// keys as controls a finger can hold. Nothing here is per body: the controls
// come from the declarations alone, in the router's key order.
//
// - A code shows only under the reserver the key resolver names for it
//   (keymap.js reservedBy), so a control always reaches the reserver it's
//   shown for: a shown key works, by construction.
// - Within one reserver, codes shown the same are one control: the declared
//   label, else the code's own name (KeyQ is "Q"). It presses the
//   first-declared of its codes. walk's W and ↑ are both "Forward": one
//   button.
// - A control whose codes include an arrow key takes the first such arrow's
//   place on the pad (up, down, left, right); the rest are buttons. A code
//   is in one control at most (one reserver, one label), so no place is
//   held twice.
//   That is the keyboard's geometry, not the label's words: the stage knows
//   nothing about "Forward".
// - keyOf(code) is the KeyboardEvent.key a US keyboard sends for the code,
//   since handlers read ev.key ("q", "Alt") as often as ev.code.

import { labelOf, reservedBy } from "./keymap.js";

/** The router's key order: the open gesture, the held tool, the body (keymap.js). */
const ORDER = ["gesture", "tool", "body"];

/** The pad's places, by the arrow code that names each. */
const SLOTS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

// codes whose key is the code itself
const SAME = new Set(["Enter", "Escape", "Delete", "Backspace", "Tab", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Insert", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);
const MODIFIERS = { ShiftLeft: "Shift", ShiftRight: "Shift", AltLeft: "Alt", AltRight: "Alt", ControlLeft: "Control", ControlRight: "Control", MetaLeft: "Meta", MetaRight: "Meta" };
// the punctuation codes, as keymap.js codeOfKey reads them (inverted)
const PUNCT = { Space: " ", Period: ".", Comma: ",", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`", Backslash: "\\" };

/**
 * The KeyboardEvent.key a US keyboard sends for a code, with no modifier
 * held, or "Unidentified" for a code not in the table.
 * @param {string} code  KeyboardEvent.code
 */
export function keyOf(code) {
  if (typeof code !== "string") return "Unidentified";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (SAME.has(code)) return code;
  return MODIFIERS[code] ?? PUNCT[code] ?? "Unidentified";
}

/** A code as a person reads it, when its declaration has no label: "Q", "Shift", "↑", "Space"; else the code itself. */
export function nameOf(code) {
  const key = keyOf(code);
  return key === "Unidentified" ? String(code) : labelOf(key);
}

/** A declaration's entries as { code, label }, the first of each code only. */
function entries(declared) {
  const out = [];
  const seen = new Set();
  for (const k of Array.isArray(declared) ? declared : []) {
    const code = typeof k === "string" ? k : k?.code;
    if (typeof code !== "string" || !code || seen.has(code)) continue;
    seen.add(code);
    const label = typeof k === "object" && typeof k.label === "string" && k.label ? k.label : nameOf(code);
    out.push({ code, label });
  }
  return out;
}

/**
 * The touch controls for a view, in the key order and then declared order.
 * @param {{ gesture?: { keys? } | null, held?: { keys? } | null, body?: { keys? } | null }} view  api.view.get()'s fields
 * @returns {{ code: string, key: string, label: string, slot: "up" | "down" | "left" | "right" | null, from: "gesture" | "tool" | "body" }[]}
 */
export function touchControls({ gesture = null, held = null, body = null } = {}) {
  const layers = { gesture, tool: held, body };
  const out = [];
  for (const from of ORDER) {
    const groups = new Map(); // label → { code, label, codes }
    for (const { code, label } of entries(layers[from]?.keys)) {
      if (reservedBy(code, layers) !== from) continue;
      const g = groups.get(label);
      if (g) g.codes.push(code);
      else groups.set(label, { code, label, codes: [code] });
    }
    for (const { code, label, codes } of groups.values()) {
      const slot = codes.map((c) => SLOTS[c]).find(Boolean) ?? null;
      out.push({ code, key: keyOf(code), label, slot, from });
    }
  }
  return out;
}
