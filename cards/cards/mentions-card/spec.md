# Mentions card

Turns `@mentions` on for a canvas. Drop this card onto a canvas and every text
editor there gains mention support; remove it and they lose it again.

- publishes the @mention codemirror extension into the canvas
  `codemirror:extensions` channel while present, released on removal
- scoped to the canvas the card is on, and self-refcounting across multiple cards
- does nothing off-canvas (no context to publish into)
- relies on the codemirror extensions host (shipped in @embark/core) to
  install what it publishes
