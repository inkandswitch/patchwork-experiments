# newspace performance plan

A staged plan to address the 30 perf problems in the review. Each phase is
independent, in priority order, and small enough to land + measure before moving
on. PR boundaries are suggested.

The ordering criterion: **largest CPU / GC / layout-flush win per change**, and
ideally no API surface change. Higher phases are also correct, just lower
leverage.

## Conventions

- **BUDGETS** — every phase lists observable budgets to keep it honest.
- **MEASUREMENT** — the project has no perf infra. The first phase adds the
  minimum (a frame-time counter + a small set of perf hooks); everything after
  references it.
- **RISKS** — each phase notes whether it touches the public API, the
  reactive dep graph, or the doc model. Migrations of `nodeStreams` from a
  store to a Map are non-trivial because the current code subscribes to
  `nodeStreams[id]` from a memo.
- **TEST IMPACT** — the canvas has 80+ unit tests. The high-priority phases
  are all in the rendering / gesture path, which is browser-only and currently
  exercised only by hand. We will keep the changes mechanical and small, and
  rely on existing tests for the model/lenses/opstreams parts.

---

## Phase 0 — perf measurement scaffolding

**Goal:** make every later phase measurable.

**Add** (a small, dedicated file `src/perf.js` plus CSS-hidden DOM hooks):

- A `now()` helper wrapping `performance.now()` so it's a one-line swap.
- An in-page **frame time overlay** (a small `requestAnimationFrame` loop
  emitting rolling avg/min/max into a `<div>` under `.ns-debug-badge`,
  toggled by a `?` key — same channel as the existing `debug` `Show when`).
- A **gesture counter**: `perf.count(name, n)` increments a counter exposed
  on `window.__perf` for the in-page overlay to read.
- A **doc-mutation counter**: wrap `handle.change` calls in the gesture
  paths (startMove, startGroupRotate, startResizeSel, etc.) to count
  `handle.change` invocations per pointermove burst.
- A **rAF-debounce helper** `rafBatch(fn)` used by later phases (defined
  here so all phases share it).

**Budgets established (baseline after phase 0):**

- Drag a 50-item selection: `<X> handle.change calls per second`. (Record X
  in a `perf-baseline.md`.)
- Pan with 10 wires: `<Y> layout flushes per second` (count `getBoundingClientRect` calls).

**Why first:** every later phase claims a win; without this we can't verify
it. Also makes the rAF helper available so phase 1 doesn't have to define
its own.

**Files:** new `src/perf.js`. Tiny edits to `canvas.jsx` to add the key
handler and the `handle.change` wrappers.

---

## Phase 1 — coalesce doc writes during gestures  *(Problem #8)*

**Goal:** drop the dominant CPU cost — 60–1000Hz automerge `handle.change`
calls during drag/resize/rotate, each fanning out to every reactive reader
of `rootItems()`.

**Change:**

- Add `rafBatch(fn)` in `src/perf.js`: queues `fn` for the next animation
  frame; coalesces multiple calls into one. Returns a "run-now" function.
- In each gesture (`startMove`, `startGroupResize`, `startGroupRotate`,
  `startResizeSel`, `startRotate`, `startSegEnd`, `trackCursor` writes to
  `context.pointer`), introduce a per-gesture `pending` flag and a rAF
  pointer. On `pointermove`, instead of writing the doc immediately, mark
  pending and ensure a rAF is scheduled; in the rAF, run the same write that
  was being run per-event.
- On `pointerup`, flush any pending rAF synchronously before doing
  `endTxn` so the gesture ends with the doc fully up to date.

**Why this is safe:** the gesture is one user action. The doc still
records every *cumulative* state correctly — only the *intermediate*
frequencies change. The Solid subscribers (selection outlines, the
`<For>`, `worldBounds`, `context.rects`, `nodeStream`, shape-stream sync)
still see the latest state, just 1× per frame instead of 1× per pointer
event.

