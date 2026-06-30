# Sketchy / Littlebook4 — TODO

Working list alongside [LITTLEBOOK4.md](./LITTLEBOOK4.md) (design rationale) and
[NODES.md](./NODES.md) (the wiring system). `[ ]` todo · `[x]` done.

> Rewritten 2026-06-29: the old file had grown chronologically with repeated
> "STILL TODO" sections, so the same items appeared 3–4× and many were already
> done. This is the deduped, accurate state. Full history is in git.

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
SCHEMA COVERAGE was ~15% — still TODO: media schemas on camera outlets + structured source
schemas (in the running workflow); inherit-inlet-schema on pass-through transforms; a real
`type: "bang"` discriminator is moot (matched by type tag).
NEWLY-TRACKED design items the audit surfaced (were untracked): reflection/provenance
(acorn AST → api.describe registration site); an INSPECT MODE rendering context ports as
top-edge inlets; chrome parts as SLOTS (replace, not just toggle); movable chrome in the
top-layer doc; lensN SKIP sentinel (unproject→undefined already half-does it).

## Remaining — small / parallelizable (good for a workflow fan-out)
Each is roughly one self-contained file + a registry line + tests.

- [x] **More sources**: battery, clipboard, device-orientation, device-motion — gated
      `makeSourceMount` sources. (pointerlock still open if wanted.)
- [x] **lensN fan-in** — shipped as the **Combine** node (a,b,c,d → object). plus
      **Gate** (run-on-bang), **Switch** (select-of-N), **Buffer** (last-N values).
- [ ] **LLMagnifyingGlass** — a lens/tool giving an extremely brief description of
      what's visibly under it on the board (board snapshot → vision/LLM). NOTE: imports
      the LLM (external) so its mount can't be vitest-tested — do it serially, not in a
      fan-out (a board-snapshot helper CAN be tested).
- [ ] **lensN SKIP sentinel** — "don't write this source" on a fan-in (Combine covers
      the read side; SKIP is the write side).
- [x] pointer-lock source; **Clamp**, **Round**, **Throttle**, **Delay** nodes; **pretty
      JSON** lens — all shipped (self-contained files + tests).
- [ ] more lenses (map-over-list variants); more tests / integration (suite at 1012).

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
      `.newspace` (generalise `ensureLayout` → `ensureLayoutDoc(repo, fh, key)` + migrate).
- [ ] a clean layout switcher (NOT the old floating buttons — chee removed those).
- [ ] dock / tiling layouts; each layout surfacing the others' complements.

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
- [x] **CAMERA (STREAM) sharing over WebRTC** — `webrtc-share.js` (shareMyStream/
      receiveStream, signalled over the item-scoped folder-handle ephemeral channel,
      STUN for ICE); the camera node now has the 👤 own ⟷ 📡 mine toggle + owner-name tag
      and, in "mine", broadcasts its live MediaStream so everyone who opens the sketch
      sees the owner. Handshake unit-tested (request→offer→answer→ontrack). The owner runs
      getUserMedia; receivers just display the remote stream (no local camera).
- [x] MIC audio STREAM sharing — `makeSourceMount({stream:true})` opt-in: an owner shares
      the mic's `complement.mediaStream` over WebRTC; receivers PLAY it (an <audio>) and get
      an analyser on the outlet complement (so a wired Scope works on the shared audio).
      Value-shares the {rms,peak} levels AND stream-shares the audio.
- [ ] audio-file STREAM sharing (mountAudioFile is a custom mount — give it the toggle too).
- [ ] **LLM real schema→schema** — ask for + validate the OUTLET's Standard Schema
      instead of best-effort text/JSON-ish parsing.
- [x] empty `patchwork-tool`: a tool-id picker field (blank = host default); the view now
      also rebuilds reactively when the wired doc changes (wire-after-place works).
- [ ] **tabs & flaps like Squeak** — edge-docked drawers/tabs (toolbox, params,
      history) pulled in from the screen edges. A workspace-chrome concept.

## Remaining — large / infra (serial, design-heavy)
- [ ] **GENERATIVE "draw-a-world" LLM tool** — an LLM block that writes JS to add
      brushes/shapes/whole mini-worlds ("rabbits and cats I can name/pet/feed"),
      rendered in a frameless sandboxed iframe talking over opstreams. Needs the
      three-as-a-unit below.
- [ ] **sandbox box** — a box that is an IFRAME boundary; tools drawn inside run
      sandboxed. The concrete consumer for `boundary.js`.
- [ ] wire `boundary.js` to a real MessagePort proxy (structured-clone values,
      proxied complement functions, dropped handles).
- [ ] `data-opstream-inlet="<schema>"` — buttons / embedded tools DIRECTLY wireable
      (readPort understands an arktype/TS-style schema string).
- [ ] **build-a-tool in-canvas** ("it should be possible to build") — draft a tool's
      source + preview/run it on the canvas (COW draft overlay + self-bootstrapping
      preview, cf. draftable-toolmaking).
- [x] **brush-API refactor** — DONE (see "Brush API" above): `use(canvas)` contract,
      `paramsSchema`-generated panels, the `layout` opstream bridge, and ALL tools pulled
      out of tool.jsx into brush modules (pen/shape/text/eraser/wire/place). Remaining tail:
      chrome reads the `context` instead of prop-drilling; context-ports-as-inlets.
- [ ] **layouts** — a `sketchy:layout` plugin type + `Layout` contract (canvas becomes
      one registration); folder references multiple complement docs
      (`@layouts:{canvas,dock,list}`); a layout switcher in the chrome; dock/tiling
      layouts; each layout surfacing the others' complements.
- [ ] chrome (palette/zoom/eye/minimap/params/outlets) as MOVABLE items stored in the
      top-layer doc.
- [ ] context ports on the top-level sketchy rendered as INLETS along the top edge.
- [ ] `@patchwork/handoff` so `find`-able urls are also importable; `api.find` accepts
      a subdoc path encoded in the url.
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
projection bridge. Wire brush: ports as nubs, bounds-math endpoints, persistent +
selectable wires, schema matching (incl. bang→bang by declared type), drag-from-inlet,
splat whole-doc inlet, world-anchored add/drop popups (Kobalte Popover), **click-a-port
schema popover**. Mount-once reactive inlets (stable proxies; **no remount on edit**).
Nodes/sources/lenses: codemirror (+ working language inlet), file, automerge (+ new),
raw value, bang, timer, counter, sample, RAF, mic, camera (ImageData/MediaStream),
video, image, **pixels (float32)**, scope, audio-file, speaker, inspector, json-path,
json-set (`.`=whole doc), **template-doc-as-real-dochandle**, **LLM** (transform/source,
`{{var}}` inlets, `@out` dynamic outlets + `think`, λ code with a bidi `code` outlet,
bidi reverse, ⚙ model picker), JS box, HTML box, **Math / Range map / Split-Join / Map-list**.
Binary-safe value handling (no freeze on camera frames). `<Suspense>` on doc embeds.
Layouts: canvas + list + grid. **Sketchpad** tool (pencil-only, no minimap). Top-layer
user-state doc, floating inspectors, follow mode, presence/peer outlets, voice notes.
Brush-API refactor: every tool a `use(canvas)` brush through one host; params are real
schemas (`paramsSchema`) for brushes AND nodes; the layout is a real opstream; a
`patchwork:component` + layered per-sketch layout. Tests: 1012.
