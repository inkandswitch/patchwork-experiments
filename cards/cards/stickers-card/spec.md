# Stickers card

Turns stickers on for a canvas. Drop this card onto a canvas and every text
editor there draws the inline annotations that sticker sources produce; remove it
and they stop.

- publishes the sticker renderer codemirror extension into the canvas
  `codemirror:extensions` channel while present, released on removal
- scoped to the canvas the card is on, and self-refcounting across multiple cards
- does nothing off-canvas (no context to publish into)
- sticker *sources* (unit/currency/timer/schedule) still publish their stickers
  independently; this card only controls whether they get drawn
- relies on the codemirror extensions host (shipped in @embark/core) to
  install what it publishes