**Keyed sensitivity:** `brush` moves (the pencil) already don't write to
the doc per event — they go through the brush host's `preview` / `commit`
separation. Only the move/resize/rotate/segEnd gestures need this.

**Budget:** ≤ 60 `handle.change` calls per second during any gesture,
regardless of pointer-event rate. (A 240Hz mouse is 240 events/sec
today; we cap at 60Hz writes.)

**Files:** `src/brush/canvas.jsx` (gesture handlers), `src/perf.js`.

**PR boundary:** yes — single coherent change, easy to review + measure.

---

## Phase 2 — single `itemsByLayer` memo + id→index Map  *(Problems #2, #13)*

**Goal:** centralize item lookup so every reactive read of `rootItems()`
gets O(1) per-item access and a single sorted-by-layer array per render.

**Change:**

- In `Canvas()`, add a single memo:
  ```js
  const itemsByLayer = createMemo(() => {
    const items = rootItems();
    const idx = new Map();
    const layers = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      idx.set(it.id, i);
      const k = itemLayer(it);
      let arr = layers.get(k);
      if (!arr) { arr = []; layers.set(k, arr); }
      arr.push(it);
    }
    for (const arr of layers.values()) {
      arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    return { byLayer: layers, indexById: idx };
  });
  ```
- Replace the two `<For each={sortById(rootItems().filter((it) => itemLayer(it) === ...))}>`
  blocks (canvas.jsx ~2562 and ~2704) with
  `<For each={itemsByLayer().byLayer.get(layer.id) || EMPTY}>` where
  `EMPTY` is a module-level frozen `const EMPTY = []`.
- Replace per-render `items.findIndex(x => x.id === it.id)` in
  `item.jsx` (the `z` memo) with a lookup against the `indexById` map
  passed in via the `ctx` object. Same for the per-id `find`s in
  `model.js` (`surfaceOf`, `bindAtWorld`, `mapUnder`, `dropOntoMap`,
  `moveDropTarget`, `maybeReparent`, etc.) where the surface is known —
  pass the index map down via `ctx` (or accept a small helper
  `findById(items, id, indexMap)`).

**Why this is safe:** the rendered DOM nodes are stable (id-keyed) in both
old and new code. The memo is dep-equivalent to `rootItems()` (and
`itemLayer` is a pure function of an item, so it's already a transitive
dep). The `<For>` still gets the same per-layer array; the difference is
the array is reused if the contents are unchanged (memos cache by
identity) and the filter+sort runs once, not per layer.

**Risk:** the `indexById` map is per-render; if a caller holds the
reference past a render tick, it's stale. Document that and pass it
through the existing `ctx` argument.

**Budget:** zero `find`/`findIndex` calls in the hot path. Zero
`sortById` allocations per render. `itemsByLayer().byLayer.get(layer.id) || EMPTY`
costs O(1) per layer.

**Files:** `src/brush/canvas.jsx`, `src/brush/items/item.jsx`,
`src/model.js` (introduce `findById`, keep `find` as fallback).

---

## Phase 3 — cached viewport rect + port index  *(Problems #1, #29)*

**Goal:** kill per-frame layout flushes from `getBoundingClientRect` and
the O(N) DOM query for `domPortPos`.

**Change:**

- Add a per-frame cached rect:
  ```js
  let _rect, _rectFrame = 0;
  function viewportRect() {
    if (_rectFrame !== perf.frame()) {
      _rect = viewportRef.getBoundingClientRect();
      _rectFrame = perf.frame();
    }
    return _rect;
  }
  ```
  Expose `perf.frame()` (a counter that increments once per rAF).
- Replace every `viewportRef.getBoundingClientRect()` call in
  `canvas.jsx` and `presence.jsx` with `viewportRect()`:
  - `toWorld` (line ~427)
  - `myViewRect` (~1835)
  - `centerOn` (~2305)
  - `fitCameraTo` (~2312)
  - `localXY` (~978)
  - `clientToLocal` (~1741)
  - `dropToExternal` callers
