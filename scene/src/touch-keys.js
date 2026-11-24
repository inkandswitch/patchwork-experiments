// Touch controls derived from declared keys (STAGE.md, "Keys"). Pure: no DOM,
// no api.
//
// The open gesture, the hands (held tools) and the body declare the keys they take
// ([{ code, label }]). On touch there is no keyboard, so a pad shows those
// keys as controls a finger can hold. Nothing here is per body: the controls
// come from the declarations alone, in the router's key order.
//
// - A code shows only under the reserver the key resolver names for it
//   (key-order.js reservedBy), so a control always reaches the reserver it's
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
//   (key-order.js keyOfCode), since handlers read ev.key as often as ev.code.
//
// The contract this reads into a declaration (STAGE.md, "Bodies"): codes one
// reserver labels alike do the same thing, so touch shows one control for
// them. Labels are one per reserver, not across them: a pad shows each
// control under its reserver (`from`; for a hand, which one is keyHolder's).

import { declaredKeys, keyHolder, keyLayers, keyOfCode, nameOfCode } from "./key-order.js";

/** The pad's places, by the arrow code that names each. */
const SLOTS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/**
 * The touch controls for a view, in the key order (the gesture, the hands
 * top first, the body: key-order.js keyLayers) and then declared order.
 * @param {{ gesture?: { keys? } | null, hands?: { keys? }[] | null, body?: { keys? } | null }} view  api.view.get()'s fields
 * @returns {{ code: string, key: string, label: string, slot: "up" | "down" | "left" | "right" | null, from: "gesture" | "hand" | "body" }[]}
 *   `from` is reservedBy's name for the layer, and keyHolder(code, view) is the layer each control is under
 */
export function touchControls({ gesture = null, hands = null, body = null } = {}) {
  const view = { gesture, hands, body };
  const out = [];
  for (const { from, layer } of keyLayers(view)) {
    const groups = new Map(); // label → { code, label, codes }
    for (const { code, label: declared } of declaredKeys(layer.keys)) {
      if (keyHolder(code, view)?.layer !== layer) continue;
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
