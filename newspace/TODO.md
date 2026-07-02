# Sketchy — TODO

Open work, one flat list. A done item is **deleted** (git history is the
archive). Design rationale: [ARCHITECTURE.md](./ARCHITECTURE.md) · wiring:
[NODES.md](./NODES.md) · layouts: [LAYOUTS.md](./LAYOUTS.md).

- [ ] **MAP node (Leaflet)** — in progress (map-node.js mid-rework): drawing
      lands in the map's GEO coordinate space (strokes and shapes stored as
      lat/lng, reprojected so marks stay on the ground as you pan/zoom).
      Details provisional until it settles.
- [ ] **chrome reads the `context`** instead of ~15 props (the remaining
      brush-API tail; the tools themselves are already out of tool.jsx).
- [ ] context ports rendered as top-edge INLETS (an inspect mode) — on nodes
      and on the top-level sketchy.
- [ ] chrome parts as SLOTS a wrapping tool can replace (not just toggle) — and
      `opts.tools` (an explicit tool subset) in the Toolbar.
- [ ] the rest of the chrome (palette/properties/eye/outlets) as movable
      overlay-layer items (minimap + zoom already are).
- [ ] register the parts flap in index.jsx; offer toolbar/params as flap
      registrations (the container + slots exist — a thin wrapper that renders
      Toolbar/Properties into a flap body).
- [ ] folder references MULTIPLE complement docs (`@layouts:{canvas,dock,list}`)
      not just `.sketch` — generalise `ensureLayout` →
      `ensureLayoutDoc(repo, fh, key)` + migrate.
- [ ] a clean layout switcher in the CANVAS chrome (NOT the old floating
      buttons). list + grid already have one: `layoutsFor` re-opens the folder
      through another lens.
- [ ] dock / tiling layouts — and dock (and the canvas) surfacing the other
      layouts' complements the way list/grid already surface the canvas's.
- [ ] **ROUGH inlet/outlet nubs** — the wires are rough.js; the nubs are still
      CSS circles/diamonds.
- [ ] port-error halo on the nub itself (erroring wires already draw red).
- [ ] param-inlet-wins-when-wired in the properties popup.
- [ ] raw-value inlets editable inline in the properties popup (not just on the
      node).
- [ ] pin a wire to `heads` = read-only (an explicit gesture/affordance).
- [ ] wire ARROWS orientation/sizing polish (still "not quite right").
- [ ] recase (upper/lower) uses index-aligned diff; a real diff would handle
      mid-string insert/delete.
- [ ] **lensN SKIP sentinel** — "don't write this source" on a fan-in (Combine
      covers the read side; `unproject` → `undefined` already half-does the
      write side).
- [ ] more lenses (map-over-list variants); more tests / integration.
- [ ] structured source schemas (the running schema workflow);
      inherit-inlet-schema on pass-through transforms.
- [ ] voice brush params (it's a click-to-place behaviour brush — stroke
      params N/A).
- [ ] audio-file STREAM sharing (mountAudioFile is a custom mount — give it the
      own/mine toggle too).
- [ ] **LLM real schema→schema** — ask for + validate the OUTLET's Standard
      Schema instead of best-effort text/JSON-ish parsing.
- [ ] **GENERATIVE "draw-a-world" LLM tool** — an LLM block that writes JS to
      add brushes/shapes/whole mini-worlds ("rabbits and cats I can
      name/pet/feed"), rendered in a frameless sandboxed iframe talking over
      opstreams. Needs the sandbox box + complement capabilities below.
- [ ] **sandbox box** — a box that is an IFRAME boundary; tools drawn inside
      run sandboxed. The concrete consumer for `boundary.js`.
- [ ] complement CAPABILITIES over the port — `boundary.js`'s
      serializeComplement/hydrateComplement (proxied functions, dropped
      handles) isn't wired into port-opstream yet: values/ops cross,
      capability functions don't.
- [ ] `data-opstream-inlet="<schema>"` — buttons / embedded tools DIRECTLY
      wireable (readPort understands an arktype/TS-style schema string).
- [ ] **build-a-tool in-canvas** — draft a tool's source + preview/run it on
      the canvas (COW draft overlay + self-bootstrapping preview, cf.
      draftable-toolmaking).
- [ ] `@patchwork/handoff` so `find`-able urls are also importable; `api.find`
      accepts a subdoc path encoded in the url (protocols.js — the
      url→opstream registry behind `api.find` — is the base).
- [ ] port lb reflection (acorn AST → JSDoc/signature/registration site) behind
      `api.describe` (basic describe already exists).
- [ ] cosmetic: rename internals (`listEditors`/`EditorItem`/`editor-item.jsx`
      → surface*).
- [ ] delete `NewspaceTool` (tool.jsx) — unregistered since 24d81514 flipped
      `sketchy` to the thin SketchyTool (plan-3 Phase 6, noted 2026-07-02).
- [ ] browser re-test: wire SELECTION (click a wire to select, ⌫ to delete) —
      should work now the box-remount churn is gone.
- [ ] browser re-test: the PROPERTIES panel — intact but contextual (shows on
      selection / a draw or brush tool; hidden while only wiring). Confirm it
      appears as expected.
