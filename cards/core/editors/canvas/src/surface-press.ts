// The surface-press heuristic: a frameless surface (a canvas embed, a deck
// card slot) is dragged by grabbing anywhere on it — except where the press
// lands on something the user plainly means to interact with. Shared by the
// canvas's embed move and the deck's deal-out drag.

// Elements that own a press on a frameless surface: form controls, buttons,
// links, and editable regions. A press here should reach the element rather
// than start a drag.
export const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a[href], [contenteditable]";

// True when a surface press should be left alone instead of starting a drag:
// it landed on an interactive element, or directly on a run of selectable text.
export function pressLandsOnInteractiveOrText(event: PointerEvent): boolean {
  const target = event.target as Element | null;
  if (target?.closest(INTERACTIVE_SELECTOR)) return true;
  return pointHitsText(event.clientX, event.clientY);
}

// True when (clientX, clientY) falls on actual rendered, selectable text. The
// caret hit-test snaps to the nearest character even in empty padding, so
// confirm the point really lies within that character's box (with a little
// slack) — a press in the gaps beside text still starts a drag.
export function pointHitsText(clientX: number, clientY: number): boolean {
  const hit = caretHitAtPoint(clientX, clientY);
  if (!hit || hit.node.nodeType !== Node.TEXT_NODE) return false;
  const text = hit.node.textContent ?? "";
  if (!text.trim()) return false;

  // Text the user can't select anyway (user-select: none — e.g. a card's
  // decorative labels) shouldn't hold up the drag; there's no selection
  // gesture to protect.
  const parent = hit.node.parentElement;
  if (parent && getComputedStyle(parent).userSelect === "none") return false;

  const range = document.createRange();
  const start = Math.max(0, Math.min(hit.offset, text.length - 1));
  range.setStart(hit.node, start);
  range.setEnd(hit.node, start + 1);

  const TOLERANCE = 2;
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (
      clientX >= rect.left - TOLERANCE &&
      clientX <= rect.right + TOLERANCE &&
      clientY >= rect.top - TOLERANCE &&
      clientY <= rect.bottom + TOLERANCE
    ) {
      return true;
    }
  }
  return false;
}

// Cross-browser caret hit-test: the standard `caretPositionFromPoint` (Firefox)
// vs WebKit's `caretRangeFromPoint` (Chrome/Safari). Returns the node + offset
// under the point, or null when neither is available or the point hits nothing.
export function caretHitAtPoint(
  clientX: number,
  clientY: number,
): { node: Node; offset: number } | null {
  const withPosition = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof withPosition.caretPositionFromPoint === "function") {
    const pos = withPosition.caretPositionFromPoint(clientX, clientY);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  const withRange = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof withRange.caretRangeFromPoint === "function") {
    const range = withRange.caretRangeFromPoint(clientX, clientY);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  return null;
}
