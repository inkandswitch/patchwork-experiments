# Finding documents on the canvas (schema queries)

To discover documents by shape — "every doc with a `{lat, lon}`", "every text
document", "the map" — subscribe to the `schema:matches` channel declaring the
schema's key as your read interest. Reading is asking: the Schema Matcher card
watches who reads which keys, matches each requested schema over every
document in the `open-documents` set, and answers under the same key (both
cards are normally on the canvas; your card just speaks the channel).

The channel and its helpers are owned by `@embark/schema-matcher` — import
them, never restate them:

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";

const { subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);
```

Declare both packages in `package.json` `dependencies` (automerge urls — see
context-channels).

## The key IS the schema

A `schema:matches` key is the schema itself, canonically stringified (sorted
object keys) by `schemaKey`. The matcher parses the key back with
`JSON.parse`, and two consumers with the same schema share one key and one
result array. Always build keys with the imported `schemaKey`, never your own
stringifier.

## Subscribe with keys, watch

```js
import { parseAutomergeUrl } from "@automerge/automerge-repo";

const MAP_SCHEMA = {
  type: "object",
  properties: {
    "@patchwork": {
      type: "object",
      properties: { type: { const: "map" } },
      required: ["type"],
    },
    bounds: {
      type: "object",
      properties: {
        west: { type: "number" }, south: { type: "number" },
        east: { type: "number" }, north: { type: "number" },
      },
      required: ["west", "south", "east", "north"],
    },
  },
  required: ["@patchwork", "bounds"],
};
const MAP_KEY = schemaKey(MAP_SCHEMA);

const onMatches = (all) => {
  const urls = all[MAP_KEY] ?? [];
  // ... reconcile against the urls you're already tracking ...
};
// The keys array is the query: the matcher answers every key readers declare.
// Keep the subscription alive as long as you want answers — when your last
// subscription ends the key drops out. subscribeContext delivers the current
// value once, then every change.
const unsub = subscribeContext(element, SchemaMatches, onMatches, [MAP_KEY]);

// cleanup: unsub();
```

To react to a matched document's *content* (not just its existence), resolve
and listen to its handle:

```js
const docHandle = await element.repo.find(url);
const onChange = () => {/* debounce, then re-read docHandle.doc() */};
docHandle.on("change", onChange);
// cleanup: docHandle.off("change", onChange)
```

Guard resolution races: if the tracked url changed while `find` was awaiting,
discard the handle instead of wiring it.

## What the matcher supports and returns

- Schema subset: `type` (object/array/string/number/integer/boolean/null, or
  an array of types), `properties`/`required`, `items`, `enum`, `const`,
  `anyOf`/`oneOf`/`allOf`. Anything else degrades to "matches anything" — keep
  schemas simple and structural. (The exact validator is importable:
  `jsonSchemaMatches` from the package's `match.js`.)
- Objects are **lenient**: `{ lat, lon }` matches a doc that also has `name`
  and `type`. Extra keys never disqualify.
- Matches are the urls of the **subtree** that matched, so a nested match
  comes back as a sub-url. When you only want whole documents, anchor the
  schema on `@patchwork` (it exists only at document roots) or filter:

```js
const isRootUrl = (url) =>
  url === `automerge:${parseAutomergeUrl(url).documentId}`;
```

- Matching runs over the `open-documents` set: the selected document plus
  everything reachable from it through links, plus anything cards have
  announced. If you mint documents that should be findable, announce them
  yourself (see minting-documents).
