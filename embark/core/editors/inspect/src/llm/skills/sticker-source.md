# Sticker sources (annotating text)

For cards that read the user's notes and annotate spans of text in place:
converters ("5 miles (8 km)"), highlighters, inline calculators, widgets
replacing tokens. The card publishes *stickers* — annotations targeted at
character ranges — into the `stickers` channel; the Stickers card's renderer
draws them inside every editor.

The whole machinery (discovering text documents, watching them, debouncing,
publishing, cleanup) is the shared engine owned by `@embark/stickers-card` —
import `runStickerSource` and only write your `scan` function:

```js
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const STICKERS_CARD_PACKAGE_URL = "automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy";
const { runStickerSource } = await import(
  getImportableUrlFromAutomergeUrl(STICKERS_CARD_PACKAGE_URL, "engine.js")
);

export default function card(_handle, element) {
  const source = runStickerSource(element, { scan });
  return source.stop;
}
```

Declare the dependency in `package.json`:

```json
"dependencies": {
  "@embark/stickers-card": "automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy"
}
```

The engine scans every text-bearing document in scope (root-level string
fields `content` / `description` / `text`), reruns `scan` 250ms after edits
settle, publishes the results into the card's own slice of the `stickers`
channel, and drops everything when you call `stop`.

## Sticker shapes

- `{ type: "text", text, target, slot: "after", styles? }` — a text chip
  after the span (`text` like `"(8 km)"`; optional `styles` inline-styles the
  chip, e.g. `{ color: "#dc2626" }`)
- `{ type: "style", styles, target }` — decorate the span itself
  (`{ color: "#1d4ed8", "font-weight": "600" }`)
- `{ type: "tool", toolId, docUrl, target, slot: "replace" }` — replace the
  span with a live widget: the registered tool `toolId` rendering `docUrl`
  (mint the backing doc via `ctx.resource`, below)

`target` is a range sub-url built with automerge cursors, so it stays glued
to the same characters as the text is edited.

## Writing `scan(ctx)`

`scan` is called once per text field per document, synchronously, and returns
that field's stickers. `ctx` carries:

- `ctx.content` — the field's text.
- `ctx.target(from, to)` — the range sub-url for `[from, to)`; use it as a
  sticker's `target`.
- `ctx.resource(targetUrl, create)` — get-or-create cache for widget backing
  docs: `create` runs only the first time a span is seen (mint the doc there
  and return its url); docs are deleted automatically when their span stops
  appearing.
- `ctx.repo` — the repo, for sources that mint docs inside `resource`.

```js
function scan(ctx) {
  const stickers = [];
  for (const match of ctx.content.matchAll(/(\d+(?:\.\d+)?)\s*(?:miles|mi)\b/gi)) {
    const from = match.index ?? 0;
    stickers.push({
      type: "text",
      text: `(${(Number(match[1]) * 1.60934).toFixed(1)} km)`,
      target: ctx.target(from, from + match[0].length),
      slot: "after",
    });
  }
  return stickers;
}
```

Tips:

- **Dedupe overlaps** when running several regexes: sort matches by `from`,
  then keep a cursor and skip any match starting before it.
- **Word-boundary your units** (`\bmi\b`) so they don't fire inside words;
  beware ambiguous short units (`m`, `in`).
- **Async inputs** (exchange rates, lookups): `scan` must stay synchronous.
  Fetch into a module-level cache on setup, return `[]` until it's ready, and
  once the data lands call `source.rescanAll()` so stickers appear.
- The optional third argument `runStickerSource(element, config, onCount)`
  reports the live sticker count — handy for a status line in the middle
  slot.
