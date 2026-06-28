# Sketchy / Littlebook4 — TODO

Working list alongside [LITTLEBOOK4.md](./LITTLEBOOK4.md) (the design rationale).
Status: `[ ]` todo · `[~]` in progress · `[x]` done. Keep this current.

## Latest pass (outlets, floats, form-drag)
- [x] outlet chips: fixed the full-width stretch (align-items:flex-end + width:max-content);
      in-use outlets STAY visible after the wire tool is off (pink border).
- [x] `list` → `sketchy:list`, unlisted; layout descriptor points at it.
- [x] FORM-DRAG via COMPOSED custom events (`sketchy:wire-from`/`-move`/`-drop`) — the
      grip owns the drag and announces it; bubbles out of shadow boundaries to the
      canvas (more robust than catching the raw pointerdown across the embed). NOTE:
      composed events cross shadow but NOT iframe — if it STILL fails, the embed is an
      iframe and we need postMessage.
- [x] USER-STATE FLOATING INSPECTORS (the "curiosity"): wiring a context/peer outlet
      now makes a LOCAL floating panel on the top overlay layer (per-viewer, persisted
      to localStorage, NOT the shared doc), draggable + closable, showing the live
      source. Doc fields still place a shared editor item. Outlet→float wires drawn.

## Built while you slept (2026-06-28)
- [x] FOLLOW MODE: click a peer's name in the view overlay (now with an avatar) →
      your camera tracks theirs (`fitCameraTo` on each presence update); manual
      pan/zoom/wheel exits. (`following` signal; PresenceLayer onFollow.)
- [x] VOICE: fixed the disappearing-transcript race + redesigned — play/stop button
      + status header, transcript below rendered like text-tool text, editable in
      place, always-present (no swap race). (voice-item.jsx, voice.js CSS.)
- [x] CONTEXT PORTS + INSPECTOR: with the wire tool, the canvas's context shows as
      outlet chips along the bottom (camera/pointer/tool/brush/selection); drag e.g.
      `pointer` → places a live Inspector editor → mouse-pos inspector. New generic
      `inspector` sketchy:editor; `readPort`/`portWiring` generalized to context vs
      automerge ports; editor inlets persist `{context}` or `{url,path}`.
- [x] WIRE CHOOSER: dropping a wire that matches >1 editor shows a small chooser.
- [x] OUTLETS restyled: moved to the right edge, vertical, plain dark rectangles.
- [x] PERSISTENT WIRES: every wired editor draws a curved wire back to its source
      port (context outlet / form field / peer box), visible whether or not the wire
      tool is active; click a wire to delete it (`unwire`). (`wires` memo in canvas.)
- [x] PEER OUTLETS: a peer's view box now has `cursor`/`view` outlet ports on its
      right (with the wire tool). Wire one → an Inspector showing that peer's live
      state. `peer` port kind through readPort/portWiring/finishWire; `ctx.peerStream`
      (one effect keeps a Source per contactUrl×part fresh from presence).
- [x] MODULARITY: `tool.jsx` → **10-line entry**; the canvas is `brush/canvas.jsx`.
      New pure tested modules `brush/camera.js` (viewRect/fitRect/centerCam/zoomAt/
      contentBounds) and `model.js` `itemsInRect`. Flaky async tests hardened.
- [x] PRESENCE-AS-OPSTREAMS (partial): peers now broadcast `selection` + `tool` too;
      `ctx.peerStream(contactUrl, part)` turns any peer part into a live Source — so a
      peer outlet wires into an Inspector as a consumable opstream.
- [x] `api.describe(x)` — introspect a registered plugin id / function / opstream /
      descriptor (emacs-help-ish, from devtools). On `element.api`.
- [x] LAYOUTS answer written to `LAYOUTS.md` (folder = doc, layout = lens-with-
      complement; yes to dockview-as-root, layout-switching, simultaneous canvas/list,
      and surfacing the unused complement).
- [x] LIST layout (`list-tool.jsx`, `patchwork:tool "list"`) — the second layout:
      renders a folder's docs as rows (each a wireable port) and SURFACES the canvas
      complement ("N positioned docs / M items not shown here"). Proves same-docs/
      different-lens + complement-visibility. 3 tests.
- 169 tests, build clean, stable across runs.

## layouts — to reach the full vision (see LAYOUTS.md)
- [ ] a `patchwork:layout` (or `sketchy:layout`) plugin type + the `Layout` contract;
      canvas becomes one registration among several.
