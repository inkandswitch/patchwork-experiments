# Shared context: replacing canvas providers with pure read/write state

## Goal

Replace the four canvas providers — `SearchProvider`, `CommandsProvider`,
`SchemaMatchProvider`, `StickerProvider` — and their `subscribe` / `accept` +
`MessagePort` + doc-minting handshake with a single **shared context object**:
named channels of pure JSON state that any component can read (aggregated) or
write (scoped).

A writer mutates only its own slice. When its scope disappears, its
contribution is removed automatically. There is no "handle message" round-trip
where a broker mints an automerge doc and posts its url back — you just get a
handle to your own slice and write into it.

The original sketch:

```ts
{
  selection: Record<AutomergeUrl, true>
  highlight: Record<AutomergeUrl, true>
  stickers: Record<AutomergeUrl, Sticker[]>
}

const highlightedUrls = readContext(Highlight)
const isHighlighted = highlightedUrls[automergeUrl]

const handle = getContextHandle("highlight")
handle.change((highlightedUrls) => {
  delete highlightedUrls[myUrl]
})
```

> Reading gives you the merged state across every scope. Getting a handle lets
> you mutate this scope's contribution. All mutations are attributed to the
> scope where the handle lives; if the scope disappears, the state it added is
> removed.

## Why not just Solid

The context must be reachable from *other render trees*: sibling
`<patchwork-view>` embeds (POI provider, sticker sources, search boxes) and the
dynamically-loaded plain-JS code inside LLM cards. A Solid `createContext` only
reaches one `render()` tree, so it can't be the substrate.

Therefore the **core is vanilla JS + DOM** with its own callback-based
reactivity, and Solid is a thin wrapper on top (mirroring how
`lib/providers-solid.ts` wraps the framework-agnostic provider protocol today).

## Core concepts

