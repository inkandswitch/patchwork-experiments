# Highlight card

While face-up, this card reads the shared **`highlight` channel** (owned by the
Selection card) and draws a blue glow around every mounted `<patchwork-view>`
whose document is highlighted — wherever that view is: a canvas embed, a
sidebar card, a full-frame editor.

It replaces the per-surface special cases (the canvas embed ring, the deck
thumbnail glow) with one generic mechanism: views are matched by their
`doc-url` (or component-mode `url`) attribute, normalized to document ids so a
sub-document highlight still lights up the view rendering its document. The
glow is a single injected CSS class (`embark-highlighted`); a
MutationObserver classes views that mount or repoint after an emission.

The card writes nothing — hovering views, mention tokens, and map pins remain
the publishers. Flipping or removing the card strips every glow.
