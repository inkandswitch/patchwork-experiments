# Geo Zoom card

Makes maps frame what matters. Drop this card onto a canvas and every map
there eases its camera toward highlighted geo shapes; remove it and the camera
stops moving on its own.

- publishes a zooming map extension into the canvas `map:extensions` channel
  while present, released on removal
- watches the `geo:shapes` channel and the focus union (selection ∪ highlight);
  precedence: frame a focused line (plus focused pins of the same documents) >
  zoom in on a crowded focused pin until it clears its neighbours > widen the
  home view just enough to reveal shapes outside it
- the home view the overlay returns to is snapshotted onto *this card's*
  document before the first programmatic move — the map document only ever
  records manual pans/zooms
- a move the extension didn't make (a manual gesture, the map search panel, a
  remote viewport change) adopts the new camera as home
- holds off while the pointer is over the map, catching up when it leaves
