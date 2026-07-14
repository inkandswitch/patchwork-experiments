# Pointer card — the `pointer` channel

This package owns the shared **`pointer` channel** and the card that feeds it.

## The channel (./channels.js)

`{ x?, y?, docUrl?, pressed? }` — where the pointer is right now (viewport
coordinates), the document under it, and whether a button is currently held.
The document is resolved generically from the closest enclosing
`<patchwork-view>` (its `doc-url`, or `url` in component mode), so any mounted
view counts — a canvas embed, a sidebar card, a full-frame editor. `docUrl` is
absent while the pointer is over no view.

Single-writer: only the Pointer card publishes, so the merged value is that
card's slice, and with no pointer card running the channel rests at its empty
value.

`pressed` flips true on pointerdown and back on pointerup (or pointercancel /
window blur, so a press that ends off-window can't leave it stuck). Readers
that want "a new press happened" should watch for the rising edge — two
presses on the same spot write otherwise identical state.

Readers import the definition from this package (by its automerge url +
`channels.js`) and decide for themselves what the pointed-at document means.

## The card (./card.js)

While face-up it listens to `pointermove` / `pointerdown` / `pointerup` on the
document (capture phase, so views that stop propagation can't hide the pointer)
and publishes into its channel slice, rAF-throttled to one context write per
frame. Flipping or removing the card releases the slice and the channel goes
quiet. It renders nothing into the middle slot.
