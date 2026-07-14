# Geo Shapes card

Turns geo shapes on for a canvas. Drop this card onto a canvas and every map
there draws the markers and lines that geo-shape sources publish; remove it and
they disappear.

- publishes the geo-shape renderer map extension into the canvas
  `map:extensions` channel while present, released on removal
- scoped to the canvas the card is on
- does nothing off-canvas (no context to publish into)
- shape *sources* (geo-markers, geo-lines, or any other card writing the
  `geo:shapes` channel) still publish independently; this card only controls
  whether shapes get drawn
- relies on the map extensions host (shipped in @embark/core) to
  install what it publishes
