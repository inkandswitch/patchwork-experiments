# Commands card

Turns the `/` command menu on for a canvas. Drop this card onto a canvas and
every text editor there gains slash commands: type `/` to see the commands on
offer, then pick one to drop its result into the note. Remove the card and the
menu goes away again.

- publishes the slash-command codemirror extension into the canvas
  `codemirror:extensions` channel while present, released on removal
- each suggestion previews as the real thing it will insert, not just a label
- suggestions come from provider cards (weather, routes, …) answering the
  command channels in [commands](../../context/commands)
- does nothing off-canvas (no context to publish into)
- relies on the [codemirror extensions host](../../context/codemirror-extensions-host)
  to install what it publishes
