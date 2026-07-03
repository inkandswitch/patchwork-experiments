# Sketchy / Newspace

Sketchy is a Patchwork component for a malleable spatial canvas: Solid UI,
perfect-freehand ink, rough.js shapes, live embedded tools, opstream wiring, and
Automerge-backed documents. The package directory remains `newspace/`; persisted
ids are stable for compatibility (`sketch` forward, `newspace` read forever).

## Build

```sh
pnpm build
pushwork sync
pnpm exec vitest run
```

Published module URL: `automerge:3EoRD6Adef8TitsP2SX3peY5bWxq`.

`vite.config.js` externalizes host-provided packages (`solid-js`, Automerge,
Patchwork packages) and bundles local rendering deps. Do not bundle a second
Solid runtime.

## Names And Compatibility

- Directory: `newspace/` stays.
- Datatypes: `sketch` is forward; `newspace` remains a back-compat alias.
- Folder field: `.sketch` is forward; `.newspace` is read forever.
- Registry prefix: `sketchy:` for current plugin types; `newspace:brush` is a
  deprecation fallback.
- Tool ids: `sketchy`, `sketchy:pencil`, etc. stay stable.
- Persisted fields are additive-only: old data is read forever and not deleted
  during migrations.

## Core Model

The system is intentionally small:

- **Opstream** is the data/change substrate. It carries a value, ops, schema,
  and a complement sidecar.
- **Surface** is any placeable thing with inlets/outlets, optional UI, optional
  params. Source/sink/editor/transform/lens are roles derived from topology.
- **Brush** turns gestures into item/doc ops.
- **Sketch doc** owns content: `items[]`, layers, marks, shapes, windows, wires,
  and chrome-as-items.

Legacy `patchwork:tool` is a thin adapter: it acquires docs/opstreams and mounts
the `patchwork:component`. The component receives streams/context and renders;
it does not decide where those streams came from.

## Opstreams

There is one mutation shape plus snapshots:

```js
{ type: "snapshot", value }
{ path, range, value }
```

- `range: [from, to]` splices strings, bytes, or lists.
- `range: key` assigns/deletes object/list fields.
- `path` is relative to the opstream value.
- `apply` is copy-on-write; untouched subtrees retain identity.
- A read-only source has no `apply`.
- Lenses may map ops for granular transforms or resnapshot for computed views.
- Bidirectionality is feature-detected: a lens with write-back over read-only
  input becomes read-only.

Complements pass through transforms. Capability presence is the affordance:
`complement.save?.()`, not `saveable: true`. JSON-only boundaries serialize
plain complement data, proxy JSON-safe functions, and drop live handles.

Automerge is attached to the opstream, not to editors. Editors speak streams,
schemas, and capabilities.

## Surfaces, Nodes, And Wiring

Registry shape:

```js
{
  type: "sketchy:window", // legacy name for mounted surface
  id, name, icon,
  inlets: [{ name, type, schema?, required? }],
  outlets: [{ name, type, schema? }],
  schema?, params?, dynamicInlets?, dynamicOutlets?,
  load() -> mount
}
```

`sketchy:lens` is the headless transform variant and normalizes to the same
surface shape. Roles:

- source: no inlets, one or more outlets
- sink: one or more inlets, no outlets
- editor/transform: both
- lens: explicit headless transform

Params are also optional inlets. The UI control, persisted config field, default,
schema, and wireable port should come from the same param definition.

The parts catalog is the single census of placeable things: datatypes, surfaces,
lenses, palettes, flaps, shapes, and stamps.

## Current Surface Catalog

Representative surfaces include text editor, HTML, inspector, file, clock,
context sources, gamepad/geolocation/MIDI, camera/image/video/pixels/audio,
bang/timer/counter/sample, LLM, raw value, automerge doc, template, patchwork
tool, file edit, JSON path/set, JS, sandbox, math/range/list/flow nodes,
palette, presence, layers, parts bin, minimap, zoom, map, and canvas source.

