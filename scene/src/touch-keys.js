// Touch controls derived from declared keys (STAGE.md, "Keys"). Pure: no DOM,
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
// - A control presses its code with the key a US keyboard sends for it
//   (keymap.js keyOfCode), since handlers read ev.key as often as ev.code.
//
// The contract this reads into a declaration (STAGE.md, "Bodies"): codes one
// reserver labels alike do the same thing, so touch shows one control for
// them. Labels are one per reserver, not across them: a pad shows each
// control under its reserver (`from`).

import { declaredKeys, keyOfCode, nameOfCode, reservedBy } from "./keymap.js";

/** The router's key order: the open gesture, the held tool, the body (keymap.js). "tool" is the view's `held` slot, by reservedBy's name for it. */
const ORDER = ["gesture", "tool", "body"];

/** The pad's places, by the arrow code that names each. */
const SLOTS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/**
 * The touch controls for a view, in the key order and then declared order.
 * @param {{ gesture?: { keys? } | null, held?: { keys? } | null, body?: { keys? } | null }} view  api.view.get()'s fields
 * @returns {{ code: string, key: string, label: string, slot: "up" | "down" | "left" | "right" | null, from: "gesture" | "tool" | "body" }[]}
 *   `from` is reservedBy's name for the layer ("tool" is `held`), so reservedBy(code, …) === from for every control
 */
export function touchControls({ gesture = null, held = null, body = null } = {}) {
  const layers = { gesture, tool: held, body };
  const out = [];
  for (const from of ORDER) {
    const groups = new Map(); // label → { code, label, codes }
    for (const { code, label: declared } of declaredKeys(layers[from]?.keys)) {
      if (reservedBy(code, layers) !== from) continue;
      const label = declared ?? nameOfCode(code);
      const g = groups.get(label);
      if (g) g.codes.push(code);
      else groups.set(label, { code, label, codes: [code] });
    }
    for (const { code, label, codes } of groups.values()) {
      const slot = codes.map((c) => SLOTS[c]).find(Boolean) ?? null;
      out.push({ code, key: keyOfCode(code), label, slot, from });
    }
  }
  return out;
}
