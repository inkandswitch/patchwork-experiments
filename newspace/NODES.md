# Nodes: sources, sinks, transforms, editors

The canvas wires **opstreams** between **nodes**. A node has typed **inlets** (it
consumes) and **outlets** (it provides). Everything else is a *role* — a
consequence of a node's port topology, not a separate plugin type. (Wider design
rationale: [ARCHITECTURE.md](./ARCHITECTURE.md) · layouts:
[LAYOUTS.md](./LAYOUTS.md) · open work: [TODO.md](./TODO.md).)

## Roles are topology (see `nodeRole` in `editors.js`)

| role | inlets | outlets | examples |
|------|:------:|:-------:|----------|
| **source** | 0 | ≥1 | file, clock, gamepad, geolocation, midi, camera, battery… |
| **sink** | ≥1 | 0 | json-set, speaker, the image display |
| **transform** | ≥1 | ≥1 | a *lens you can see* — `json-path` |
| **editor** | ≥1 | ≥1 | codemirror (rich UI, writes back) |

`transform` and `editor` share a topology; we tag editors by intent so the menu
can group them. A bare, UI-less, ~bijective transform is registered as the lighter
**`sketchy:lens`** type (`number→string`, `File→text`, `File→JSON`) — it has no
mount, just a `project`/`map`/`apply` spec applied by `applyLens`.

The + menu now groups placeable nodes: **sources · editors · lenses**.

## The current set (census, 2026-07-01)

`sketchy:window`: codemirror, html (sandboxed), inspector, file, file-edit, clock,
gamepad, geolocation, midi, camera, image, pixels, video, mic, audio-file, speaker,
scope, raf, bang, timer, counter, sample, llm, llm-source, value, automerge, template,
patchwork-tool, json-path, json-set, js, math-op, range-map, split-join, map-list,
gate, combine, switch, buffer, delay, clamp, round, throttle, battery, clipboard,
device-orientation, device-motion, pointer-lock, llm-magnifier, minimap, zoom, canvas
(the canvas-as-source), map (Leaflet — in progress), + the ctx-* context sources
(viewport/pointer/brush/selection).
`sketchy:lens`: number↔string, json-parse/json-stringify, file→text, file→JSON,
image→data URL, uppercase, lowercase, length, keys, json-pretty, rle/unrle.
Neighbouring registries (not nodes, same spirit): `sketchy:brush`
(pen/marker/ink-pen/crayon/charcoal/highlighter + constraint + voice + the
interaction brushes), `sketchy:palette` (below), `sketchy:layout`
(canvas/list/grid — LAYOUTS.md), `sketchy:layer-transform` +
`sketchy:layer-kind` (layers.js — a layer is a coordinate space), and
`tags:["tray"]` tools (the share tray).
(2026-07-02 additions to `sketchy:window`: palette-config — the palette's
configurator window, a source with a `tools` outlet — and presence, the
bar/controls half of presence as a bare window.)

## Palettes as plugins: `sketchy:palette`

A palette is data — an array of ENTRIES (model.js):
`{kind:"tool", id}` | `{kind:"divider"}` |
`{kind:"menu", label, icon?, items:[entry…]}` (one level of nesting).
Register one:

```js
{ type: "sketchy:palette", id, name, icon?, entries: [entry…] | () => [entry…] }
```

Registered palettes appear in the parts bin's **palettes** group; dragging one
out instantiates a palette window with those entries (`entries` may be a
function, evaluated at drop time — the built-in "full palette" censuses every
registered brush that way; "full"/"sketch" are registrations of this type,
registry/palettes.js). The palette WINDOW also takes entries live over its
`tools` inlet — the seeded pair wires `ns-toolbar-config` (palette-config's
`tools` outlet) → `ns-toolbar-palette`. Unwired, it falls back to
`config.entries`, then the legacy `config.brushes` id list (back-compat
forever). Saving a palette is the ordinary copy gesture now: alt-drag the
palette window and drop the copy into the parts FLAP (`ns-parts`, a
`flap: true` frame — LAYOUTS.md) — item containment does the work. (The old
⠿-grip identity / `config.customParts` protocol is gone; the field is never
deleted from old docs, just no longer read.)

## The umbrella type: `sketchy:window` (decided)

`sketchy:editor` was the wrong name — a source (gamepad) and a transform (json-path)
aren't "editors", and a lens with UI (json-path) *is* a surface, which was the tell.
The registry type is now **`sketchy:window`**. (Internal symbols — `listEditors`,
`EditorItem`, `editor-item.jsx` — keep their names for now; they're implementation
detail. Stored items reference `editorId` the id string, not the type, so the rename
was internal and safe.)

