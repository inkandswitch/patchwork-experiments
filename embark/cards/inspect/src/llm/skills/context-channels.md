# The shared context store

Cards coordinate through a store of named channels. Almost every card reads or
writes at least one channel — read this skill before writing any card that
interacts with the canvas.

## Resolving the store and your identity

```js
function findContextStore(el) {
  const request = new CustomEvent("patchwork:context-request", {
    bubbles: true, composed: true, detail: {},
  });
  el.dispatchEvent(request);
  return request.detail.store
    ?? document.body[Symbol.for("patchwork.context-store.v1")];
}

// Every subscribe and handle MUST carry an owner: the embed making the call.
function ownerOf(element) {
  const view = element.closest("patchwork-view");
  return {
    docUrl: view?.getAttribute("doc-url") ?? undefined,
    embedId: element.closest("[data-embed-id]")?.getAttribute("data-embed-id") ?? undefined,
    toolId: view?.getAttribute("tool-id") ?? undefined,
  };
}
```

Call both once in setup. Channels are matched **by name**, so define them
inline in your module:

```js
const Highlight = { name: "highlight", empty: {} };
```

## The store API

```js
const store = findContextStore(element);
const owner = ownerOf(element);

store.read(Highlight);                                   // merged value across all writers
const unsub = store.subscribe(Highlight, (v) => {}, { owner }); // fires on change
const scope = store.handle(Highlight, owner);            // your card's own slice
scope.change((slice) => { slice[docUrl] = true; });      // mutate ONLY your slice
scope.read();                                            // your slice alone (rare)
scope.release();                                         // in cleanup — removes your contribution
```

Rules that bite if you forget them:

- **No initial emit.** `subscribe` fires only on the *next* change. Seed by
  calling your callback once with `store.read(...)` right after subscribing.
- **Merge is one level deep.** Readers see the union of every writer's
  top-level keys. When two writers set the same key: arrays concatenate,
  anything else is last-writer-wins (objects are taken whole, never merged).
  Contribute disjoint keys (your own doc urls, your own queries).
- **Release everything.** `scope.release()` drops your whole contribution and
  is your garbage collection. Every `store.handle(...)` needs a matching
  `release()` in cleanup; every `subscribe` needs its unsubscribe called.
- **Values are JSON** (the one exception: `codemirror:extensions` carries live
  objects — see below).
- Writes are coalesced on a microtask and subscribers only fire when the
  merged value actually changed, so you don't need to dedupe writes yourself.

## Channel roster

Set channels (value is `{ [key]: true }`; the merged value is the key union):

- `selection`: `{ [docUrl]: true }` — the embed(s) selected on the canvas
- `highlight`: `{ [docUrl]: true }` — docs to emphasize (hover glow). Owning a
  slice here is how you light up other embeds on hover: clear-and-set your
  slice on mouseenter, clear it on mouseleave.
- `open-documents`: `{ [docUrl]: true }` — the documents currently in scope.
  Add docs you mint so other cards can discover them (see minting-documents).

Request/response pairs (write requests as a set, answers as a record):

- `search:queries`: `{ [query]: true }` / `search:results`: `{ [query]: docUrl[] }`
- `commands:queries`: `{ [query]: true }` / `commands:suggestions`:
  `{ [query]: { label, url }[] }` — for the `/` command menu
- `schema:matches`: `{ [schemaKey]: docUrl[] }` — "which open docs match this
  JSON Schema?" No request channel: subscribe with `keys: [schemaKey]` (the
  key is the canonical JSON of the schema) and the matcher answers under that
  key. See finding-documents.

Other channels:

- `stickers`: `{ [targetDocUrl]: Sticker[] }` — inline annotations on
  documents (see sticker-source for the sticker shapes)
- `codemirror:extensions`: `{ [stableKey]: Extension }` — live CodeMirror
  extension objects, NOT JSON. Create the extension ONCE and publish the same
  reference; the store compares by identity per key (see capability-toggle).
- `pointer`: `{ x, y, docUrl?, embedId?, pressed? }` — the shared pointer,
  published by the Pointer card when one is on the canvas

## High-frequency sources (sensor cards)

A card that turns DOM events into channel state (pointer positions, scroll,
keys) should:

- listen on `window` with `{ capture: true }` so embeds that stop propagation
  can't hide events from it,
- throttle writes with `requestAnimationFrame`: events stash the latest state,
  one frame callback writes it (one context write per frame),
- cancel the pending frame and remove all listeners in cleanup, then release
  its handles.
