# Sketchy — architecture (codename: Littlebook 4)

The design rationale: why Sketchy (the tldraw-free spatial canvas) is being
reshaped into a Littlebook-style modular editor, delivered as a Patchwork
**component**. Captures decisions and open questions from the design
conversation. Source of truth for lb's real code: `./lb` (mirror of `chee/lb`),
canonical core in `lb/littlebook/system/core/`. (This file was `LITTLEBOOK4.md`;
the codename names the *project*, not a runtime identifier — see the Names table
in CLAUDE.md.)

Operating manual (commands, names, policies): [CLAUDE.md](./CLAUDE.md) · wiring
reference: [NODES.md](./NODES.md) · layouts/lenses/complement:
[LAYOUTS.md](./LAYOUTS.md) · open work: [TODO.md](./TODO.md).

> Status legend: **[decided]** settled · **[open]** needs a call · **[port]** lift
> lb code (adapt TS→vanilla JS, house style).

---

## 1. Substrate: `patchwork:component`, not `patchwork:tool`

**[decided]** A legacy `patchwork:tool` is `(handle, element) => cleanup` — the host
resolves one handle through an overlay shim and hands it over. It "just takes a
DocHandle as its schema; it knows nothing."

A **`patchwork:component`** (defined in `pw/main/core/elements/src/patchwork-view.ts`)
is lower-level: `ComponentRender = (element, repo) => cleanup`. The component gets the
`<patchwork-view>` element (carrying `.url`/`.docUrl`) **plus the realm-local base
Repo** (not the overlay shim), so it owns its own doc access — it can open many
handles, build derived streams, manage its own lifecycle.

- `patchwork:tool "sketchy"` stays the thin entry: host gives it the doc-url → it
  builds **opstreams** from that url → mounts the `patchwork:component "sketchy"`.
  The tool is the adapter; the component is the framework.
- When the `component` attr is set, `doc-url`/`tool-id` are ignored. Registry id is
  `"patchwork:component"`.

> Built (2026-07): tool.jsx provides the folder/layout/user docs as opstreams over a
> MessagePort (sketchy-streams.js on port-opstream.js — ops cross the port natively,
> stale client ops are rebased via `transformOp`/`RESYNC` in ops.js); component.js
> subscribes and runs the headless Canvas on `docHandleFromOpstream` adapters, with
> a repo fallback when no provider answers.

---

## 2. Opstreams (lb's model + complement passthrough)

**[port]** Lift lb's opstream model directly (`lb/littlebook/system/core/ops.ts`,
`opstreams.ts`). Do **not** reinvent — an earlier from-scratch automerge-lens
`opstream.js` was the wrong abstraction and has been removed.

### Op vocabulary — **[decided]** exactly ONE op + snapshot
lb's `ops.ts` had `TextOp`/`JSONOp`/`BytesOp` as separate types; they collapse into
one. (`BytesOp {pos,value}` also couldn't resize — a real bug a range fixes.)

- `snapshot` = `{type:"snapshot", value}` — the whole value (replaces the root;
  the one thing a path/range can't express, so it stays distinct).
- `op` = `{path, range, value}` — the one universal mutation. `range` is overloaded:
  - `range = [from, to]` → **splice** the collection at `path` (string / bytes /
    list — grows & shrinks)
  - `range = key` (string|number) → **assign** at `path` (omit `value` ⇒ delete)
- `path` is relative to the **opstream's own value** (a text stream's value *is* the
  string → `path:[]`); a bridge binding the stream to a field prepends that field's
  path on the way down. This is cabbages' shape (`cabbages@0.2.8` / lb's
  `uncabbage.ts`), so `applyOp` can be swapped for cabbages later.

### Opstream interface
```
IOpstream<Type, OpType> = {
  value
  connect(cb) -> unsubscribe      // cb is called with a snapshot first, then ops
  apply(op)                       // mutate; emits the op, bumps version
}
```
- Concrete: `TextOpstream` (backed by a Rope), `JSONOpstream` (cabbages),
  `BytesOpstream`. `Source` = a read-only opstream (output only — emits snapshots,
  no `apply`).
- lb's own note (worth keeping): *"a source here is an edge. the file itself is a
  vertex. a view's inputs and outputs are vertices, and the connections between
  them are edges. and those connections are opstreams."* → this is the dataflow
  model in §3.

