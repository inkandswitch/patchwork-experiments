// Escape (STAGE.md, "Escape"): one press pops exactly one layer, the top one
// standing, and the hint names what the next press does. Pure: the router
// gathers the state and does what this says.
//
// Top first:
//   lock     the pointer lock. The browser's own Escape releases it, unseen
//            by the page (stage/pointer.js): the page never pops it
//   field    a focused text field (it blurs; a search field with text clears
//            first: the router does this one)
//   gesture  an open press session, a carry (it is put back)
//   hand     the top hand: its escape() first (a popover closes; the Edit
//            hand clears the selection, then leaves the entered link), and
//            when that does nothing the hand is put down
//   rest     with no hand held, the view's own: the selection clears, then
//            the focus leaves one link
// Never a body (Leave, the body chip or a verb does that), never the clock.

/**
 * What the view's own Escape does now: clear the selection, else leave the
 * entered link, else nothing. The Edit hand's escape is this too.
 * @param {{ selection?: boolean, focus?: number }} s  focus: how deep (0: the outermost)
 * @returns {"selection" | "focus" | null}
 */
export const restLayer = (s) => (s?.selection ? "selection" : (Number(s?.focus) || 0) > 0 ? "focus" : null);

/**
 * The layer an Escape pops now, or null when nothing stands.
 * @param {{ lock?: boolean, field?: boolean, gesture?: boolean,
 *   hand?: { kind: string, escaping?: string | null } | null,   // the top hand; escaping: what its escape() does now (null: nothing, so it is put down)
 *   rest?: "selection" | "focus" | null }} s
 * @returns {"lock" | "field" | "gesture" | "popover" | "hand" | "selection" | "focus" | null}
 */
export function escapeLayer(s) {
  if (s?.lock) return "lock";
  if (s?.field) return "field";
  if (s?.gesture) return "gesture";
  const h = s?.hand;
  if (h) return h.escaping ?? (h.kind === "popover" ? "popover" : "hand");
  return s?.rest ?? null;
}

const HINTS = {
  lock: "release pointer",
  field: "leave the field",
  popover: "close",
  gesture: "put it back",
  hand: "put down",
  selection: "deselect",
  focus: "leave",
};

/** What the Esc hint says for a layer ("Esc: deselect", "Esc: put down Edit"), or "" when nothing stands. */
export function escapeHint(layer, { hand = null } = {}) {
  if (!layer) return "";
  if (layer === "hand" && hand) return `put down ${hand}`;
  return HINTS[layer] ?? "";
}
