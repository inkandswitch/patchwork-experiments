# Pointer card — the `pointer` channel

This package owns the shared **`pointer` channel** and the card that feeds it.

## The channel (./channels.js)

`{ x?, y?, docUrl?, embedId?, pressed? }` — where the pointer is (viewport
coordinates), the embed under it (the same `[data-embed-id]` /
`<patchwork-view doc-url>` structure `requireOwner` reads), and whether a
button is held. Single-writer: only the Pointer card publishes, so the merged
value is that card's slice, and with no pointer card on the canvas the channel
rests at its empty value. `docUrl`/`embedId` are absent while the pointer is
over empty canvas or outside it.

Readers import the definition from this package (by its automerge url +
`channels.js`) and decide for themselves what the pointer means — the context
viewer follows it as a hands-free alternative to its target button, but only
while its target mode is armed.

## The card (./card.js)

While face-up it listens to the page's pointer events (capture-phase window
listeners, so drag surfaces can't hide the pointer) and publishes rAF-throttled
updates into its channel slice. Flipping or removing the card releases the
slice and the channel goes quiet. It renders nothing into the middle slot.