- [ ] folder references MULTIPLE complement docs (`@layouts:{canvas,dock,list}`) not
      just `newspace:url`; switching picks one. (migration from `newspace:`)
- [ ] a layout switcher in the chrome.
- [ ] dock / tiling layouts.
- [ ] each layout surfacing the OTHER layouts' complements (generalise the list banner).

## Bugs
- [x] BENT arrow into a box bends differently — FIXED. The move-between-docs path
      (`maybeReparent`, not `convertToLocal`) translated `clone.x/y` but never
      `clone.cx/cy`, so the control point stayed put. Now it carries cx/cy. (Worth a
      visual confirm; the rotation-delta `dr` case for arrows may still need work if
      you drop a bent arrow into a *rotated* box.)

## Guiding principle
**One way to improve an API is to make it do less.** Prefer absence/feature-detection
over flags (read-only = no `apply`; saveable = presence of `save()`). Keep `find`,
`api`, opstreams minimal.

## Foundation (done)
- [x] opstreams: one op + snapshot, COW `apply`, complement passthrough (functions),
      two lens modes (`map`/recompute), generic `automergeOpstream`, read-only via
      `heads`, `opstreamToSignal`.
- [x] codemirror node (full extension parity, op-bound, complement-driven).
- [x] `sketchy:editor` contract + registry (`editors.js`); codemirror + file editors.
- [x] local files (`fs-opstream.js`, File System Access API, real `save()`).
- [x] form `patchwork:tool` with `data-automerge-*` ports.
- [x] wire-brush brain (`wire.js`): readPort, schema matching, `makeEditorItem`.

## find + protocol handlers + api  (in progress this pass)
- [~] `src/protocols.js` — `createProtocols()` (register/find by scheme); `find(url)
      → opstream`.
- [~] automerge protocol: `automerge:<id>[#path/parts]` → opstream attached to the
      doc (optionally a subdoc/subtree path). First registered handler.
- [~] `src/api.js` — `element.api` devtools surface: `find`, `registerProtocol`,
      `editors`, `repo`. Wire `element.api` in the tool.
- [ ] make protocol handlers answer **`@patchwork/handoff`** so their urls are
      ALSO importable (a fetchable resource), per the bootloader handoff channel
      (`pw/main/core/bootloader`). Bridges `find` and `import`.
- [ ] `api.find` should accept a path for a subdoc handle (encoded in the url).

## tool.jsx decomposition → `brush/`  (in progress, serial)
tool.jsx 2467 → **1448** lines. Build + 151 tests green after each step.
- [x] `brush/constants.js` — pure constants + helpers (colorVar, SIZES, ensureLayout…).
- [x] `brush/items/voice-item.jsx` — `VoiceItem`.
- [x] `brush/items/sketch-item.jsx` — `SketchItem`.
- [x] `brush/items/text-edit.jsx` — `InlineEdit`, `TextEdit`.
- [x] `brush/ui/presence.jsx` — `Face`, `PresenceLayer`, `Minimap`.
- [x] `brush/ui/chrome.jsx` — `Handles`, `Toolbar`/`ToolBtn`/`ToolPicker`/`Icon`,
      `BrushPanel`, `Properties` + `TOOL_META`/`HDIRS` (all the chrome).
- [x] `brush/items/item.jsx` — `Item` (kind-dispatch) + `DocOrFrame` (recursive).
- [x] `brush/items/editor-item.jsx` — `EditorItem` (mounts `mountEditor`).
- [ ] `brush/canvas.jsx` — the `Canvas` core (camera, gestures, history, reconcile,
      doc creation, selection); `tool.jsx` → thin `brush/index.jsx` re-export.
      (the remaining ~1448 lines: the tightly-coupled heart.)
- once modular, feature work can fan out to parallel agents (worktree-isolated).

## voice note UI redesign
- [ ] drop the card chrome: just a play button + status alongside, and the
      transcript UNDER the play button rendered indistinguishably from text-tool
      text (same font/size/color params as a text item).

## headless component (no UI) + context via provide/accept
- [ ] make the sketchy `patchwork:component` a headless **layout**: renders items +
      exposes a `context` (`camera`, `pointer` world-transposed, `pointerScreen`,
      `tool`, `brush`, `selection`); NO toolbar/params/minimap.
