# Sketchy / Littlebook4 — TODO

Working list alongside [LITTLEBOOK4.md](./LITTLEBOOK4.md) (design rationale) and
[NODES.md](./NODES.md) (the wiring system). `[ ]` todo · `[x]` done.

> Rewritten 2026-06-29: the old file had grown chronologically with repeated
> "STILL TODO" sections, so the same items appeared 3–4× and many were already
> done. This is the deduped, accurate state. Full history is in git.
>
> Updated 2026-07-01: a lot had landed untracked — the audit-fix pass, the port
> op-rebase, unwire tombstones, LAYERS, share-session (webrtc-share.js is gone),
> the `.sketch` layout doc. Folded in below; counts refreshed (suite ~1160).

---

## Audit (2026-06-29, via a 3-agent read-only workflow)
DONE since (marking the audit's "done-unmarked"): wire pulse, composable chrome, own/mine
sharing, tool-id picker, edit-lens two modes (map vs recompute), voice notes, follow mode,
the Clamp/Round/Throttle/Delay/Gate/Combine/Switch/Buffer nodes, pretty-JSON lens, the 5
device sources, AND **context-as-nodes** (camera/pointer/tool/brush/selection are now
placeable source nodes with the own/mine toggle — the bottom chips are gone), AND a
**schema honesty pass** (audio/image/pixels/point/float32/stream/enum/bang schemas added in
ops.js; applied to scope/speaker/image/pixels/audio outlets + template enums + context
points; the rest is the running schema workflow).
SCHEMA COVERAGE was ~15% — since then the camera outlets got their schemas too
(`streamSchema`/`imageSchema` in index.jsx); still TODO: structured source schemas (in the
running workflow); inherit-inlet-schema on pass-through transforms; a real
`type: "bang"` discriminator is moot (matched by type tag).
NEWLY-TRACKED design items the audit surfaced (were untracked): reflection/provenance
(acorn AST → api.describe registration site); an INSPECT MODE rendering context ports as
top-edge inlets; chrome parts as SLOTS (replace, not just toggle); movable chrome in the
top-layer doc; lensN SKIP sentinel (unproject→undefined already half-does it).

## Landed 2026-06-30 → 07-01 (was untracked here)
- [x] **audit + fix pass** (~40 defects across canvas/UI/infra): missing imports;
      alt-drag-copy undo; selection/rotation bounds; frame-drop fixes; drag-to-erase
      hits ALL item kinds (DOM hit-test via `data-item-id`); undo/history — pure
      REORDERS recorded + undoable, PER-FIELD restore (`restoreFields` — a peer's
      concurrent recolor survives my undo), deletes re-insert at their original
      z-index; json-path — quote-aware bracket parsing (`["a]b"]`), negative-index +
      missing-intermediate write parity in both apply paths; RLE lens —
      self-distinguishing `{rle:"esc"}` escape wrapper + per-repetition clones (no
      aliased decodes); template-doc — `reconcileTemplateDoc` managed-keys reconcile
      (no longer deletes other tools' fields) + `stripUndefinedDeep`; boundary.js
      cycle guard; html-box → sandboxed srcdoc iframe (stored-XSS fixed); voice
      releases the mic on every exit path; media/source node leak + race fixes;
      LLM node re-run-once-mid-flight + wired-prompt fixes; MIDI hot-plug
      (`statechange` resubscribe); pointer-lock gated behind a user gesture;
      grid/list keyed reconcile (no more embed remounts).
- [x] **PORT-LOCAL OP REBASE** — `serveOpstreamOverPort` (port-opstream.js) rebases
      stale client ops Jupiter-style: implicit rev counting on the ordered
      MessagePort, `basedOn` on upstream ops only (additive wire change), pure
      `transformOp`/`RESYNC` in ops.js (28-case table), bounded 256-op window,
      snapshot resync for out-of-window/orphaned ops. Versionless ops across the
      port are no longer a data-loss hazard.
- [x] **inlet UNWIRE TOMBSTONES** — unwire writes `inlets[name] = null`
      (explicitly-cut ≠ never-wired); `inletBackingPlan` (editor-item.jsx) resolves
      wired → cut → splat → auto → buffer; the ambient bare-tool fallback no longer
      silently re-feeds a cut inlet; the seed-upgrade in brush/constants.js is
      tombstone-aware. inlet-unwire.test.js.
- [x] the **map-key-deletion invariant is FALSE** for the current solid-automerge@2
      projection — nested AND top-level map-key deletion reconcile cleanly (pinned
      in history.test.js). Arrays-only is now documented as a design choice
      (z-order = array order), not a workaround (datatype.js + CLAUDE.md updated).
- [x] **LAYERS** — a sketch is an ordered stack of coordinate SPACES (layers.js):
      `sketchy:layer-transform` + `sketchy:layer-kind` are REGISTRIES (no hardcoded
      geo in the core — a map gains a space by registering a transform); camera +
      viewport ship as the built-in plugins; the `overlay` layer is viewport-pinned
      + frosted. box-transform.js is the uniform coordinate-space-as-box model
      (container subtracts origin, box projects; localToWorld/worldToLocal delegate).
- [x] **minimap + zoom rebuilt as BARE overlay-layer tools** (minimap-node.js /
      zoom-node.js — raw callbacks, no Solid), fed by the placeable **canvas
      source** node (canvas-source-node.js: items/rects/bounds/camera(rw)/pointer/
      selection/peers/view outlets). Seeded as movable items in the layout doc,
      deletable like any item (`dismissedSeeds` stops re-seeding).
- [ ] **MAP node (Leaflet)** — IN PROGRESS right now (map-node.js is mid-rework):
      drawing is landing in the map's GEO coordinate space (strokes and shapes
      stored as lat/lng, reprojected so marks stay on the ground as you pan/zoom).
      Details here are provisional until it settles.
- [x] **share-session.js replaces webrtc-share.js (DELETED)** — one WebRTC mesh per
      sketch: dead-peer eviction + reconnect heartbeat, per-ITEM MediaStreams,
      unmap-on-unshare, share-session.test.js; the **share tray** (share-tray.js,
      `tags:["tray"]`) makes the mesh legible. Value shares now also write the
      owner's value into the doc (`item.shared`, throttled) so late joiners see it.
- [x] **tool ↔ component decomposed for real** — the thin `sketchy` patchwork:tool
      acquires the docs and PROVIDES them as opstreams over a MessagePort
      (sketchy-streams.js); the patchwork:component subscribes and runs the headless
      Canvas on DocHandle adapters (`docHandleFromOpstream`; surface-doc.js is the
      one Solid seam). The layout-doc key migrated `.newspace` → `.sketch`
      (back-compat read + forward migrate); `sketch` is its own datatype now.

## Landed 2026-07-02 — schema UX
- [x] **the port popover shows the SHAPE** — `describeSchema(schema)` (opstreams lib)
      renders the actual field structure (`{ name: string, count?: number }`) in the
      click-a-port popover, one field per line when big (`formatShape`, wire.js) —
      no more probed "accepts: (specific shape)". (No user-facing wire-mismatch
      message exists yet to upgrade — the no-candidates drop is a console.warn.)
- [x] **schema-seeded placement** — drag-from-an-inlet → the chosen TEMPLATE DOC /
      raw value node is prefilled from `schemaExample(inlet.schema)` (`seedConfigFor`
      + `templateSourceFromValue`, wire.js): the template gets GENERATED SOURCE with
      literal example values (not type-holes — holes are unwired inlets, so an
      all-holes seed would materialise an empty, non-validating doc; literals give
      an immediately-valid doc you can still edit into holes), the raw value gets
      the example + kind. No derivable example ⇒ exactly the old behaviour.
      schema-seed.test.js.

## Remaining — small / parallelizable (good for a workflow fan-out)
Each is roughly one self-contained file + a registry line + tests.

- [x] **More sources**: battery, clipboard, device-orientation, device-motion — gated
      `makeSourceMount` sources. (pointer-lock shipped too, see below.)
- [x] **lensN fan-in** — shipped as the **Combine** node (a,b,c,d → object). plus
      **Gate** (run-on-bang), **Switch** (select-of-N), **Buffer** (last-N values).
- [x] **LLMagnifyingGlass** — shipped: `llm-magnifier.js` (registered `llm-magnifier`,
      an extremely brief one-sentence description of what's visibly under the glass)
      over the tested `board-snapshot.js` helper (board region → what's there).
- [ ] **lensN SKIP sentinel** — "don't write this source" on a fan-in (Combine covers
      the read side; SKIP is the write side).
- [x] pointer-lock source; **Clamp**, **Round**, **Throttle**, **Delay** nodes; **pretty
      JSON** lens — all shipped (self-contained files + tests).
- [ ] more lenses (map-over-list variants); more tests / integration (suite at ~1160).

## Brush API (the keystone) — ESSENTIALLY DONE
The imperative `use(canvas)` contract (brush-host.js) is a superset of the legacy `behavior`
hook. EVERY tool is now a brush routed through ONE host (pen/shape/text/eraser/wire/place),
each a tiny separately-tested module; the host exposes the live context Sources, the real
`layout` opstream, resolved params, and per-brush canvas capabilities on `ctx`.
- [x] **per-brush params** persisted per-viewer (`brushCfg` in the top-layer doc); resolve
      brush-cfg → schema default → stroke[key] → store (`brushParam` + `brushParamDefault`).
- [x] **params from a REAL schema** — `paramsSchema(fields)` is a Standard Schema that ALSO
      carries `.fields`/`.defaults` (validation + the panel UI in one). All stroke brushes
      (pen/marker/ink-pen/crayon/charcoal/highlighter) declare it; the panel reads `paramDefs`.
- [x] **`use(canvas)` shape** — pen (`pen-brush.js`, also the passive-stroke fallback),
      shapes (`shape-brush.js`), text (`text-brush.js`), eraser (`eraser-brush.js`, now
      drag-to-erase), wire (`wire-brush.js`), place/box (`place-brush.js`). All out of tool.jsx.
- [x] **node params too** — `paramsAsInlets`/`effectiveInlets` read the same `paramsSchema`
      (UI type → wire type); the properties popup renders a node's params bound to its config
      (the Delay node has a live `Delay (ms)` slider). One renderer for brush + node params.
- [x] new stroke brushes: **Marker, Ink pen, Crayon, Charcoal** (self-contained plugins).
- [x] OWN/MINE sharing RELAYS — broadcast on the FOLDER handle, throttled.
- [ ] **chrome reads the `context`** instead of ~15 props (the remaining brush-API refactor:
      pull pen/shapes/eraser/text out of tool.jsx is DONE; the chrome prop-drilling isn't).
- [ ] context-ports-as-inlets (top-edge inlets in an inspect mode).
- [ ] voice brush params (it's a click-to-place behaviour brush — N/A for stroke params).

## Layout / composition system (the "build on it" infra) — IN PROGRESS
The Canvas is a headless component; every chrome part is composable via `opts`, and
`makeNewspaceTool(opts)` (tool.jsx) is the public way to ship your OWN patchwork:tool
over the same component with a different default UI — composition + sharing infra.
- [x] composable chrome: `opts.{toolbar, minimal, minimap, properties, presence, zoom,
      defaultTool}` each gate a part; `makeNewspaceTool` documented as the build-on entry;
      `sketchy:pencil` is the first example (pencil-only, no minimap).
- [x] **LAYERED layout** — chrome resolves per-VIEWER override (top-layer `chrome`) → per-
      SKETCH shared (layout-doc `layout`, seeded from the tool's opts) → tool default. The ⊞
      tray has a `this sketch` / `just me` scope toggle. "Edit the layout for this sketch",
      shared by default, with a personal override on top.
- [x] **real `patchwork:component`** — `sketchy-canvas` registered (returns `{Canvas,
      makeNewspaceTool}`); a patchwork:tool = the component + a default layout. `Canvas`
      re-exported. A new tool over the same canvas is `makeNewspaceTool({…opts})`.
- [ ] expose chrome parts as SLOTS a wrapping tool can replace (not just toggle) — and
      `opts.tools` (an explicit tool subset) in the Toolbar.
- [ ] folder references MULTIPLE complement docs (`@layouts:{canvas,dock,list}`) not just
      `.sketch` (was `.newspace`, migrated once already — generalise `ensureLayout` →
      `ensureLayoutDoc(repo, fh, key)` + migrate).
- [ ] a clean layout switcher in the CANVAS chrome (NOT the old floating buttons — chee
      removed those). list + grid already have one: `layoutsFor` re-opens the folder
      through another lens.
- [ ] dock / tiling layouts. (list + grid already surface the canvas complement —
      `complementSummary`/`complementBanner` — so "each layout surfacing the others'
      complements" is proven for two of them.)

## Remaining — UI / interaction polish (serial, mostly canvas.jsx + css)
- [x] **Red wire** for a stream carrying an error — the canvas subscribes per-wire to its
      source and mirrors error state into a `wireErrors` store; an erroring wire draws red
      with a ⚠ title. (port halo on the nub itself still TODO.)
- [x] **WIRE PULSE** — a dot travels the wire when a value flows (per-wire subscription
      bumps a token → a keyed `<animateMotion>` dot replays along the wire's cubic).
- [ ] **ROUGH inlet/outlet nubs** — the wires are rough.js; the nubs are still CSS
      circles/diamonds.
- [x] **params in the PROPERTIES popup** — a single generic param block renders `paramDefs`
      bound to a selected NODE's config OR the active brush's config; a node reacts via
      `onConfig` (Delay's live ms slider). (param-inlet-wins-when-wired is the remaining bit.)
- [ ] raw-value inlets editable inline in the properties popup (not just on the node).
- [ ] pin a wire to `heads` = read-only (an explicit gesture/affordance).
- [ ] wire ARROWS orientation/sizing polish (still "not quite right").
- [ ] recase (upper/lower) uses index-aligned diff; a real diff would handle
      mid-string insert/delete. (good enough for now.)

## Remaining — features
- [x] **OWN/MINE SHARING for value sources** — every `makeSourceMount` source now has a
      👤 own ⟷ 📡 mine toggle: in "mine" the OWNER runs the device + broadcasts each value
      over the doc's ephemeral channel (keyed by item id, via the new mount `broadcast`/
      `onBroadcast`); everyone else receives + displays it instead of running their own.
      (battery/clipboard/orientation/motion/geo/midi/mic/gamepad/pointer-lock.) +3 tests.
      NOW ALSO reliable: the owner writes the value into the doc (`item.shared`,
      throttled via `shareDoc`), so late joiners see the last value.
- [x] **CAMERA (STREAM) sharing over WebRTC** — now via `share-session.js`
      (`webrtc-share.js` is DELETED — superseded): one mesh per sketch, signalled over
      the folder-handle ephemeral channel, per-ITEM MediaStreams, dead-peer eviction +
      reconnect heartbeat, unmap-on-unshare (share-session.test.js). The camera node
      keeps the 👤 own ⟷ 📡 mine toggle + owner-name tag; the owner runs getUserMedia,
      receivers just display the remote stream. The share tray shows the mesh live.
- [x] MIC audio STREAM sharing — `makeSourceMount({stream:true})` opt-in: an owner shares
      the mic's `complement.mediaStream` over the mesh; receivers PLAY it (an <audio>) and
      get an analyser on the outlet complement (so a wired Scope works on the shared
      audio). Value-shares the {rms,peak} levels AND stream-shares the audio.
- [ ] audio-file STREAM sharing (mountAudioFile is a custom mount — give it the toggle too).
- [ ] **LLM real schema→schema** — ask for + validate the OUTLET's Standard Schema
      instead of best-effort text/JSON-ish parsing.
- [x] empty `patchwork-tool`: a tool-id picker field (blank = host default); the view now
      also rebuilds reactively when the wired doc changes (wire-after-place works).
- [x] **tabs & flaps like Squeak** — SHIPPED (flaps.jsx + parts-bin.js): the
      `sketchy:flap` REGISTRY (`{id, name, edge?, load() → mount({element, host})}`);
      tabs docked bottom/left/right, click opens the drawer, drag the tab to
      another edge re-docks; per-viewer state (`flaps[id] = {edge, open}`) in the
      top-layer doc alongside brushCfg/chrome; gated + slottable like the other
      chrome parts ("flaps" in the ⊞ tray). The flagship flap is the **PARTS
      BIN** — a census of everything placeable (shapes/stamps/datatypes/sources/
      editors/lenses, straight from the registries, grouped like the + menu);
      tiles DRAG OUT over the toolbar's `text/x-newspace-tool` DnD type with
      namespaced part ids (`datatype:`/`window:`/`lens:`, bare ids unchanged) and
      a click arms the place flow. Brushes are deliberately NOT parts (placing
      one only arms it). flaps.test.js + parts-bin.test.js.
      STILL TODO: register the parts flap in index.jsx; toolbar/params offered
      as flap registrations (the container + slots exist — a thin wrapper that
      renders Toolbar/Properties into a flap body); history-as-a-flap is OUT
      (deferred by design).

## Remaining — large / infra (serial, design-heavy)
- [ ] **GENERATIVE "draw-a-world" LLM tool** — an LLM block that writes JS to add
      brushes/shapes/whole mini-worlds ("rabbits and cats I can name/pet/feed"),
      rendered in a frameless sandboxed iframe talking over opstreams. Needs the
      three-as-a-unit below.
- [ ] **sandbox box** — a box that is an IFRAME boundary; tools drawn inside run
      sandboxed. The concrete consumer for `boundary.js`.
- [x] opstreams cross a real MessagePort — `port-opstream.js` (`portOpstream` /
      `serveOpstreamOverPort`): ops are plain JSON so they cross natively, both ways,
      with the Jupiter-style rebase for stale client ops (see the landed section).
      The tool↔component boundary (sketchy-streams.js) runs on it.
- [ ] complement CAPABILITIES over the port — `boundary.js`'s serializeComplement/
      hydrateComplement (proxied functions, dropped handles) isn't wired into
      port-opstream yet: values/ops cross, capability functions don't.
- [ ] `data-opstream-inlet="<schema>"` — buttons / embedded tools DIRECTLY wireable
      (readPort understands an arktype/TS-style schema string).
- [ ] **build-a-tool in-canvas** ("it should be possible to build") — draft a tool's
      source + preview/run it on the canvas (COW draft overlay + self-bootstrapping
      preview, cf. draftable-toolmaking).
- [x] **brush-API refactor** — DONE (see "Brush API" above): `use(canvas)` contract,
      `paramsSchema`-generated panels, the `layout` opstream bridge, and ALL tools pulled
      out of tool.jsx into brush modules (pen/shape/text/eraser/wire/place). Remaining tail:
      chrome reads the `context` instead of prop-drilling; context-ports-as-inlets.
- [ ] **layouts** — DONE: the `sketchy:layout` registry (canvas/list/grid registered),
      list + grid surfacing the canvas complement + switching layouts. REMAINING:
      dock/tiling layouts; multiple complement docs (`@layouts:{…}`); a canvas-side
      switcher (all tracked above in "Layout / composition system").
- [x] minimap + zoom (+ their canvas-source feeds) as MOVABLE overlay-layer ITEMS —
      seeded into the LAYOUT doc by `ensureLayout`, anchored, deletable like any item
      (`dismissedSeeds`). NB the design moved: they live in the shared layout doc's
      `overlay` layer, not the per-viewer top-layer doc.
- [ ] the REST of the chrome (palette/properties/eye/outlets) as movable items too.
- [ ] context ports on the top-level sketchy rendered as INLETS along the top edge.
- [ ] `@patchwork/handoff` so `find`-able urls are also importable; `api.find` accepts
      a subdoc path encoded in the url. (protocols.js — the url→opstream protocol
      registry behind `api.find` — is the base; the handoff bridge is unstarted.)
- [ ] port lb reflection (acorn AST → JSDoc/signature/registration site) behind
      `api.describe` (basic describe already exists).
- [ ] cosmetic: rename internals (`listEditors`/`EditorItem`/`editor-item.jsx` → surface*).

## Needs a browser re-test (likely already fixed)
- [ ] wire SELECTION (click a wire to select, ⌫ to delete) — should work now the
      box-remount churn is gone.
- [ ] the PROPERTIES panel — intact but contextual (shows on selection / a draw or
      brush tool; hidden while only wiring). Confirm it appears as expected.

---

## Shipped (highlights)
Foundation: opstreams (one op + snapshot + **error op**), COW `apply`, complement
passthrough, lenses-as-optics, `automergeOpstream` (read-only via heads), the Solid
projection bridge, **opstream-over-MessagePort with op rebase** (port-opstream.js).
Wire brush: ports as nubs, bounds-math endpoints, persistent + selectable wires, schema
matching (incl. bang→bang by declared type), drag-from-inlet, splat whole-doc inlet,
world-anchored add/drop popups (hand-rolled — **Kobalte removed**), **click-a-port
schema popover**. Mount-once reactive inlets (stable proxies; **no remount on edit**;
`null` unwire tombstones). Nodes/sources/lenses: codemirror (+ working language inlet),
file, automerge (+ new), raw value, bang, timer, counter, sample, RAF, mic, camera
(ImageData/MediaStream), video, image, **pixels (float32)**, scope, audio-file, speaker,
inspector, json-path, json-set (`.`=whole doc), **template-doc-as-real-dochandle**,
**LLM** (transform/source, `{{var}}` inlets, `@out` dynamic outlets + `think`, λ code
with a bidi `code` outlet, bidi reverse, ⚙ model picker), JS box, HTML box (sandboxed),
**Math / Range map / Split-Join / Map-list**, the flow nodes (Gate/Combine/Switch/
Buffer/Delay/Clamp/Round/Throttle), the device sources (battery/clipboard/orientation/
motion/pointer-lock), **LLM magnifying glass**, **minimap/zoom as overlay-layer tools**,
the **canvas source**, the **map** (in progress). Binary-safe value handling (no freeze
on camera frames). `<Suspense>` on doc embeds. Layouts: canvas + list + grid. LAYERS
(coordinate-space registries + frosted overlay) + box-transform. **Sketchpad** tool
(pencil-only, no minimap). Top-layer user-state doc, floating inspectors, follow mode,
presence/peer outlets, voice notes, the **constraint-sketch brush** (Sutherland bars +
shared pivots, sketch.js solver). share-session WebRTC mesh + share tray. Brush-API
refactor: every tool a `use(canvas)` brush through one host; params are real schemas
(`paramsSchema`) for brushes AND nodes; the layout is a real opstream; a
`patchwork:component` + layered per-sketch layout. Tests: ~1160.