- Build a port index in `canvas.jsx`:
  - `const portIndex = new Map(); // key = `${url}|${pathJSON}` → el`
  - Subscribe to DOM changes for `[data-automerge-path]` via a single
    `MutationObserver` on `viewportRef`, refresh the index incrementally.
  - `domPortPos(url, path)` becomes a single `Map.get` + a single
    `getBoundingClientRect` (which still costs layout but is bounded).
- Same for `ctxPortPos`: cache the `data-sketchy-port` element on the
  inspect strip; read its rect via the cached viewport rect.

**Why this is safe:** the viewport rect is stable for the duration of a
frame; reads inside the same frame are equivalent. The port index is only
read by `domPortPos`, which is called from `geomFor` per wire per frame;
a stale index can only delay a wire endpoint by one frame (acceptable),
and the MutationObserver fires on the next macrotask.

**Risk:** if a new port is added during a frame and queried in the same
frame, the index misses it. The MutationObserver doesn't fire synchronously
in all browsers, so add a "force refresh" call when a port-bearing
element mounts. Wire the observer in `onMount` of `Canvas`, scoped to
`viewportRef` (not `document`) so it doesn't observe everything.

**Budget:** ≤ 1 `getBoundingClientRect` call per frame on the
viewport itself. Zero `querySelectorAll("[data-automerge-path]")` calls
per frame.

**Files:** `src/brush/canvas.jsx`, `src/brush/ui/presence.jsx`,
`src/perf.js` (frame counter).

---

## Phase 4 — coalesce high-frequency `Source` writes  *(Problems #9, #18, #25)*

**Goal:** use the existing `coalesce(source, { ms: 16 })` helper from
`opstreams` to batch the per-pointermove, per-presence, per-doc-change
writes that fan out to many subscribers.

**Change:**

- Wrap `context.pointer` with a coalesce: writes from `trackCursor` go
  to a coalesced mirror that pushes to the real Source once per rAF.
- Same for `context.rects` (the per-item bounds effect, line ~1890).
- Same for `context.peers` (line ~1886) — driven by the 1Hz heartbeat
  *and* the per-message `setPeers` writes; coalesce to 16ms.
- Same for `context.view` (line ~1887) — already only fires on cam
  changes, but those can fire 60Hz during a pan, so coalesce anyway.
- Same for `myCursor` (line ~1820) — only a few consumers, but cheap
  to coalesce.

**Why this is safe:** coalesce is a drop-in for any Source consumer. The
opstream library's `coalesce` (line 360 in `libraries/opstreams/opstreams.js`)
already implements the trailing-debounce-with-leading semantics. We're
not changing values, only the *frequency* of the writes. A 16ms trailing
edge is imperceptible to the user (a single frame at 60Hz).

**Risk:** the wiring consumers (the minimap, the LLM magnifier, the
sharing UI) see at most one update per frame. This is what they want;
they were getting 60Hz updates today that they couldn't render anyway.

**Budget:** ≤ 60 `Source.push` calls per second per coalesced source,
regardless of upstream event rate.

**Files:** `src/brush/canvas.jsx`, `src/perf.js` (or import
`coalesce` from `opstreams`).

---

## Phase 5 — selection-outlines / bounds memos  *(Problems #3, #4)*

**Goal:** make the per-gesture recomputation of selection bounding boxes
O(selected) instead of O(items).

**Change:**

- In `canvas.jsx`, the memos that read `rootItems()` for selection
  purposes (`selItemOutlines`, `selWorldBounds`, `groupOutline`,
  `arrowHoverBox`) — re-derive them against the new `itemsByLayer.indexById`
  from phase 2.
- Add a separate `selectionBounds` store (plain object) that the
  gesture handlers update directly during a resize/rotate/move, instead
  of relying on `selWorldBounds()` to recompute from the doc. The
  store is what `<Handles>` reads. On `pointerup`, the store resets to
  null and the doc-driven memos take over.
