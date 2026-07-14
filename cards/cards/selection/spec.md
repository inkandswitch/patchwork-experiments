# Selection card — the `selection` and `highlight` channels

This package owns the two shared **focus channels** and gives them a physical
representation on the canvas.

## The channels (./channels.js)

Both are **set channels** of document urls — `{ [docUrl]: true }` — merged as
the key union across every contributing scope:

- **`selection`** — the canvas's selected embeds. Published by the canvas
  editor (the single writer today) whether or not this card is present.
- **`highlight`** — auxiliary emphasis any view contributes: hovered map pins,
  caret-touched mention tokens, hovered embed tokens. Many writers; each owns
  its slice and the union is what readers render.

Consumers import the definitions from this package (bundleless cards through
its automerge url + `channels.js`, bundled editors through a `link:`
dependency) rather than restating `{ name: "selection", … }`. Ownership here is
definition custody and visibility — not a capability gate: the hard dependency
is on this *package* being reachable, not on the card being face-up.

## Shared token UI (./tokens.js)

`EmbedToken`, `useHighlight`, `useDocTitles`, `shortId` — the building blocks
context views use to draw document-url tokens with the shared hover→highlight
interaction. They live here because the hover interaction writes the
`highlight` channel this package owns. The `doc-url` context view registered by
this package (./views.js) draws every doc-url key/value in the context viewer.

## The card (./card.js)

Read-only: while face-up it renders the live focus state — the titles of the
currently selected and highlighted documents — in the middle slot. It writes
neither channel; removing the card changes nothing about how focus works.
