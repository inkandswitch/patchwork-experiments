# The shared context store

Cards coordinate through a store of named channels. Almost every card reads or
writes at least one channel — read this skill before writing any card that
interacts with the canvas.

Every channel is OWNED by a package: the owner exports the channel definition
(and any helpers/engines that ride with it) from its `channels.js`, and every
consumer imports it from there. NEVER restate a channel object inline — import
the definition from the owning package listed in the roster below.

## The client: import, don't inline

The store client lives in the `@embark/core` package. Import it by
automerge url with top-level await:

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const { findContextStore, subscribeContext, getContextHandle, requireOwner } =
  await import(getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js"));
```

and declare the dependency in the package's `package.json`:

```json
"dependencies": {
  "@embark/core": "automerge:2YxstDCjGbfeAqud8w38yuBYBncY"
}
```

(Every automerge-url package you import needs such an entry — sandboxed frames
only rewrite declared urls, so an undeclared import fails there.)

The client functions are node-relative: pass the card's `element` and they
resolve the store and attribute your reads/writes to the embed the card lives
in. You almost never need the raw store.

```js
// Read + react. Delivers the current merged value once (async), then on every
// change — no manual seeding needed. Returns the unsubscribe function.
const unsub = subscribeContext(element, SomeChannel, (value) => { ... });

// Declared key interest (attribution; for schema:matches it IS the query):
const unsub2 = subscribeContext(element, SchemaMatches, cb, [KEY]);

// Write. Your card's own slice of the channel; call release() in cleanup.
const scope = getContextHandle(element, SomeChannel);
scope.change((slice) => { slice[myKey] = myValue; });
scope.read();     // your slice alone (rare)
scope.release();  // in cleanup — removes your whole contribution

// Escape hatches (rare): the raw store and your identity.
const store = findContextStore(element);   // read/scopes/interests/channels
const owner = requireOwner(element);       // { docUrl?, embedId?, toolId? }
```

## Rules that bite if you forget them

- **Merge is one level deep.** Readers see the union of every writer's
  top-level keys. When two writers set the same key: arrays concatenate,
  anything else is last-writer-wins (objects are taken whole, never merged).
  Contribute disjoint keys (your own doc urls, your own queries).
- **Release everything.** Every `getContextHandle(...)` needs a matching
  `release()` in cleanup; every `subscribeContext` needs its unsubscribe
  called. Releasing a scope is your garbage collection: it drops your whole
  contribution at once.
- **Values are JSON** (exceptions: `codemirror:extensions` and
  `map:extensions` carry live objects — publish a stable reference, see
  capability-toggle / map-extensions).
- Writes are coalesced on a microtask and subscribers only fire when the
  merged value actually changed, so you don't need to dedupe writes yourself.

## Channel roster

Channels are matched by `name`; the definition module is the contract. Import
from the owning package (url + subpath as in the client import above), and
declare the dependency. The live `channels.list()` API shows what is actually
on the canvas right now, with the same `definedBy`/`spec` attributions.

`@embark/core` — `automerge:2YxstDCjGbfeAqud8w38yuBYBncY`
- `client.js`: the store client (above).
- `channels/codemirror.js`: `CodemirrorExtensions` (`codemirror:extensions`,
  `{ [stableKey]: Extension }`) — live CodeMirror extension objects, NOT JSON;
  see capability-toggle.
- `channels/map.js`: `MapExtensions` (`map:extensions`,
  `{ [stableKey]: MapExtension }`) — live extension functions installed into
  every map; see map-extensions.

`@embark/selection` — `automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW`
- `channels.js`: `Selection` (`selection`) and `Highlight` (`highlight`), both
  sets of doc urls `{ [docUrl]: true }`. Selection is the canvas's selected
  embed(s); highlight is emphasis (hover glow) — clear-and-set your slice on
  mouseenter, clear on mouseleave to light up other embeds.

`@embark/schema-matcher` — `automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC`
- `channels.js`: `SchemaMatches` (`schema:matches`, `{ [schemaKey]: url[] }` —
  reading with a declared key IS the query, see finding-documents),
  `OpenDocuments` (`open-documents`, `{ [docUrl]: true }` — the documents in
  scope; announce docs you mint, see minting-documents), and `schemaKey(schema)`.
- `match.js`: `jsonSchemaMatches(schema, value)` — the matcher's own validator.
- `doc-links.js`: `extractDocLinks(text)` / `linkedUrls(doc)`.

`@embark/stickers-card` — `automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy`
- `channels.js`: `Stickers` (`stickers`, `{ [docUrl]: Sticker[] }` — inline
  text annotations; the sticker typedefs live here too).
- `engine.js`: `runStickerSource(element, { scan }, onCount?)` — the whole
  sticker-source machinery; see sticker-source.

`@embark/mentions-card` — `automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh`
- `channels.js`: `SearchQueries` (`search:queries`, `{ [query]: true }`) and
  `SearchResults` (`search:results`, `{ [query]: docUrl[] }`); see
  search-provider.

`@embark/commands-card` — `automerge:asYz1WKN9GHigxdQPVVfr5h8MuW`
- `channels.js`: `CommandQueries` (`commands:queries`, `{ [query]: true }`)
  and `CommandSuggestions` (`commands:suggestions`,
  `{ [query]: { label, url }[] }`); see command-provider.
- `place-resolve.js`: `createPlaceResolver(store, repo, owner)` — resolve
  place-like arguments against the canvas, then Nominatim.
- `fuzzy.js`: `fuzzyMatch(needle, haystack)`.

`@embark/geo-shapes-card` — `automerge:7tDif9cz12ZQXv55Yo73io1UUw4`
- `channels.js`: `GeoShapes` (`geo:shapes`, `{ [docUrl]: GeoShape[] }`) —
  write markers/lines here and the renderer draws them on every map; shape
  typedefs live here. See map-extensions.

`@embark/pointer` — `automerge:uMCUHr7SvWiwF1YtmZsWhnUhWY2`
- `channels.js`: `Pointer` (`pointer`, `{ x, y, docUrl?, embedId?, pressed? }`)
  — the shared pointer, published by the Pointer card when one is face-up.

To define a NEW channel your card owns, see defining-a-channel.

## High-frequency sources (sensor cards)

A card that turns DOM events into channel state (pointer positions, scroll,
keys) should:

- listen on `window` with `{ capture: true }` so embeds that stop propagation
  can't hide events from it,
- throttle writes with `requestAnimationFrame`: events stash the latest state,
  one frame callback writes it (one context write per frame),
- cancel the pending frame and remove all listeners in cleanup, then release
  its handles.
