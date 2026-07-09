# Pointer card — the `pointer` channel

This package owns the shared **`pointer` channel** and the card that feeds it.

## The channel (./channels.js)

`{ x?, y?, docUrl? }` — where the last press landed (viewport coordinates) and
the document it landed on. The document is resolved generically from the
closest enclosing `<patchwork-view>` (its `doc-url`, or `url` in component
mode), so any mounted view counts — a canvas embed, a sidebar card, a
full-frame editor. Single-writer: only the Pointer card publishes, so the
merged value is that card's slice, and with no pointer card running the channel
rests at its empty value. `docUrl` is absent while the press landed outside any
view.

Readers import the definition from this package (by its automerge url +
`channels.js`) and decide for themselves what the pointed-at document means.

## The card (./card.js)

While face-up it listens for `mousedown` on the document (capture phase, so
views that stop propagation can't hide the press) and publishes each press into
its channel slice. Flipping or removing the card releases the slice and the
channel goes quiet. It renders nothing into the middle slot.