Lenses include file-to-text/JSON, image-to-data-url, number/string, JSON
parse/stringify, upper/lowercase, length, keys, JSON pretty, RLE, and mapped
list variants.

## Layouts, Layers, Containers

A folder is the shared noun list: `{ title, docs: DocLink[] }`. A sketch doc is
the canvas/content doc referenced by `.sketch`. The former “layout complement”
is now understood as the sketch document itself.

Layers are ordered coordinate spaces. `layers[0]` is an item's home space and
owns coordinates; later entries are visibility memberships. `layers` wins on
read; legacy `layer` is read and mirrored for old clients, never deleted.

Flaps are no longer a registry/chrome system. A flap is a `flap: true` frame:
a sticky named container that collapses to an edge tab while stuck. Open state
is per-viewer in the top-layer user doc.

List/grid/dock/layout-switch code was removed as dormant. If they return, they
should return as container types or surfaces over the same content model, not
as separate stale registered tools.

## State Homes

- Device-local state: camera, debug toggles. Store in localStorage.
- Person state: brush config, chrome placement, floats, flap open state. Store
  in the top-layer user doc.
- Shared state: items, layers, palette entries, content, wires. Store in the
  sketch/layout doc.
- Session-only UI: plain signals.

Undo covers user intent: draw/move/resize/delete/reorder/paste/text/wiring.
Derived measurements and per-viewer state are not undoable. Node `setConfig`
history is still open work.

## Brushes And Chrome

Brushes are registry plugins under `sketchy:brush`. They may provide a modern
`use(ctx)` handler or legacy behavior; passive stroke brushes declare stroke
style. The old `newspace:brush` registry is read as a temporary fallback.

Chrome is moving toward ordinary overlay-layer items. Already itemized:
palette, palette config, minimap, zoom, parts bin, presence, layers. Remaining
fixed chrome should move the same way where useful.

Palettes are data:

```js
{ kind: "tool", id } | { kind: "divider" } |
{ kind: "menu", label, icon?, items: [...] }
```

`config.entries` is forward; legacy `config.brushes` is read forever.

## Performance Roadmap

Built perf support lives in `src/perf.js`: `now`, `frame`, `count`,
`rafBatch`, counters, and tests. The active roadmap:

1. Measure before optimizing.
2. Coalesce doc writes during drag/resize/rotate to at most once per frame.
3. Use shared item indexes and memoized render buckets.
4. Cache viewport rects and port indexes to reduce layout flushes.
5. Coalesce high-frequency context source writes.
6. Memoize item render props and color resolution.
7. Memoize visible wires and per-wire geometry.
8. Keep overlays and DOM reads bounded during pan/drag.

Perf baselines are scratch data, not architecture; remeasure when changing hot
paths.

## Tests

Tests live outside production code under `tests/`. Production code stays under
`src/`. Vitest uses happy-dom and client Solid resolution.

## Open Work

- Map node rework: store/draw marks in geo space.
- Finish chrome-as-items, especially properties.
- Route drawn marks into open flap drawers.
- Nub polish and port-error halos.
- Param-inlet-wins in properties UI; raw-value inline editing there.
- Pin wires to heads for read-only historical views.
- Wire arrow orientation/sizing polish.
- Better recase diff for mid-string edits.
- `lensN` write-side SKIP semantics.
- More lenses and structured source schemas.
- Voice brush params where appropriate.
- Audio-file own/mine sharing.
- LLM schema-to-schema generation and validation.
- Sandbox complement capabilities over ports.
- Direct `data-opstream-inlet="<schema>"` wiring.
- In-canvas tool building/preview.
- `@patchwork/handoff` importable protocol URLs.
- Reflection behind `api.describe`.

## House Rules

Comments explain why and name invariants; avoid stale narrative. Commit subjects
are imperative, scoped, and concrete (`canvas: ...`, `nodes: ...`, `docs: ...`).