- For `worldBounds` and `context.rects`: build a per-item bounds cache
  (a `Map<id, {x,y,w,h}>`) inside the same memo as `itemsByLayer`. Invalidate
  on item shape change (rare; equivalent to the current `rootItems`
  dep).

**Why this is safe:** the selection outline is purely derived from the
selected items' current positions. Updating it from a direct store during
a gesture is the same data path; the doc is still the source of truth
for the next memo run. After `pointerup`, the store clears and the
doc-driven memos pick up.

**Risk:** the `selectionBounds` store must be cleared on selection
change, item change, and gesture end. A `createEffect` tracking
`selected()` and `editingId()` does the cleanup.

**Budget:** selection outline cost is O(selected) per frame, not O(items).

**Files:** `src/brush/canvas.jsx`.

---

## Phase 6 — `nodeStreams` from store to Map  *(Problem #30)*

**Goal:** remove the per-call `createStore` proxy read in `nodeStream(id, outlet)`.

**Change:**

- In `canvas.jsx`, replace:
  ```js
  const [nodeStreams, setNodeStreams] = createStore({});
  const registerOutlets = (id, outlets) => setNodeStreams(id, outlets || {});
  const unregisterOutlets = (id) => setNodeStreams(id, undefined);
  ```
  with:
  ```js
  const nodeStreams = new Map();
  const registerOutlets = (id, outlets) => nodeStreams.set(id, outlets || {});
  const unregisterOutlets = (id) => nodeStreams.delete(id);
  ```
