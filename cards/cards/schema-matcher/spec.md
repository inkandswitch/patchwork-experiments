# Schema Matcher card

Answers "where, in any open document, does this shape occur?" for a canvas.
While the card is face-up it matches JSON Schemas against the documents in
scope and answers with precise locations; flip or remove it and the answers
retract. This package owns the schema-matching vocabulary — consumers import
`./channels.js` (and helpers) by this package's automerge url.

## Channels

### `schema:matches` (`SchemaMatches`)

Queries and answers in one: `{ [schemaKey(schema)]: matchUrl[] }`.

- **Reading is asking.** A consumer subscribes with a declared key interest —
  `keys: [schemaKey(schema)]`, where each key is the canonical schema JSON, so
  `JSON.parse(key)` recovers the schema exactly. The matcher card watches the
  channel's reader registry (`store.interests(SchemaMatches)`) and answers
  under the same key. There is no separate query channel; a bare `read()`
  registers no interest and is never answered.
- Two consumers with the same schema share one key and one result array; when
  a key's last reader unsubscribes, its entry drops out. Readers that declare
  no keys (inspectors) are passive observers and create no queries.
- A queried key always gets an entry — an empty array when nothing matches —
  so the request stays visible.
- Each match url is a native automerge sub-url (`automerge:<id>/seg/seg`,
  from `handle.sub(...segments).url`) pointing at the exact subtree that
  matched; the bare document url when the whole doc matched. `repo.find`
  resolves a sub-url straight to the matched subtree.
- Empty arrays never match "array of X" schemas (a vacuous occurrence is not
  an occurrence). Non-empty arrays that are merely too short for a consumer
  are that consumer's job to filter.
- Answer-side writers besides the matcher are legal: a card that mints
  documents satisfying a queried schema (the bird card, say) may write its
  urls into its own slice under that key; readers see the union.

### `open-documents` (`OpenDocuments`)

The documents in scope for matching, as a url-keyed set (`{ [url]: true }`,
`set: true` — the merged value is the key union across writers).

- Each writer contributes its own scoped slice; releasing a scope drops
  exactly its docs.
- The Open Documents card publishes the frame's selected document plus its
  link closure; cards that mint synthetic documents (the POI provider,
  stickerable mirrors) add theirs. The closure is the writer's job — the
  matcher never walks links itself.

## Helpers

- `./channels.js` — the channel definitions above plus `schemaKey(schema)`:
  the stable, canonical stringification (sorted object keys) every consumer
  keys with. Correlation is purely structural — two packages that describe the
  same shape produce the same key and share one result slot, no central
  registry.
- `./match.js` — `jsonSchemaMatches(schema, value)`: the structural matcher
  the engine runs; importable by cards that need to test values against a
  queried schema themselves. Covers the subset zod 4's `z.toJSONSchema` emits
  (object/array/string/number/integer/boolean/null, enum, const,
  anyOf/oneOf/allOf, `type` arrays); objects are lenient (unknown keys
  ignored), and unrecognized constructs degrade to "matches".
- `./doc-links.js` — `extractDocLinks(text)` / `linkedUrls(doc)`: the
  document-link extractor closure writers use.

## Card behavior (`./card.js`)

Runs the matcher engine while face-up: unions the queried keys over the reader
registry, watches every `open-documents` url (rematching when a doc changes,
the set changes, or the demand changes, debounced 50ms), and rewrites its
whole `schema:matches` slice per pass. The card is the only writer expected to
answer arbitrary schemas. Matching runs where the card sits — its element
resolves the canvas's context store and attributes the traffic to the card's
embed.
