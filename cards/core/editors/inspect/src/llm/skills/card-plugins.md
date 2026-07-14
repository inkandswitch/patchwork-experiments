# Card plugins (datatypes and tools that live with the card)

A card that mints its own document kind (a forecast, a place, a route) must
also provide the datatype and the view(s) that render it. Export a `plugins`
array from the behavior module and the card shell registers them while the
card is face-up — flip or remove the card and they retract with it. No
package-level registration, no separate install step.

```js
// In card.js, next to the default export:
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "poi-card",
    name: "Place",
    icon: "MapPin",
    async load() {
      const { PoiCardDatatype } = await import("./datatype.js");
      return PoiCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "poi-card",
    name: "Place",
    icon: "MapPin",
    supportedDatatypes: ["poi-card"],
    async load() {
      const { PoiCardView } = await import("./view.js");
      return PoiCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "poi-card-token",
    name: "Place token",
    icon: "MapPin",
    supportedDatatypes: ["poi-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { PoiCardToken } = await import("./token.js");
      return PoiCardToken;
    },
  },
];
```

- Descriptors are metadata plus a lazy `load()` — keep implementations in
  sibling modules (`datatype.js`, `view.js`, `token.js`) so registering is
  cheap and the code loads only when something renders your kind.
- `icon` is a Lucide icon name.
- Two faces per document kind is the norm: the board tool (full-size view,
  `id` matching the datatype) and the token face (`tags: ["token"]`,
  `unlisted: true` so pickers skip it) that editors use for inline tokens.

## The implementations

A **datatype** describes documents of your kind:

```js
export const PoiCardDatatype = {
  init(doc) {            // a fresh doc of this kind
    doc["@patchwork"] = { type: "poi-card" };
    doc.name = "";
  },
  getTitle(doc) { return doc.name || "Place"; },
  setTitle(doc, title) { doc["@patchwork"].title = title; },
};
```

A **tool** is `(handle, element) => cleanup` — the same contract as the card
module itself: render the document into `element`, re-render on
`handle.on("change", ...)`, undo everything in the cleanup. Token faces
should be compact single-line chips with inline styles (they sit inside an
editor's line box); board faces can render freely (Solid via `solid-js/html`
works — see card-ui).

## Lifecycle semantics

- Registration happens when the shell loads your module; retraction when the
  card flips down, is removed, or the module hot-reloads (re-registered after
  the new module loads). Two face-up instances refcount — plugins stay until
  the last one leaves.
- Documents referencing your datatype OUTLIVE the card: a token inserted into
  a note stays there. While the owning card is gone the token can't render
  (unknown tool) — that's expected and heals when the card is face-up again.
- Keep ids stable across regenerations (they're stored in documents and
  sticker `toolId`s). Prefix with your card's kind: `poi-card`,
  `poi-card-token`.
- Sticker sources that publish `{ type: "tool", toolId, docUrl }` stickers
  (see sticker-source) use the same mechanism: export the tool your stickers
  reference from `plugins`.