- [x] `src/context.js` — `createCanvasContext(element, {fallbacks})` → camera/
      pointer/tool/brush/selection as `Source`s via **provide/accept**
      (`@inkandswitch/patchwork-providers` bundled), **fallback-to-own + provide**
      per selector. 5 tests incl. the cross-view round-trip (nested canvas inherits
      the provider's `tool`). NOT yet wired into Canvas.
- [x] `createCanvasContext` wired into Canvas: `tool` is context-owned; camera /
      pointer / selection / brush are mirrored INTO the context (live for providers /
      nested canvases / the mouse-pos-inspector). Exposed at `element.api.context`.
- [ ] make chrome/brushes READ `context` instead of ~15 props (brush-API refactor).
- [ ] doc = document opstream; interaction context = Source opstreams (snapshot).
- [ ] nesting in a box = same component, `pointer` transposed to its coord space.
- [ ] toolbar / params / minimap become plugins that consume the context.
- [ ] inspect mode/brush: render the context ports as **inlets at the top of the
      screen** (visualize the wiring).
- [ ] **tabs + flaps like Squeak** — edge-docked drawers that slide out from the
      screen edges holding tools/objects, plus tabs. (workspace chrome; separate.)

## brush API, reconsidered  (design in LITTLEBOOK4 §3b)
- [ ] new brush shape: `{ schema?, config?, use(canvas) -> cleanup }`; `use` reads
      the `context` Sources + emits OPS to the `layout` opstream. Replaces the
      `brushCtx` soup + the stroke/behavior fork + the bespoke `params` panel.
- [ ] `gesture(canvas,{down,move,up})` convenience over the pointer Source.
- [ ] params panel GENERATED from the brush's Standard Schema; editing writes the
      `brush` context Source. palette lists `sketchy:brush`s + sets `context.tool`.
- [ ] active brush = `context.tool`; Canvas swaps `use()` on tool change (gesture
      dispatch collapses into the active brush).
- [ ] pull built-in brushes (pen, rectangle, ellipse, line, arrow, eraser, text)
      out of tool.jsx into `sketchy:brush` plugins using the new API.
- [ ] the wire brush is itself a `sketchy:brush`.
- [ ] DEPENDS ON the signal↔opstream bridges (`storeOpstream` — another model is
      writing these in solid-opstream.js). Land those first.

## reflection / describe  (loved in lb)
- [ ] port lb reflection (`lb/graveyard/reflection/{stack,reflection}.js` + acorn):
      AST-parse a registered fn → its JSDoc/docstring + signature + registration
      site (stacktrace). Expose `api.describe(thing)` → structured, emacs-help-like
      info. Needs `acorn`/`acorn-loose` (vendored in lb).

## wire brush — live canvas
- [x] `EditorItem` (`brush/items/editor-item.jsx`) mounts a `sketchy:editor`, inlets
      rebuilt from `{url,path}` via `ctx.api.find`; in the Item dispatch.
- [x] `wire` toolbar tool (+ `w` shortcut) + gesture: grab a `data-automerge-*` PORT
      (before the doc-body return), screen-space wire line, drop → rewire an editor's
      matching inlet, or empty canvas → place a matching editor wired.
- [x] live-by-default wires (`{url,path}`).
- [ ] the 300ms empty-canvas POPUP chooser (currently first-match-immediate).
- [ ] pin a wire to `heads` = read-only (an explicit gesture/affordance).
- [ ] opstream visualization (draw the persisted wires between ports).
- [ ] **context ports on the top-level sketchy** — when the wire tool is active, show
      the canvas's own context as INLETS (top) + OUTLETS (bottom). They're ports
      whose opstream IS `context.<name>` directly (no `api.find`). Generalize
      `readPort` to a `{kind:"context"|"automerge", …}` port and `finishWire` to
      resolve either. Then e.g. drag the bottom `pointer` OUTLET onto the canvas →
      place an inspector editor → a live mouse-pos inspector. (Even onto itself.)
- [ ] a generic INSPECTOR `sketchy:editor` (accepts any/json) to view a wired stream.

## early plugins
- [ ] automerge-url source plugin (get an opstream from an automerge url + subdoc
      path) — overlaps the automerge protocol handler above.

## parallelization
- [ ] once modular, fan out agents per module/feature (worktree isolation for
      parallel file edits). Trigger with an explicit "use a workflow".