- Update the one consumer that subscribed to the store (the `wireSpecs`
  memo's `nodeStream` call) to not rely on Solid tracking. Since
  `wireSpecs` is a memo that re-derives on `rootItems()` change, and
  node outlets change as a side effect of mounts/unmounts that ALSO
  change `rootItems()`, the read tracking is redundant — a manual
  bump signal can be added if needed.

**Why this is safe:** the existing code re-registers outlets on mount
and unregisters on unmount (the `editor-item.jsx` `mount()` function).
A mount/unmount changes the `items` array, which invalidates
`wireSpecs` anyway. The store was adding overhead without adding
correctness.

**Risk:** if a future change reads `nodeStreams` reactively from a memo
that doesn't read `rootItems()`, it'd need a manual invalidation
signal. Document this in the file.

**Budget:** O(1) `Map.get` per `nodeStream` call. No proxy reads.

**Files:** `src/brush/canvas.jsx`, `src/brush/items/editor-item.jsx`
(the `registerOutlets` / `unregisterOutlets` callsite).

---

## Phase 7 — per-item `shapeProps` and `shapeRenderProps` memoization  *(Problem #7, partial #20)*

**Goal:** stop allocating new `{}` copies of every shape on every reactive
flush, and stop calling `resolveColor`/`getComputedStyle` per shape per
flush.

**Change:**

- Add a per-item memo in `item.jsx`:
  ```js
  const renderProps = createMemo(() => shapeRenderProps(renderIt(), ctx.resolveColor));
  ```
  The memo only re-fires when `renderIt()` changes OR when
  `ctx.resolveColor` actually returns a new value for the item's color.
- For `resolveColor`, cache results in a `Map<string, string>` keyed by
  the input CSS string; invalidate on theme change (driven by the
  existing `themeTick` signal).
- Move the `staticEl.offsetWidth` / `offsetHeight` reads in the text
  auto-resize effect to a rAF batched callback so they don't fire on
  every doc change.

**Why this is safe:** `shapeRenderProps` is pure on its inputs; memoizing
it is free correctness. The `resolveColor` cache is keyed by the input
string, which only changes when the theme changes (rare).

**Risk:** theme change invalidation must clear the cache. The existing
`themeTick` signal already fires on theme change; the cache reads it
in its memo.

**Budget:** zero new allocations per render for shape rendering, except
on theme change or item-shape change. One `getComputedStyle` call per
unique color per theme.

**Files:** `src/brush/items/item.jsx`, `src/brush/canvas.jsx`
(`resolveColor` cache).

---

## Phase 8 — peer presence heartbeat + Map churn  *(Problem #6)*

**Goal:** stop allocating a new `Map` and fanning out an update every
second when nothing has changed.

**Change:**

- In `canvas.jsx`, the heartbeat already returns the same `peers` Map
  ref via `setPeers((p) => { ...; return p; })`. Keep the `{ equals: false }`
  on `peers` (so `onPresence` updates fan out), but for the heartbeat
  do a structural check: only re-set if any peer crossed the 5s
  threshold.
- For the per-presence-tick consumers (`worldBounds`,
  `context.peers.push([...peers().values()])`), the coalesce in phase 4
  covers it.

**Files:** `src/brush/canvas.jsx`.

---

## Phase 9 — wire `geomFor` and per-spec memoization  *(Problem #24, partial #1)*

**Goal:** pre-compute per-wire math once per change to `rootItems` or
`cam` rather than recomputing on every reactive read.

**Change:**

- Replace the function-form `<For each={visibleWires()}>` row body with
  a `createMemo` for `dx` and `dy` (currently `() => g().to.x - g().from.x`):
  ```js
  const dx = createMemo(() => g().to.x - g().from.x);
  const dy = createMemo(() => g().to.y - g().from.y);
  ```
- Pre-compute the `seed` for the rough-link cache via a memo
  (`createMemo(() => seedFromId(spec.key))`).
- Cache the `nodePortScreen` and `portPoint` calls in `geomFor` via a
  per-spec memo; the input that changes is `cam()` (already memoized
  via `g()`) and the items' `x/y/w/h/rotation`. The latter is read
  via `rootItems().find`; replace with `indexById` from phase 2.

**Files:** `src/brush/canvas.jsx`.

---

## Phase 10 — editor-item descriptor / inlet memoization  *(Problems #22, #23, #12)*

**Goal:** stop calling `listEditors()` and `listLensDescriptors()` on
every reactive read in the editor-item JSX.

**Change:**

- Hoist `listEditors()` and `listLensDescriptors()` to module-level
  memos in `editors.js` / `lenses.js` (they're backed by `getRegistry`
  which is stable for the session). Wrap in a `createMemo` with no deps
  so they only run once.
- In `editor-item.jsx`, memoize the inlet/outlet def calls:
  ```js
  const inletDefs = createMemo(() => inletDefsFor(descriptor(), it()));
  const outletDefs = createMemo(() => outletDefsFor(descriptor(), it()));
  ```
  Replace the function-form `const inletDefs = () => …` callsites.
- The `mount()` effect already uses `untrack` correctly. Inside the
  per-mount effect that re-runs on `inletDefs`, switch from
  re-evaluating the whole loop to a per-def diff: only call
  `setBacking` / `setDir` on inlets whose wiring actually changed since
  the last run.

**Why this is safe:** the registry returns the same array reference for
the session; memoizing `listEditors()` is just caching. The per-def
diff avoids the bookkeeping work but yields the same end state.

**Risk:** the per-def diff needs a stable key (inlet name) and a
captured "last plan" per name. Tracked in a `Map<string, plan>` outside
the effect body.

**Files:** `src/editors.js`, `src/lenses.js`, `src/brush/items/editor-item.jsx`.

---

## Phase 11 — gesture listener cleanup & rAF-throttled move  *(Problems #14, #16)*

**Goal:** prevent leaked `window` listeners if a pointer-up is missed,
and reduce per-pointermove work by rAF-throttling the move handler.

**Change:**

- Wrap the inline `window.addEventListener("pointermove", move)` /
  `"pointerup", up` pattern (in `startResizeSel`, `startGroupResize`,
  `startGroupRotate`, `startRotate`, `startSegEnd`, `FloatInspector.startDrag`,
  `startPan`) in a shared helper that registers the listeners AND
  records a cleanup function in a Solid owner, so `onCleanup` removes
  them automatically.
- The main `onPointerMove` is already a single registration via
  `beginGesture`; rAF-throttle it: keep the last `e` in a ref, schedule
  one rAF, and process on the rAF.
- The `trackCursor` path (pointer tracking, separate from gestures) is
  throttled by phase 4's coalesce.

**Files:** `src/brush/canvas.jsx`, `src/brush/items/editor-item.jsx`
(if any inline gesture), `src/brush/ui/presence.jsx` (peer cursor
tracking).

---

## Phase 12 — chrome / presence row optimizations  *(Problem #27)*

**Goal:** stop allocating inline closures per row per render in
`presence.jsx` and chrome components.

**Change:**

- In `presence.jsx`, extract the inline `sx` / `sy` computations to
  top-level helpers that take `(p, cam)` and return the position, or
  bind them as `createMemo` on the row's props.
- Same for chrome `Toolbar` / `Properties` / `LayoutCustomizer` if
  they have similar patterns (audit during implementation).

**Files:** `src/brush/ui/presence.jsx`, `src/brush/ui/chrome.jsx` (audit).

---

## Phase 13 — minor memos and string-join checks  *(Problems #5, #23, #26, #28)*

**Goal:** small fixes that fall out of the larger changes.

**Change:**

- `wireSpecs` sig: replace `.map().join("|")` with a rolling 32-bit hash
  over the same content (avoids string allocation in the hot path).
- `palette` in `onKeyDown`: move to a module-level constant; rebuild only
  when `extraShape()` changes (which is rare; the current per-keypress
  allocation is 10 elements but is a stylistic issue, not a perf one).
- `inletDefs` / `outletDefs` in `editor-item.jsx` — already in phase 10.
- `dx`/`dy` `() =>` accessors → memos (already in phase 9).

**Files:** `src/brush/canvas.jsx`.

---

## Out of scope for plan 1

Listed for context, not for this plan:

- **A full Solid `createStore` audit.** There are other stores
  (`wireErrors`, `wirePulse`, `wireOps`, the brush store) that may benefit
  from similar treatment. Address in a follow-up after measuring.
- **A reactive UI profiler integration** (e.g. solid-devtools) for
  end-to-end dep-graph inspection. The phase 0 overlay is the minimum
  viable measurement; the rest is dev-only.
- **Solid `<For>` row memoization patterns** in
  `editor-item.jsx` / `sketch-item.jsx` / `voice-item.jsx`. Each has its
  own perf shape; audit individually when those tools are used heavily.
- **Opstream library internal perf** (`opstream.js`'s `apply` /
  `rebaseOp`). The library has its own tests; perf work there is a
  separate concern.
- **The `webrtc-share` code path** — that file was deleted in the
  in-flight work; the new `share-session.js` is reviewed but the
  in-page presence flow needs end-to-end perf measurement under load
  (multi-peer shared session) which is hard to simulate in unit tests.

---

## Sequencing

The phases are independent enough to land in order, but a sensible PR
grouping is:

| PR | Phases | Why grouped |
|---|---|---|
| 1 | Phase 0 (perf scaffolding) | establishes measurement |
| 2 | Phases 1 + 11 (gesture rAF + cleanup) | both touch the gesture hot path |
| 3 | Phase 2 (itemsByLayer) | touches `item.jsx`, `canvas.jsx`, `model.js` |
| 4 | Phase 3 (cached rect + port index) | touches `canvas.jsx`, `presence.jsx` |
| 5 | Phases 4 + 8 (coalesce + presence heartbeat) | both about write frequency |
| 6 | Phase 5 (selection bounds) | touches the gesture + selection path |
| 7 | Phase 6 (nodeStreams Map) | small mechanical change |
| 8 | Phase 7 (shape memo + resolveColor cache) | touches `item.jsx` |
| 9 | Phases 9 + 13 (wire geom + minor) | wire rendering polish |
| 10 | Phase 10 (editor-item memos) | touches editor + lenses |
| 11 | Phase 12 (chrome) | chrome polish |

After PR 1, every other PR can be measured against the perf overlay.