### Complement passthrough — **[decided]** the new addition
Every opstream carries a **complement**: a sidecar of capabilities/metadata that
flows **down the chain even if a transform ignores it**.

> "the complement needs to continue passing through the chain, even if unused.
> because a file, for instance, carries that it is saveable. that might not be
> interesting to something lowercasing the text, but would be interesting to the
> codemirror tool rendering it."

- A File opstream's complement carries its `mimeType`/`name`/`extension` and the
  underlying **automerge handle/path**.
- A lens that lowercases text omits `complement` → the parent's passes straight
  through. A transform that cares may *extend* it (never silently drop inherited
  keys).
- This is what lets a downstream editor decide how to bind and what to offer.

**Capabilities are FUNCTIONS — [decided]**
> "couldn't `saveable` instead be a `save(){}` function? is there any reason a
> complement couldn't be a function?"

A capability lives in the complement as a function whose **presence is the
affordance** — `complement.save?.()`, not a `saveable: true` boolean. The boolean
only says a capability exists; the function *is* the capability (object-capability
style), and `saveable` collapses to `!!complement.save`. This also sharpens
correctness: an automerge stream auto-persists → **no `save`** (no save button); an
lb-style file backend supplies `save()` → editor shows it. The complement itself
stays a **record** (so `{...parent, ...extra}` merge/passthrough works); its
*values* may be functions freely. Editors **feature-detect** capabilities.

### Automerge is attached to the opstream, NOT to codemirror — **[decided]**
> "an automerge doc is attached to the opstream, not to codemirror. codemirror
> doesn't know thing 1 about automerge."

The bridge is **generic** — `automergeOpstream(handle, {path?})` takes *any* DocHandle
(or scopes to a subtree via `path`) and works for any shape: `apply` translates the
universal op into automerge mutations (string/list splice, object assign/delete);
remote change *patches* translate back into ops (cursor-stable), snapshot fallback
when a patch isn't op-expressible. `fileTextOpstream(handle)` is a thin convenience
that scopes to `["content"]` and adds `saveable`+file metadata to the complement.
The consumer (codemirror) only speaks ops; we do **not** need
`@automerge/automerge-codemirror`.

### COW — **[decided]**
`apply(value, op)` is copy-on-write: the touched path is copied, untouched subtrees
are shared by reference, the input is never mutated. So every op yields a cheap
snapshot of the prior value → cheap history/undo, forkable lens state, before/after
diffing. (Pinned by a test.)

### Edit lenses have two modes — **[decided]** `transform` supports both
> "do we want to actually transform the op... or insert another op that is the
> transformation of the op? i think opstreams can support both."

- **(a) map the op** — `spec.map(op, source) -> op' | op'[] | null`. Rewrite the
  incoming op into the equivalent op(s) on the derived domain and forward it.
  Preserves granularity (a splice stays a splice → cursor-stable through the lens).
  For ~bijective lenses.
- **(b) recompute** — omit `map`; any source op re-snapshots the projected value
  downstream (a fresh op describing the new state). For computed / non-1:1 views.

Write direction mirrors this in `spec.apply` (map the view-op back to source op(s),
or append new ones).

### Solid binding is an OUTER wrapper — **[decided]**
> "opsignals were a mistake, it should have been an outer thing that lets you take
> an opstream and wraps it into a signal/memo."

So: **do not** port `opsignals.ts` as a parallel class hierarchy. Provide one outer
adapter, `opstreamToSignal(opstream)` (returns a Solid accessor/memo + disposer),
that wraps any opstream.

