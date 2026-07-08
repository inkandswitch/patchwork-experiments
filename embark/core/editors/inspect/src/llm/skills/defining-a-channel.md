# Defining a new channel

When no existing channel carries what your card needs to share (check the
roster in context-channels and `channels.list()` first), your card's package
can OWN a new one. Ownership means: the definition lives in YOUR package's
`channels.js`, your `spec.md` documents the contract, and every other card
that speaks the channel imports the definition from you by your package's
automerge url.

## The definition module

Create `channels.js` at the package root. Plain JS, no imports, JSDoc
typedefs for the value shapes:

```js
// The `pomodoro` channel, owned by the Pomodoro card: the running timer's
// state, one slice per timer card.

// This package's own automerge url — the url shown in your task message.
const PACKAGE_URL = "automerge:REPLACE_WITH_YOUR_PACKAGE_URL";

/**
 * One running timer: phase plus the time it ends.
 * @typedef {{ phase: "work" | "break", endsAt: number }} PomodoroState
 */

/** `{ [cardDocUrl]: PomodoroState }` */
export const Pomodoro = {
  name: "pomodoro",
  empty: {},
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};
```

The fields:

- `name` — the wire identity. The store correlates channels purely by name;
  everything else is contract-by-convention. Kebab-case, and namespace
  request/response pairs with a colon (`search:queries`, `search:results`).
- `empty` — the resting value a reader sees when no scope contributes.
  Almost always `{}`.
- `set: true` — mark set channels: values are `true` sentinels and only the
  keys matter (`{ [docUrl]: true }`). Inspectors then render the key union
  and never draw the values.
- `key` / `value` — optional runtime tags ("doc-url", "sticker", …) telling
  generic inspectors how to draw keys/values. Omit if nothing fits.
- `definedBy` / `spec` — attribution: hardcode YOUR package url (never
  `import.meta.url`, which differs between bundled and unbundled contexts).
  This is how `channels.list()` reports provenance and how the next card's
  author finds your contract.

Your own card imports the definition from the sibling file
(`import { Pomodoro } from "./channels.js"`); other packages import it by
your automerge url and declare the dependency in their `package.json` (see
context-channels).

## Design the value for merging

Readers see a one-level merge of every writer's slice: top-level keys union;
on a key collision arrays concatenate, everything else is last-writer-wins.
So:

- **Key by something you own** — your card's doc url, your query strings —
  so writers never collide (`{ [myDocUrl]: state }`).
- **Set channels** (`{ [key]: true }`) for presence: membership is the value,
  releasing a scope subtracts exactly its keys.
- **Request/response pairs**: requests as a set channel (`{ [query]: true }`),
  answers keyed by the same strings (`{ [query]: Answer[] }`). Consumers
  correlate by key.
- Values must be plain JSON — unless the channel deliberately carries live
  objects (extension sockets); then publish stable references and say so in
  the spec (inspectors must skip such channels).

## Document it

Add a section to your `spec.md`: the channel name, the value shape, who
writes and who reads, and the merge expectations. That file is what
`channels.spec(name)` serves to the next card author — it IS the contract.

## Export helpers alongside

If speaking the channel correctly takes shared logic (an engine, a
canonicalizer, a renderer), export it from your package as sibling modules
and document them — like `@embark/stickers-card` exports `engine.js` and
`@embark/schema-matcher` exports `schemaKey`. Consumers import your helpers
by your automerge url instead of duplicating the logic.