A surface is the universal framed thing on the canvas: typed inlets/outlets, optional
UI, optional `params`. Its ROLE (source/sink/transform/editor) is derived from its
ports (`nodeRole`). `sketchy:lens` stays as the lighter UI-less transform.

## Sources (`src/sources.js`, mounted via `src/source-nodes.js`)

Each factory returns `{ stream, stop }` with the `Source` created **synchronously**
(so a node can register it as an outlet immediately) and the device fed into it.
Values are JSON-shaped snapshots (lens-friendly); opaque handles (a `MediaStream`)
ride in the stream's complement.

- **file** — pick a local file → a read-only `File` snapshot `{name,type,size,
  lastModified,extension,text}`, **watched** so it reflects on-disk changes. A
  read-only source has no edits to be dirty, so it reloads unconditionally.
- **clock / gamepad / geolocation / midi / camera** — thin wrappers over the Web
  platform. Gamepad polls each animation frame (controllers only appear after a
  button press — a browser rule). midi/geolocation/camera prompt for permission;
  midi resubscribes hot-plugged inputs via `statechange`.
- **battery / clipboard / device-orientation / device-motion / pointer-lock** —
  gated `makeSourceMount` sources (an Enable button first; pointer lock must be
  requested from a user gesture, then emits raw `{dx,dy}` deltas).
- every `makeSourceMount` source has the 👤 own ⟷ 📡 mine share toggle — see
  "Collaborative sources" below.

## File: watch + decompose