### Schemas: Standard Schema — **[decided]**
Opstreams declare their shape via [Standard Schema](https://standardschema.dev)
(`~standard`). Unlike a bare DocHandle, a stream knows what it edits. No dependency
required — any zod/valibot/arktype schema works; ship tiny built-ins too.

---

## 3. Dataflow: inlets & outlets (the patcher model)

**[naming: `sketchy:editor` for now]** A node with **typed inlets and outlets**;
ports carry **opstreams**, typed by schema. (Final name deferred — `:editor`/`:app`
both feel heavy; "tool" was closer but taken; "instrument" floated. Not worth
deciding yet; `:editor` does the job.)

- A `patchwork:tool` gets exactly **1 inlet, 0 outlets** (legacy). Maybe
  **edgehandles** gives a way to add outlets to a patchwork tool.
- **codemirror** as a node: `content` inlet (opstream of text), `language` inlet
  (opstream of a Language), possibly more; **text outlet** (a text opstream).
- **Ports can be individual divs.** A div may carry `data-automerge-url=""` (a subdoc
  handle path). A special **wiring brush** drags from such a div to anything whose
  schema accepts an automerge handle — connecting them.
- **[want → built]** A way to **visualize opstreams** — the rough.js wires, the
  value pulse, red error wires, the port schema popover.

This sits naturally on Sketchy's canvas: boxes with ports, edges between them.

---

## 3a. Headless component + signals vs opstreams — **[decided, built]**

The `patchwork:component` "sketchy" defaults to **no UI at all**. The concept it *is*
= a **layout** (the canvas layout): it binds a doc (opstream), renders surfaces/items
on the pan/zoom plane, and **exposes a context**. The toolbar / params panel / minimap
are NOT part of it — they're plugins that consume the context. (Make it do less: the
component renders + applies ops + exposes state; it doesn't own chrome.)

Split state by what it *is*:
- **opstreams = documents (nouns)** — canvas items, edited text. Persisted,
  collaborative, op-based, COW.
- **signals = interaction state (verbs)** — `camera`, `pointer`, active `tool`,
  `brush`, `selection`. Ephemeral, reactive, local. **Mouse position is a SIGNAL,
  not an opstream** (op-history of every mouse move would be wrong + would try to
  sync).

Shape: `sketchy(docOpstream, configSignals) → { mount, context }`, where `context`
is a bag of signals — `camera()`, `pointer()` (world-space, **already transposed to
this layout's coordinate space**), `pointerScreen()`, `tool()`, `brush`,
`selection()`. A brush / UI plugin reads `ctx.pointer()` and Just Works; nesting
sketchy in a box is the SAME component with `pointer()` transposed into the box's
space ("works like the main frame, mouse transposed to its own coordinate space").

Nuance: config you want shared doesn't become a *document* opstream either — a
persisted camera is local; live cursors are ephemeral **broadcast/presence**, not
ops.

### How the context is obtained: provide/accept + fallback-to-own — **[decided]**
The canvas gets `camera`/`pointer`/`tool`/`brush`/`selection` via the
**provide/accept** context protocol (`@inkandswitch/patchwork-providers`:
`subscribe(el, selector, listener)` ↔ `accept(event, respond)`; bundle it like llm
does, `^0.2.1`).

- **Transport = JSON over a MessagePort.** You CANNOT send an opstream object across
  provide/accept (methods/closures don't structured-clone). So the wire carries
  plain values — `camera {x,y,z}`, `pointer {x,y}`, `tool "pen"`, `brush {…}`,
  `selection [ids]`. The **opstream/Source is the LOCAL shape**: wrap a subscription
  as a `Source` (snapshot stream); a provider wraps its source's emissions into
  `respond(value)`. (This also kills the "pointer-as-opstream wastes history" worry
  — a `Source` is snapshot-only, no append log.)
- **Fallback-to-own + provide, per selector.** The canvas `subscribe`s each
  selector; if a provider answers → use it (shared); if nobody answers (after a
  tick) → **own** it (create the Source) AND `accept` it so descendants/nested
  canvases can subscribe. Granular: a box can inherit `tool`/`brush` from the parent
  (switch tool → affects all) while owning its own `pointer`/`camera` (transposed).
- An **inspect mode/brush** renders these context ports as **inlets at the top of
  the screen** — visualizing the wiring (the opstream-visualization idea applied to
  the canvas's own context).

### Nested camera/pointer = a DERIVATION of the container's — **[decided]**
An embedded Sketchy's `camera`/`pointer` are NOT independently owned — they
**derive** from the container's. Effective world→screen for embedded content
composes: `containerCamera ∘ boxPlacement ∘ localCamera` (localCamera often
identity). So panning/zooming the parent transforms the box and everything in it.
Concretely: a nested canvas **accepts** the container's camera/pointer `Source` and
runs it through an opstream **`transform`** keyed on the box's placement (the same
mechanism as `pointer` transposition). So per-selector nesting policy:
- `camera`, `pointer` → **accept-and-derive** (transform of the container's)
- `tool`, `brush`, `selection` → **accept-or-own** (share from parent, else own)

## 3b. Brush API, reconsidered — **[decided, built]**

The current brush module (`{ stroke?, behavior?:{down,move,up}, params? }`, driven by
`Canvas` via a 12-field `brushCtx`) predates opstreams/context and fights them. New
shape: **a brush is a context-consumer that emits ops.**

```js
sketchy:brush → load() → Brush
Brush = {
  schema?,          // Standard Schema of the brush config → GENERATES the params panel
  config?,          // default config (becomes the `brush` context value when active)
  use(canvas) -> cleanup     // called when the brush becomes the active tool
}
canvas = { context, layout, surface }   // context = Sources; layout = the doc opstream
```
- `use(canvas)` reads `context.pointer`/`.brush` (signals) and **applies ops to
  `layout`** (the opstream) → undo/collab/lenses/visualization for free. pointer is
  auto-**transposed** in a nested canvas.
- `{down,move,up}` brushes keep their feel via a thin `gesture(canvas,{down,move,up})`
  helper derived from the `pointer` Source + a `pressed` signal. Core stays "read
  context, emit ops."
- **pen/highlighter/shapes/eraser become brushes too** (drawing logic moves into the
  modules). `Canvas` stops special-casing stroke-vs-behavior.
- **active brush = the `tool` context value**; `Canvas` swaps `use()` on tool change.
  `Canvas`'s gesture dispatch collapses to "the active brush owns the gesture."
- Make it do less: API shrinks to `{schema?,config?,use}`; one generated params panel;
  the palette just lists `sketchy:brush`s and sets `context.tool`.
- Depends on the signal↔opstream bridges (`storeOpstream` = how `layout` ops-out).
  Land those first, then do this as its own pass.

> Built (2026-06, see TODO.md "Brush API"): every tool is a `use(canvas)` brush
> through one host (brush-host.js); `paramsSchema` generates the params panel for
> brushes AND nodes. Remaining tail there: chrome still prop-drills instead of
> reading the context; context-ports-as-inlets.

## 4. Primitives (revised)

**[decided]** Drop **"view"** — my earlier "view maps handles → Editors" reading was
off, and we probably don't need it. The set we keep:

- **layouts** — a container for **surfaces**. Sketchy's canvas is one layout; others:
  a dockview (tiling/tabs), **telepath television**, a fixed grid. **A layout has
  named layers.** (lb `layouts.ts`: `Layout = { element, place, remove, restore,
  save, focus, name? }`.)
  - **telepath television** ([television.run](https://television.run)) — a *spatial
    artifact organization system*: **artifacts** (cards / interactive views / web
    pages) arranged on **screens** (persistent spatial workspaces you switch
    between, channel-style), plus **skills** (reusable artifact templates). As a
    `layout` it's a **channel-switched set of named persistent screens**, each a
    spatial arrangement of surfaces — so the `layout` interface must allow multiple
    named boards + an active one + switching, not just a single canvas. This is the
    generality test for the interface: canvas (one infinite plane), dockview
    (tiling), television (channel-switched screens), grid (fixed cells) must all
    satisfy the same `layout` contract.
- **surfaces** — emacs-buffer-like: holds the handle/opstream, its modes, its editor,
  and the layout it lives in. (lb `surfaces.ts` is mostly graveyarded; rebuild.)
- **keybindings**, **settings**, **events**, **commands** — the connective tissue.
  (Existing Sketchy undo/group/reorder become commands; hardcoded `onKeyDown`
  becomes keybindings.)

**[resolved]** "telepath television" = channel-switched named persistent screens of
spatially-arranged artifacts (see above). The `layout` interface must support
multiple named boards + active board + switching to host it.

---

## 5. Reflection / provenance

**[port]** lb captures a **stacktrace at registration** to record *when/where*
something was added or registered (`lb/graveyard/reflection/stack.js` `parseStack`
for V8 + Gecko/WebKit; `reflection.js` uses acorn to also pull a leading
template-literal **docstring** out of the registered function). Use this so every
registered command/setting/editor knows its origin.

---

## 6. Devtools parity — a public `.api`

**[decided]** Everything doable in the system is doable from devtools. Expose a public
API on Sketchy's `patchwork:component` element, e.g. `element.api` — registries,
commands, opstreams, layouts, surfaces — all reachable and invocable from the console.

---

## 7. Build order (current)

1. **[done]** Opstreams (`ops` + `opstreams`) + **complement passthrough**; generic
   `automergeOpstream` bridge + `fileTextOpstream`; COW `apply`; two lens modes
   (`map` / recompute); `opstreamToSignal` outer wrapper. 22 tests.
2. **[done]** codemirror node — `src/codemirror/`: `opstream-plugin.js` (op↔view,
   echo-guarded), `codemirror.js` (full extension parity: search/history/indent/
   active-line/rectangular-selection/line-numbers/wrapping + lang compartment),
   `languages.js` (js/md/css/yaml/json from complement), `theme.js` (condensed riso
   theme — NOT lb's 60-var system, noted deviation), `editor.js` (`codemirrorEditor`
   reads the complement). 7 tests incl. full automerge↔codemirror round-trip. Core
   `@codemirror/{state,view,language}` externalized in `vite.config.js`; lang packs
   bundle. NOT yet wired into the tool entry / no `sketchy:editor` wrapper yet.
3. **[done]** The `sketchy:editor` port model + wiring (registry type since renamed
   `sketchy:window` — see NODES.md).
   - **[done]** `src/editors.js` — descriptor contract (typed inlets/outlets),
     registry helpers (`listEditors`/`editorsFor`), `defaultInlets`, `mountEditor`.
   - **[done]** read-only opstream = **absence of `apply`** (automerge `{heads}` pins
     a version; `Source` is the same shape). Editor feature-detects and renders RO.
   - **[done]** codemirror registered as `sketchy:editor "codemirror"` (content +
     language inlets, text outlet).
   - **[done]** file-open `sketchy:editor "file"` — File System Access API →
     `fileHandleOpstream` (in-memory `Opstream` + real `save()` capability) → CM +
     Save. `src/fs-opstream.js`, `src/codemirror/file-editor.js`.
   - **[done]** form `patchwork:tool "form"` — input per doc field, each a PORT
     (`data-automerge-url` + `data-automerge-path`). `src/form-tool.jsx`.
   - **[done]** wire-brush BRAIN (`src/wire.js`, pure + tested): `readPort` (reads
     `data-automerge-url`/`-path` off the nearest port), `streamType`,
     `inletAcceptsType`/`firstMatchingInlet`/`editorsForStream` (schema matching),
     `makeEditorItem` (the persisted `editor` item). DECISIONS: wires are **live by
     default** (store `{url,path}`, rebuild a live opstream; `heads` pins read-only);
     the wire brush is a **dedicated toolbar tool**.
   - **[done]** the tool.jsx INTEGRATION: `EditorItem` in the `Item` dispatch, wire
     as a toolbar tool, the wire-drag gesture + add/drop popups. `editor` items
     persist `{editorId, x,y,w,h, inlets:{name:{url,path,heads?}}}` — and `null` for
     an explicitly-cut inlet (unwire tombstones). (`ensureCanvasFields` no longer
     exists: `ensureLayout` in brush/constants.js migrates items into the separate
     `.sketch` layout doc.)
   - **[done]** opstream visualization — rough.js wires with a travelling value
     PULSE, red error wires, click-a-wire selection, click-a-port schema popover.
4. **[in progress]** Primitives. `layout` shipped as the `sketchy:layout` registry
   (canvas / list / grid registered; list + grid surface the canvas complement —see
   LAYOUTS.md; dock/television still unbuilt) and NAMED LAYERS shipped as the layer
   stack (layers.js: `sketchy:layer-transform` + `sketchy:layer-kind` registries —
   a layer is a coordinate space; camera + frosted viewport overlay built in).
   `command`/`keybinding`/`setting`/`event` not started (keydown + history are
   still hardcoded).
5. **[in progress]** `element.api` shipped (api.js: `find` via the protocols.js
   url→opstream registry, `describe`, editors — devtools-reachable). Reflection
   provenance (registration stacktrace + acorn docstring) not ported.

> Safety rail throughout: the existing vitest harness (real in-memory
> automerge-repo + Solid projection). Don't regress the 79→ green tests
> (~1160 as of 2026-07-01).

---

## 8. The tool as shipped

The starting point all of the above reshapes: a themed spatial canvas for
Patchwork folders — **no tldraw**. Built with Solid (JSX, bundled with vite),
it renders folder contents as draggable HTML windows on an infinite pan/zoom
canvas and lets you draw **on top of the tools** with
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) (pressure
ink) and [rough.js](https://roughjs.com) (sketchy rectangles, ellipses, lines,
arrows — excalidraw style).

### Interaction

- **Bottom toolbar** (a System-7 palette): select, hand/pan, pen, rectangle,
  ellipse, line, arrow, eraser, and **+** (new doc).
- **New doc = "draw the tool you want":** click **+**, pick a datatype, then drag
  a box on the canvas — the doc is created at those bounds.
- **Select & move:** in select mode, click a stroke/shape to select it (dashed
  box), drag to move, Backspace/Delete to remove.
- **Properties panel** (left): edits the active brush, or — when something is
  selected — that mark's own properties, including **stroke colour, fill colour +
  fill style, perfect-freehand thinning/smoothing/streamline, and rough.js
  roughness/bowing**.
- Ink renders in an always-on-top SVG layer (`pointer-events: none`), so you can
  draw over live embedded tools without blocking them.
- Keyboard tool shortcuts (`v h p r o l a e`) are suppressed while typing inside
  an embedded patchwork tool.

### Theming

Theme-aware: derives `--ns-ink`/`--ns-chrome`/`--ns-paper` from the Patchwork
theme vars (`--studio-line`, `--studio-fill`, `--editor-fill-offset-10`) so it
follows the host's dark/light switch, with System-7 cream fallbacks when run
unthemed. The riso accent colours (chee-rabbit / Mimi-Reyburn character) stay
constant. Visual register: System 7 chrome (bevels, pinstripe title bars, close
boxes) warmed into a risograph palette.

### Code map

- **`src/index.jsx`** — registers the datatypes (`newspace` + `sketch`) and the
  tools (`sketchy`, `sketchy:list`, `sketchy:grid`, `sketchy:dock`,
  `sketchy:pencil`).
- **`src/datatype.js`** — the doc model.
- **`src/tool.jsx`** — the `(handle, element) => cleanup` render contract. Holds
  the camera, active tool, pointer gestures, eraser hit-testing, doc creation,
  and image paste. Reactivity comes from `makeDocumentProjection(handle)` of
  `automerge-repo-solid-primitives`.
- **`src/draw.js`** — perfect-freehand → SVG path, and rough.js → declarative
  `<path>` data (via `generator.toPaths`, deterministic per stored `seed`).
- **`src/style.css`** — the theme, injected into the JS bundle.

### Document model (one ordered `items` array)

```
{ title, docs: DocLink[],           // the folder contract
  items: Item[] }                   // array ORDER = drawing/z order

Item kinds:
  stroke { id, kind, points:[[x,y,pressure]], color, size,
           thinning, smoothing, streamline, rotation, parent? }
  shape  { id, kind, type, x, y, w, h, color, fill, strokeWidth,
           roughness, bowing, fillStyle, seed, rotation, parent? }
  doc    { id, kind, url, x, y, w, h, rotation, toolId, parent? }   // patchwork-view shape
  frame  { id, kind, url, x, y, w, h, title, rotation?, parent? }   // a sub-space
```

Everything is a regular shape sharing the same rules: select (shift / marquee
multi-select), move, resize (8 handles), rotate (knob), reorder (front/back),
configure via the draggable palette. `fill` is a colour or `"none"`. The two
mono palette colours are theme tokens (`var(--studio-line)` / `var(--studio-fill)`)
so black/white flip with dark mode.

**Frames** are sub-spaces (placing the `newspace` datatype makes one). A frame is
a container: items dropped inside get `parent: frameId`, store FRAME-LOCAL coords,
and render nested + clipped — so they move/rotate/clip with the frame. Frames
rotate too. No frame-in-frame.

**Why arrays:** everything canvas-related is a flat **array**, never a keyed
map. Array order *is* z-order, and splices merge well. It's a design choice,
not a projection workaround — the current Solid document projection
(`solid-automerge@2`) reconciles map-key deletion cleanly, both nested and
top-level (pinned by tests in `history.test.js`).