- **Context host** — a dedicated `<patchwork-context>` custom element owns one
  store instance. Descendants — including those inside sibling `<patchwork-view>`
  embeds and dynamically-loaded code — find it by **discovery events**, not by
  walking the DOM: a consumer dispatches a bubbling, `composed: true`
  `patchwork:context-request` from its own node, and the nearest enclosing
  `<patchwork-context>` answers synchronously with its store (and stops
  propagation so an outer host doesn't double-answer). This mirrors how the
  current provider protocol bubbles `patchwork:subscribe`, works across shadow
  boundaries, and keeps the host swappable.
- **Layered stores (body fallback + inheritance)** — stores form a tree. The
  root is an implicit **page-global store on `document.body`** (stashed under a
  `Symbol.for` key, so it's shared even when this library is bundled several
  times — see Cross-bundle safety). When discovery finds no `<patchwork-context>`,
  it falls back to that body store, so there is *always* a store to read from and
  write to. Each `<patchwork-context>` **inherits reads** from the nearest store
  above it (its parent, resolved on connect): a read merges the whole parent
  chain, **nearest wins**. **Writes never leave the store they were made in** — a
  scope handle always belongs to the store it was acquired from, so writes stop
  at the closest host. An `isolated` attribute makes a `<patchwork-context>` a
  root (no parent): it neither reads from nor writes to any enclosing store. Used
  by the parts bin so its example cards stay inert.
- **Channel** — a typed, named slot whose value is always a record (so it's
  always mergeable). Defined once and imported by both readers and writers,
  replacing today's `*_SELECTOR` string constants and per-broker doc types.
- **Scope slice** — each writer gets a private slice via a handle. `change()`
  mutates only that slice; the aggregate a reader sees is the merge of all live
  slices (see Merge semantics).
- **GC by scope** — releasing a handle (Solid `onCleanup`, CodeMirror
  `destroy`, card teardown) drops its slice and re-merges. This replaces every
  manual cleanup today: deleting minted docs, pruning query keys, refcounting
  mounts.

## Vanilla core API (framework-agnostic)

```ts
type Channel<T extends JSONObject> = {
  name: string;
  empty: T; // resting value when no scope contributes
};

function defineChannel<T extends JSONObject>(def: Channel<T>): Channel<T>;

type ScopeHandle<T> = {
  change(mutate: (slice: T) => void): void; // mutate this scope's slice, re-merge, notify
  read(): T; // this scope's own slice (rarely needed)
  release(): void; // drop this scope's slice, re-merge, notify
};

type ContextStore = {
  read<T extends JSONObject>(channel: Channel<T>): T; // merged over the parent chain, nearest wins
  subscribe<T extends JSONObject>(
    channel: Channel<T>,
    cb: (value: T) => void,
  ): () => void;
  handle<T extends JSONObject>(channel: Channel<T>): ScopeHandle<T>; // writes stay in this store
  readonly parent: ContextStore | undefined; // enclosing store reads inherit from
  setParent(parent: ContextStore | undefined): void; // rewired by the host on connect/disconnect
};
```

### Host element + discovery

```ts
// The <patchwork-context> custom element owns one store and answers discovery
// requests aimed at it from anywhere in its subtree.
class PatchworkContextElement extends HTMLElement {
  readonly store: ContextStore;
}
function registerContextElement(): void; // customElements.define("patchwork-context", …)

// The discovery event: dispatched from a consumer's node, answered by the
// nearest <patchwork-context> ancestor writing its store into `detail`.
type ContextRequestEvent = CustomEvent<{ store?: ContextStore }>;
// type === "patchwork:context-request", { bubbles: true, composed: true }

// The page-global root store, lazily created and stashed on document.body under
// a Symbol.for key (see Cross-bundle safety). Discovery falls back to it.
function getBodyContextStore(): ContextStore;

// One-shot synchronous lookup: dispatch the request from `node`, and return
// whatever a host wrote into the event detail — or the body store when none is
// found. Always resolves a store, so a tool opened outside a canvas still has
// somewhere to read from and write to.
function findContextStore(node: Node): ContextStore;

// Node-relative conveniences that resolve the store via findContextStore.
function subscribeContext<T>(
  node: Node,
  channel: Channel<T>,
  cb: (value: T) => void,
): () => void;
function getContextHandle<T>(
  node: Node,
  channel: Channel<T>,
): ScopeHandle<T>;
```

The host's listener answers and stops propagation:

```ts
// inside PatchworkContextElement (on connect)
this.addEventListener("patchwork:context-request", (event) => {
  event.stopPropagation(); // nearest host wins; outer hosts never see it
  (event as ContextRequestEvent).detail.store = this.store;
});
```

Every caller has a connected starting node: tools get `element`, CodeMirror
gets `view.dom`, cards get their host element. Because the request bubbles and
is `composed`, it reaches the host across sibling-embed and shadow boundaries.
Discovery is one-shot — once a consumer has the store it calls `subscribe` /
`handle` directly. A normal canvas's `<patchwork-context>` wraps its content, so
it always exists before its descendants mount and resolution is synchronous; a
consumer with no enclosing host resolves to the body store instead.

On connect, a `<patchwork-context>` resolves its own parent by dispatching the
same discovery request from its *parent* node (so it doesn't answer itself),
landing on the nearest enclosing host or the body store, and `setParent`s it —
unless it is `isolated`, in which case it stays a parentless root. On disconnect
it clears the parent, so a re-parented context re-resolves on reconnect.

### Cross-bundle safety

The coordination point can't be a module singleton: a "library" here may be
bundled into several independently-built modules, so `createContextStore()` and
its channel objects are *not* shared by identity across bundles. Two things make
the tree work regardless:

- The body store lives on `document.body` (a per-document singleton) under
  `Symbol.for("patchwork.context-store.v1")` (the global symbol registry is
  shared across all bundles in the realm). So N copies of this code resolve to
  one root store. The version lives in the key.
- Channels correlate **by value, not identity** — the store keys channel state
  by `channel.name`, and merges are structural. A channel defined in bundle A
  and an identically-named one in bundle B address the same slot.

### Global context canvas

A second datatype/tool pair, **`context-canvas`**, reuses the exact canvas UI
but is mounted *without* a `<patchwork-context>` (`ContextCanvasTool` renders
straight into its host and runs the schema resolver against `getBodyContextStore()`).
Its cards' discovery therefore finds no local host and resolves to the body
store, so mentions, command providers, sticker sources, etc. placed on it apply
**page-wide** — to every editor and canvas on the page (each normal canvas
inherits reads from the body store). It is registered `FRAMELESS` and is meant
to live on a sidebar surface, outside any other context.

## Solid wrappers (thin, on top)

```ts
// lib/context-solid.ts — mirrors lib/providers-solid.ts
function readContext<T>(node: ElementSource, channel: Channel<T>): Accessor<T>;
function useContextHandle<T>(
  node: ElementSource,
  channel: Channel<T>,
): ScopeHandle<T>;
```

`readContext` subscribes on mount and pushes emissions into a signal, seeded
with the channel's current merged value. `useContextHandle` returns a handle
and calls `release()` in `onCleanup`.

## Merge semantics

A channel value is always a record, so merging slices is a **one-level record
merge** — deliberately *not* a recursive deep-merge. To combine every scope's
slice the store unions their top-level keys, and for a key set by more than one
scope:

- both values are arrays → **concatenate** them
- otherwise (a nested object, or a scalar) → **one wins** (last writer); nested
  objects are taken whole, never merged field-by-field

That's the whole rule. In practice scopes contribute disjoint keys (different
documents, different queries), so collisions are rare; when they do collide,
arrays accumulate (multiple sticker sources on the same doc, multiple
contributors answering the same query) and everything else is replaced wholesale.

A `read` merges slices across the whole **parent chain**, applying them
outermost-first so the **nearest store wins**: for a scalar/object key set at
multiple levels the innermost value replaces the outer one, and arrays
concatenate parent-before-local. `empty` is returned only when no scope anywhere
in the chain contributes. A `subscribe` re-emits when either a local write or a
parent-side change alters this merged value (the store holds a subscription to
its parent's same channel while it has local subscribers).

Array **dedupe is out of scope for now** — if two contributors surface the same
url it appears twice. We can revisit per-channel dedupe later if it bites.

Two guarantees the store bakes in (today each broker hand-rolls them):

- **Emit only on change.** Subscribers are notified only when a channel's
  merged value structurally changes, preserving the "don't churn identical
  arrays" behavior the current `sameUrls` guards provide.
- **Coalesced notifications.** Writes are batched on a microtask, so a
  multi-key write (e.g. the resolver writing several schemas) emits once.

Values must be JSON-serializable. Nothing depends on that yet, but it keeps the
door open to backing the store with an automerge doc / network sync later
(today's brokers already round-trip everything through automerge docs).

## Channel registry

```ts
const Selection = defineChannel<Record<AutomergeUrl, true>>({
  name: "selection",
  empty: {},
});
const Highlight = defineChannel<Record<AutomergeUrl, true>>({
  name: "highlight",
  empty: {},
});
const Stickers = defineChannel<Record<AutomergeUrl, Sticker[]>>({
  name: "stickers",
  empty: {},
});

const SearchQueries = defineChannel<Record<string, true>>({
  name: "search:queries",
  empty: {},
});
const SearchResults = defineChannel<Record<string, AutomergeUrl[]>>({
  name: "search:results",
  empty: {},
});

const CommandQueries = defineChannel<Record<string, true>>({
  name: "commands:queries",
  empty: {},
});
const CommandSuggestions = defineChannel<Record<string, Suggestion[]>>({
  name: "commands:suggestions",
  empty: {},
});

// A query carries a short human name alongside the schema (so views like the
// context viewer can label each "where does this occur?" section). Keyed by
// `schemaKey`, derived from the schema alone.
type SchemaQuery = { name: string; schema: JsonSchema };
const SchemaQueries = defineChannel<Record<string, SchemaQuery>>({
  name: "schema:queries",
  empty: {},
});
const SchemaMatches = defineChannel<Record<string, AutomergeUrl[]>>({
  name: "schema:matches",
  empty: {},
});
```

## Mapping every embark provider

### Stickers → `Stickers: Record<targetDocUrl, Sticker[]>`

Sources write their slice; the renderer reads `stickers[docUrl]`. Sticker
values live inline (plain JSON), so the broker's minted registry doc
disappears and the renderer no longer `repo.find`s each sticker — it still
resolves the `target` range sub-url for live positions.

```ts
// source (was: subscribe STICKERS_REGISTRY, write into the minted doc)
const stickers = getContextHandle(element, Stickers);
stickers.change((s) => {
  s[docUrl] = scan(ctx);
}); // on rescan; release() on teardown

// renderer (was: subscribe STICKERS_ON_DOCUMENT, resolve each sub-url)
subscribeContext(view.dom, Stickers, (all) => this.resolve(all[docUrl] ?? []));
```

### Search → `SearchQueries` + `SearchResults`

The "broker hands the contributor a seeded doc" pattern becomes an ordinary
effect over two channels.

```ts
// box: publish query, read results
const queries = useContextHandle(element, SearchQueries);
createEffect(() => {
  const q = query().trim();
  queries.change((s) => {
    for (const k of Object.keys(s)) delete s[k];
    if (q) s[q] = true;
  });
});
const results = readContext(element, SearchResults);
const myResults = () => results()[query().trim()] ?? [];

// POI contributor: read queries, fetch, write results
const queries = readContext(element, SearchQueries);
const results = useContextHandle(element, SearchResults);
createEffect(() => {
  for (const q of Object.keys(queries())) {
    /* debounce + fetch */
    results.change((s) => {
      s[q] = urls;
    });
  }
});
```

Solid's fine-grained reactivity means writing `SearchResults` never retriggers
the query effect, so the `createMemo`-with-custom-`equals` workaround in
`PoiProvider` goes away.

### Commands → `CommandQueries` + `CommandSuggestions`

Identical to search; it's the same channel kind with a different payload
(`Suggestion[]` instead of result urls). The CodeMirror commands extension
writes its query and reads suggestions via `subscribeContext` /
`getContextHandle` on `view.dom`.

### Schema match → requests + responses in context, resolution is plain canvas code

Schema matching is **not its own concept**. The request (schema) and response
(match urls) ride the context; resolution is a simple reducer the canvas runs.

```ts
// consumer (sticker source-lib, map tool): publish schema, read matches
const key = schemaKey(MARKDOWN_SCHEMA); // stable stringified hash
useContextHandle(element, SchemaQueries).change((s) => {
  s[key] = { name: "Markdown documents", schema: MARKDOWN_SCHEMA };
});
const matches = readContext(element, SchemaMatches);
const onMatches = () => apply(matches()[key] ?? []);

// canvas: one ordinary reducer — nothing special
function runSchemaResolver(store, element, repo) {
  // discovery of mounted docs stays on the existing patchwork:mounted /
  // patchwork:unmounted events (a canvas/DOM concern, including synthetic POI
  // mounts); the context carries only requests + responses. On any change to
  // SchemaQueries or the reachable doc set: recompute the closure over mounted
  // docs (plus opaque-container hiding), match each SchemaQueries entry, and
  // write store.handle(SchemaMatches).change(...).
}
```

Two consumers with the same schema share a key and a single result array —
exactly what they want.

## What deliberately stays outside the context

- **Live document content.** The resolver and sticker sources `repo.find` and
  listen to handles directly; the context carries only the request (schema /
  query) and response (urls / stickers), never document bodies.
- **Mounted-doc discovery.** Stays on the `patchwork:mounted` /
  `patchwork:unmounted` events fired by `<patchwork-view>` (and the synthetic
  ones the POI provider dispatches). The canvas already owns this, and it covers
  nested views for free.

## Net effect on the canvas

The canvas tool no longer hosts four bespoke brokers. Instead it:

1. wraps its content in a `<patchwork-context>` element (which owns the store
   and answers discovery), and
2. runs one plain `runSchemaResolver` that reads `SchemaQueries` + mounted docs
   and writes `SchemaMatches`.

Everything else (search boxes, POI, sticker sources/renderers, command menus,
the map) becomes an ordinary reader/writer of context channels. The MessagePort
handshake, the per-contributor minted docs, the query-key seeding, and the
mount refcounting all collapse into scoped slices + automatic GC.

## Decisions

- **Merge:** a one-level record merge — union top-level keys; on a collision,
  concatenate arrays and otherwise take one value whole (no recursion into
  nested objects). Array dedupe is deferred.
- **Discovery:** a `<patchwork-context>` custom element owns the store and
  answers a bubbling, `composed` `patchwork:context-request` event — no DOM
  walking.
- **Request/response (search, commands):** two plain record channels; the
  contributor is a component with an effect. No doc-minting.
- **Vanilla first:** the core is vanilla JS + DOM (it must cross render trees
  and serve dynamically-loaded code); Solid bindings wrap it.
- **Schema resolution:** requests/responses in context; resolution is a plain
  piece of canvas code, not a distinct provider concept.
- **Selection:** promoted from a local canvas signal to a `Selection` channel
  (single-writer, trivial merge) so embeds/decorators can read it without
  prop-drilling.
- **`schemaKey`:** a stable stringification hash of the JSON schema as the
  correlation key.

## Non-goals (deferred)

- **Provenance.** Readers see only the merged aggregate; the store does not
  expose which scope contributed which value. Nothing in embark needs it today.
- **Stable array order.** Concatenation order across scopes is unspecified —
  consumers must not depend on it. (Within a single scope's slice, order is of
  course preserved.)
- **Nested canvases.** A canvas embedded in a canvas still isn't a designed-for
  layout, but it no longer breaks: discovery resolves each embed to the nearest
  host (via `stopPropagation`) and stores inherit reads up the chain. The one
  intended nesting is the `context-canvas` on a sidebar (outside any other host,
  so it resolves to the body store); embedding it *inside* a regular canvas would
  instead scope it to that canvas.
- **Array dedupe.** See Merge semantics; revisit per-channel if it bites.