- The **`file` source** provides only the `File` outlet (your "it's only meant to
  provide outlets"); compose `file → (File→JSON) → inspector` or
  `file → (File→text) → codemirror`.
- **`file-edit`** keeps the edit-in-codemirror-with-Save flow, now **watched**:
  `watchFileStream` reloads from disk *unless the stream is dirty* (unsaved edits
  win), and `save()` re-baselines so your own write isn't seen as an external
  change. (`fs-opstream.js`: `diskChanged`, `isDirty` are the pure decisions.)
- Editing a file *through* a read-only lens (so codemirror could save back to the
  File source) needs a **bidirectional lens** (a `File→text` with `apply` that
  writes the handle). Not built — the read-only view path is done.

## Lens-with-UI = a node (`src/json-path.js`)

`json-path` is a `sketchy:editor` (a node) with an inlet, a **path text field**,
and an outlet — a jq-ish narrowing (`.a.b[2]`, `["key"]`, identity `.`). Because it
carries UI state (the path), it can't be a bare `sketchy:lens`. This is the
concrete proof that *a visible/stateful lens is just a node*.

## Lenses as optics (Getter / Lens)

A lens is an optic. `project` alone is a **Getter** (read-only); `project` +
`unproject` is a **Lens** (get *and* set). `applyLens` composes the optic with its
source: over an editable source a Lens stays a Lens (bidirectional — codemirror can
write back); over a **read-only** source it collapses to a Getter (we drop `apply`,
so a downstream editor presents read-only rather than silently dropping edits). The
`number → string` lens is bidirectional (`unproject` parses the text back to a
number); the `File → text/JSON` lenses are Getters (their File source is read-only).

## json-set — the write counterpart of json-path

`json-path` narrows (a Getter). **`json-set`** writes: wire a `value` and a target
`into` opstream, give a path, and it writes the value to that field
(`into.apply({path, range, value})`). A sink (no outlet); the target must be editable.
`writeOp(steps, value)` is the pure op-builder (the last path step is the `range`).
(Writing a value to a *visible* field is already possible by wiring straight to its
`data-automerge-*` port; json-set generalises to any path of any wired doc.)

## codemirror authors too (a surface can be its own source)

The codemirror `content` inlet is **optional**: wired ⇒ it views/edits that stream;
unwired ⇒ it's a **source** — it makes its own editable `Opstream("")` and exposes it
on `text`. So "the code editor doesn't *need* an inlet." Generalises: any surface can
fall back to an internal stream when an inlet is unwired. (Since 2026-07:
never-wired ≠ explicitly CUT — unwiring writes a `null` tombstone, and
`inletBackingPlan` resolves wired → cut → splat → auto → buffer, so a fallback
never silently re-feeds an inlet the user disconnected.)

## params schema (groundwork — `editors.js`)

A surface (and a brush) may declare `params: [{name, type, schema?, default?}]` —
configurable knobs. The insight: a param is ALSO wireable. `paramsAsInlets(descriptor)`
projects each param to an OPTIONAL, `param`-tagged inlet; `effectiveInlets` =
declared inlets + param-inlets. So a knob can be driven by the properties panel OR by
a wire. (All built now: the properties popup renders `paramDefs` bound to a selected
node's config OR the active brush's, mounts react via `onConfig`, and
`effectiveInlets` makes each param wireable.)

## Complement across a JSON boundary (`boundary.js`)

When a stream crosses a JSON-only channel (a MessagePort to an embedded tool), the
VALUE crosses by structured-clone but the COMPLEMENT can't carry functions/handles.
`serializeComplement` splits it: JSON fields → `data` (by value); functions →
`capabilities` (proxied as async calls back over the channel — safe when args are
0/JSON/transferable, arity recorded); live handles (File, MediaStream) → `dropped`.
`hydrateComplement` rebuilds the far side: data + async stubs that call `invoke(name,
args)`, so capability feature-detection (presence of `save()`) still works across the
boundary. (The pure split is done. Separately, opstreams themselves now cross a real
MessagePort — `port-opstream.js`: ops are plain JSON so they cross natively, and stale
client ops are REBASED Jupiter-style (`transformOp`/`RESYNC`, ops.js) rather than
misapplied. Proxying complement CAPABILITIES over that port is still TODO — values/ops
cross; functions don't.)

The concrete consumer: a **sandbox box** — a "sand" boolean on a box (or its own
tool) that makes the box an *iframe boundary*, so tools drawn inside run sandboxed.
Streams crossing in/out use exactly this split: value by structured-clone, complement
functions proxied over postMessage, live handles dropped.

## Related: bireactive

`~/soft/orionreed/bireactive`'s `lens(source, fwd, bwd)` is the same shape as our
`transform` (`fwd` = `project` getter, `bwd` = `unproject`/`apply` setter); lenses
compose by feeding one's output as the next's source, mirroring our wire chains — so
that work validates this model. Two ideas worth lifting later: a `SKIP`
sentinel (a backward write that leaves a source untouched — our `unproject`
returning `undefined` already means this; still TODO) and `lensN` (a multi-source
fan-in lens — the READ side shipped as the **Combine** node, a/b/c/d → object;
SKIP is the write side).

## Borders

Surfaces (editors/lenses/sources) now draw a **rough.js** hand-drawn border like docs
and frames — `roughRectPath(w,h, seedFromId(id))`, deterministic per item.

## Collaborative sources (1 of 2 built)

A gamepad/midi/camera source is **local** to whoever placed it (each viewer reads
their own device). Two interesting wants the design raised:

1. **Share one source's stream to peers** — BUILT: every `makeSourceMount` source
   has a 👤 own ⟷ 📡 mine toggle. In "mine" the OWNER runs the device; values go
   out over the doc's ephemeral channel AND are written into the doc
   (`item.shared`, throttled) so late joiners see the last value; live
   MediaStreams (camera/mic) travel the per-sketch WebRTC mesh
   (`share-session.js` — dead-peer eviction, reconnect heartbeat, per-item
   streams; the share tray shows the mesh live).
2. **Shared ownership** — two people send presses into the *same* logical
   controller source (merged input). Same transport, but inputs union rather than
   one owner. "Should just be an option" — a per-source `share: "merge"`.
   Not built.

## Performance: wires (Solid signal arrangement)

The wire layer is split so only signal results cause work, nothing redundant:
- **`wireSpecs`** — a memo of the wiring STRUCTURE (which ports connect + bidi-ness),
  with **stable identity** (returns the previous array when its structural signature
  is unchanged). So panning, zooming, or moving an item does NOT recreate wire rows.
- **per-row geometry memo** (`geomFor`) — reads `cam()` + live item positions, so a
  pan/zoom/move updates only the row's `transform`/`d` ATTRS, never its DOM.
- **cached, pan-invariant rough paths** (`roughLink`/`roughArrow` in draw.js) — drawn
  relative to `from` and positioned by `translate`, so a wire that only pans keeps the
  same `(dx,dy)` and hits the cache → roughjs is not re-run per frame. Was: roughjs
  regenerated for every wire every frame + `<For>` recreated every row every frame.

## PLANNED: generative LLM tool (LLM that draws a world)

An LLM block that CONTRIBUTES new brushes/shapes/tools — say "let's live in a world
with rabbits and cats I can name, pet, and feed carrots" and it writes JavaScript that
runs on the page and makes that work. Render the generated code in a FRAMELESS iframe
(the sandbox boundary), but let it talk over OPSTREAMS: the prompt teaches it the
opstream + postMessage interface and how to declare inlets/outlets. Depends on:
boundary.js (serializeComplement/hydrateComplement) + the sandbox-box iframe boundary
+ a value-by-structured-clone / capability-by-postMessage proxy. NOT built (though the
opstream-over-port half now exists — port-opstream.js; the plain HTML box is already a
fully-sandboxed srcdoc iframe, no scripts).
