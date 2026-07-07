# Sticker sources (annotating text)

For cards that read the user's notes and annotate spans of text in place:
converters ("5 miles (8 km)"), highlighters, inline calculators, widgets
replacing tokens. The card publishes *stickers* — annotations targeted at
character ranges — into the `stickers` channel; a renderer on the canvas
draws them inside every editor.

The card's real idea lives in one `scan(content, target)` function; the rest
is a fixed engine (discovery, watching, debouncing, publishing, cleanup) —
use the template below verbatim and only write `scan`.

## Sticker shapes

- `{ type: "text", text, target, slot: "after", styles? }` — a text chip
  after the span (`text` like `"(8 km)"`; optional `styles` inline-styles the
  chip, e.g. `{ color: "#dc2626" }`)
- `{ type: "style", styles, target }` — decorate the span itself
  (`{ color: "#1d4ed8", "font-weight": "600" }`)
- `{ type: "tool", toolId, docUrl, target, slot: "replace" }` — replace the
  span with a live widget: the registered tool `toolId` rendering `docUrl`
  (mint the backing doc via the resource cache below)

`target` is a range sub-url built with automerge cursors, so it stays glued
to the same characters as the text is edited.

## The engine template

Complete and self-contained — copy it as-is and only write `scan`. The
`findContextStore` / `ownerOf` boilerplate is the one from the system prompt;
do not substitute your own version (a wrong one fails silently).

```js
import { cursor, parseAutomergeUrl } from "@automerge/automerge-repo";

function findContextStore(el) {
  const request = new CustomEvent("patchwork:context-request", {
    bubbles: true, composed: true, detail: {},
  });
  el.dispatchEvent(request);
  return request.detail.store
    ?? document.body[Symbol.for("patchwork.context-store.v1")];
}

function ownerOf(element) {
  const view = element.closest("patchwork-view");
  return {
    docUrl: view?.getAttribute("doc-url") ?? undefined,
    embedId: element.closest("[data-embed-id]")?.getAttribute("data-embed-id") ?? undefined,
    toolId: view?.getAttribute("tool-id") ?? undefined,
  };
}

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

const Stickers = { name: "stickers", empty: {} };
const SchemaMatches = { name: "schema:matches", empty: {} };

// Documents carrying prose in any of these root-level string fields qualify.
const TEXT_FIELDS = ["content", "description", "text"];
const TEXT_KEY = schemaKey({
  anyOf: TEXT_FIELDS.map((field) => ({
    type: "object",
    properties: { [field]: { type: "string" } },
    required: [field],
  })),
});

const RESCAN_DEBOUNCE_MS = 250;

export default (handle, element) => {
  const repo = element.repo;
  const store = findContextStore(element);
  const owner = ownerOf(element);

  const stickersOut = store.handle(Stickers, owner);

  const docs = new Map(); // url -> { handle?, onChange?, timer?, resources: Map }

  const onMatches = () => {
    const urls = (store.read(SchemaMatches)[TEXT_KEY] ?? []).filter(isRootUrl);
    const wanted = new Set(urls);
    for (const url of urls) if (!docs.has(url)) watch(url);
    for (const url of [...docs.keys()]) if (!wanted.has(url)) drop(url);
  };

  const watch = (url) => {
    const entry = { resources: new Map() };
    docs.set(url, entry);
    repo.find(url).then((h) => {
      if (docs.get(url) !== entry) return; // dropped while resolving
      entry.handle = h;
      entry.onChange = () => schedule(url);
      h.on("change", entry.onChange);
      schedule(url);
    }).catch(() => {});
  };

  const drop = (url) => {
    const entry = docs.get(url);
    if (!entry) return;
    docs.delete(url);
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.handle && entry.onChange) entry.handle.off("change", entry.onChange);
    for (const docUrl of entry.resources.values()) deleteDoc(repo, docUrl);
    stickersOut.change((slice) => { delete slice[url]; });
  };

  const schedule = (url) => {
    const entry = docs.get(url);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      rescan(url);
    }, RESCAN_DEBOUNCE_MS);
  };

  const rescan = (url) => {
    const entry = docs.get(url);
    if (!entry?.handle) return;
    const doc = entry.handle.doc();
    const used = new Set();
    const stickers = [];

    for (const field of TEXT_FIELDS) {
      const content = doc?.[field];
      if (typeof content !== "string" || content.length === 0) continue;
      const target = (from, to) => entry.handle.sub(field, cursor(from, to)).url;
      const resource = (targetUrl, create) => {
        used.add(targetUrl);
        let existing = entry.resources.get(targetUrl);
        if (!existing) {
          existing = create();
          entry.resources.set(targetUrl, existing);
        }
        return existing;
      };
      stickers.push(...scan(content, target, resource));
    }

    // GC backing docs whose spans disappeared.
    for (const [targetUrl, docUrl] of [...entry.resources]) {
      if (used.has(targetUrl)) continue;
      entry.resources.delete(targetUrl);
      deleteDoc(repo, docUrl);
    }

    // Only docs that carry stickers get a key — empty arrays are clutter.
    stickersOut.change((slice) => {
      if (stickers.length === 0) delete slice[url];
      else slice[url] = stickers;
    });
  };

  // The declared key interest IS the query: the schema matcher answers every
  // key that schema:matches readers declare (see finding-documents).
  const unsubscribe = store.subscribe(SchemaMatches, onMatches, {
    owner,
    keys: [TEXT_KEY],
  });
  onMatches(); // no initial emit — seed once

  return () => {
    unsubscribe();
    for (const url of [...docs.keys()]) drop(url);
    stickersOut.release(); // dropping the slice removes every published sticker
  };
};

const isRootUrl = (url) =>
  url === `automerge:${parseAutomergeUrl(url).documentId}`;

const deleteDoc = (repo, url) => {
  repo.find(url).then((h) => h.delete()).catch(() => {});
};
```

## Writing `scan(content, target, resource)`

Return the stickers for one text field's content. `target(from, to)` builds
the range sub-url for `[from, to)`; `resource(targetUrl, create)` is the
get-or-create cache for widget backing docs (`create` runs only the first
time a span is seen — mint the doc there and return its url).

```js
function scan(content, target) {
  const stickers = [];
  for (const match of content.matchAll(/(\d+(?:\.\d+)?)\s*(?:miles|mi)\b/gi)) {
    const from = match.index ?? 0;
    stickers.push({
      type: "text",
      text: `(${(Number(match[1]) * 1.60934).toFixed(1)} km)`,
      target: target(from, from + match[0].length),
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
  after the data lands call `schedule(url)` for every watched doc (or factor
  a `rescanAll` that does) so stickers appear.
