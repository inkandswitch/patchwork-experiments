# Finding documents on the canvas (schema queries)

To discover documents by shape — "every doc with a `{lat, lon}`", "every text
document", "the map" — subscribe to `schema:matches` declaring the schema's
key as your read interest. Reading is asking: the Schema Matcher card watches
who reads which keys of `schema:matches`, matches each requested schema over
every document in the `open-documents` set, and answers under the same key
(both cards are normally on the canvas; your card just speaks the channel).

Uses `findContextStore` / `ownerOf` — copy the boilerplate from the system
prompt verbatim, never invent your own (a wrong version fails silently).

## The key IS the schema

A `schema:matches` key is the schema itself, canonically stringified (sorted
object keys). The matcher parses the key back with `JSON.parse`, and two
consumers with the same schema share one key and one result array. Always
build keys with this helper:

```js
function schemaKey(schema) {
  return stableStringify(schema);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}
```

## Subscribe with keys, watch

```js
import { parseAutomergeUrl } from "@automerge/automerge-repo";

const SchemaMatches = { name: "schema:matches", empty: {} };

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

const onMatches = () => {
  const urls = store.read(SchemaMatches)[MAP_KEY] ?? [];
  // ... reconcile against the urls you're already tracking ...
};
// `keys` is the query: the matcher answers every key readers declare. Keep
// the subscription alive as long as you want answers — a bare read() creates
// no demand, and when your last subscription ends the key drops out.
const unsub = store.subscribe(SchemaMatches, onMatches, {
  owner,
  keys: [MAP_KEY],
});
onMatches(); // no initial emit — seed once

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
  schemas simple and structural.
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
