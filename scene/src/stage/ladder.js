// The Escape ladder (STAGE.md, "Keys"): one press of Escape pops exactly one
// layer, the top one standing, and the hint names the layer the next press
// would pop. Pure: the router gathers the state and does what this says.
//
// The rungs, top first:
//   0. lock      the pointer lock. The browser's own Escape releases it,
//                unseen by the page (stage/pointer.js): the page never pops it
//   1. field     a focused text field (it blurs; a search field with text
//                clears first, then blurs: the router does this rung)
//   2. popover   an open menu or dialog (it closes)
//   3. gesture   an open press session, a carry (it is put back)
//   4. tool      the held tool (it is put down)
//   5. selection (it clears)
//   6. focus     an entered link (Leave): one level out
// Never the body (Leave, the body chip or a verb does that), never the
// clock.

/** The rungs, top first. */
export const RUNGS = Object.freeze(["lock", "field", "popover", "gesture", "tool", "selection", "focus"]);

/**
 * The layer an Escape pops now, or null when nothing stands.
 * @param {{ lock?: boolean, field?: boolean, popover?: boolean, gesture?: boolean, tool?: boolean, selection?: boolean, focus?: number }} s
 *   focus: how deep the focus is (0: the scene's own)
 * @returns {"lock" | "field" | "popover" | "gesture" | "tool" | "selection" | "focus" | null}
 */
export function escapeLayer(s) {
  for (const r of RUNGS) {
    const on = r === "focus" ? (Number(s?.[r]) || 0) > 0 : !!s?.[r];
    if (on) return r;
  }
  return null;
}

/**
 * The state after one Escape: the top layer popped and nothing else. The
 * lock's rung is popped by the browser (the page only hears it as a lost
 * lock).
 * @param {object} s  as escapeLayer takes
 */
export function escapeStep(s) {
  const top = escapeLayer(s);
  if (!top) return s;
  if (top === "focus") return { ...s, focus: (Number(s.focus) || 0) - 1 };
  return { ...s, [top]: false };
}

const HINTS = {
  lock: "release pointer",
  field: "leave the field",
  popover: "close",
  gesture: "put it back",
  tool: "put down",
  selection: "deselect",
  focus: "leave",
};

/** What the Esc hint says for a layer ("Esc: deselect"), or "" when nothing stands. */
export function escapeHint(layer, { tool = null } = {}) {
  if (!layer) return "";
  if (layer === "tool" && tool) return `put down ${tool}`;
  return HINTS[layer] ?? "";
}
