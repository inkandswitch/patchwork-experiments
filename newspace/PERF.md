# Runtime performance optimization — newspace / sketchy

A single, verified, sequenced plan to cut frame time and CPU/GC during the hot
paths (pan, drag, resize, rotate, wiring, live doc change). This **supersedes**
the two earlier perf plans (`optimization-plan-1.md`, `optimization-plan-2.md`,
since deleted) by consolidating them into one ordered roadmap with **line numbers verified
against the current code** (canvas.jsx is 2928 lines as of this plan).
Maintainability/hygiene (`optimization-plan-3.md`) is explicitly out of scope.

Ordering criterion: **largest CPU / GC / layout-flush win per change first**, no
public-API or doc-model change, each phase independently landable + measurable.

## What was verified (current code, not the stale plans)

- `onPointerMove` writes the automerge doc on **every pointer event** for the
  `move` gesture — `gesture.surface.handle.change(...)` at `canvas.jsx:1267`;
  `pan` does `setCam` per event at `:1259`. Resize/rotate/segEnd handlers
  (`startResizeSel:590`, `startGroupResize:687`, `startGroupRotate:718`,
  `startRotate:755`, `startSegEnd:784`) register their own `window`
  pointermove listeners and write per event.
- Two per-render `sortById(rootItems().filter((it) => itemLayer(it) === ...))`
  buckets at `canvas.jsx:2553` and `:2708` — filter + sort every reactive flush.
- Per-render O(N) z-index lookup `findIndex((x) => x.id === it().id)` at
  `item.jsx:43`; parent lookup `.find` at `item.jsx:26`; link lookup at `:195`.
- `shapeRenderProps(renderIt(), ctx.resolveColor)` called inline inside a
  `<For each>` at `item.jsx:116` — recomputed (new object + `resolveColor`
  work) every flush; `shapePaths` rebuilt with it.
- 17 uncached `getBoundingClientRect` calls across `src/brush` (canvas + presence).
- `nodeStreams` is a `createStore({})` at `canvas.jsx:1980`, read with a proxy
  subscribe at `:1984`.
- `context.{bounds,peers,view,rects}` pushed via `createEffect` at
  `canvas.jsx:1903–1908` — fire on every reactive change (60Hz during a pan);
  `context.rects` maps over **all** `rootItems()` each time (`:1908`).
  `trackCursor` does `context.pointer.set(w)` per mousemove (`:1886`).
- `visibleWires` is a plain function (`canvas.jsx:2195`) called **twice** in the
  JSX (`:2619`, `:2621`) — full recompute per read, twice.
- `coalesce(source, { ms })` already exists in the opstreams lib
  (`../libraries/opstreams/opstreams.js:360`) — reuse it, don't reinvent.

All problems the old plans described are still present. Nothing has been done.

---

## Phase 0 — measurement scaffolding (do first, blocks nothing)

**Goal:** make every later phase provably a win. No perf infra exists today.

**Add `src/perf.js`:**
- `now()` wrapping `performance.now()`.
- `frame()` — a counter bumped once per rAF (used by Phase 3's rect cache).
- `count(name, n=1)` — increments a counter on `window.__perf`.
- `rafBatch(fn)` — coalesces calls into one rAF; returns a `flush()` to run
  synchronously (used by Phase 1 on pointerup). Shared by all later phases.
- A frame-time overlay: a rAF loop writing rolling avg/min/max + the
  `__perf` counters into a `<div>`, toggled by a key (reuse the existing debug
  channel). Hidden by default.

**Instrument (temporary counters, removed or gated after each phase lands):**
- wrap the `handle.change` calls in the gesture handlers with `perf.count("docWrite")`.
- `perf.count("gbcr")` at each `getBoundingClientRect` site.
- `perf.count("bucketSort")` in the render buckets.

**Baseline to record** (write to a scratch `perf-baseline.md`, git-ignored):
- Drag a 50-item selection: `docWrite`/sec (expect ~pointer-event rate today).
- Pan with ~10 wires: `gbcr`/sec.

**Files:** new `src/perf.js`; tiny edits in `canvas.jsx` for the toggle + counters.

**Risk:** none (additive).

---

## Phase 1 — coalesce doc writes during gestures  *(biggest win)*

**Goal:** cap automerge `handle.change` at ≤1/frame during drag/resize/rotate
instead of 1/pointer-event (240Hz mice → 240 writes/sec today), each fanning
out to every reactive reader of `rootItems()`.

**Change:** keep raw gesture math imperative; only defer the *doc write*.
- In `onPointerMove` (`canvas.jsx:1256`), for `k === "move"`: store the latest
  `p`/deltas on `gesture` and `rafBatch` the `handle.change` block (`:1267`)
  instead of calling it inline. Same treatment for the per-event writes in
  `startResizeSel`/`startGroupResize`/`startGroupRotate`/`startRotate`/`startSegEnd`.
- `pan` (`:1259`) already only calls `setCam` (no doc write) — leave it, or
  rAF-coalesce the `setCam` too if pan still stutters after Phase 4.
- On `onPointerUp` (`canvas.jsx:1306`), call `rafBatch.flush()` **before**
  `endTxn` so the gesture ends with the doc fully current and the undo diff is
  correct.

**Why safe:** one user gesture = one logical action. Only intermediate write
*frequency* changes; every subscriber still sees the latest state, once per
frame. Brush strokes already avoid per-event doc writes (preview/commit), so
they're untouched.

**Budget:** ≤60 `docWrite`/sec during any gesture regardless of pointer rate.

**Files:** `canvas.jsx`, `perf.js`. **Single PR** — coherent, easy to measure.

---

## Phase 2 — shared item indexes + memoized render buckets

**Goal:** O(1) per-item lookup and one sorted bucket per render, replacing the
per-render `filter`+`sort` and the per-item `findIndex`.

**Change:** add one memo in `Canvas()`:
```js
const EMPTY = Object.freeze([]);
const itemsIndex = createMemo(() => {
  const items = rootItems();
  const indexById = new Map();
  const byLayer = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    indexById.set(it.id, i);
    const k = itemLayer(it);
    let arr = byLayer.get(k); if (!arr) { arr = []; byLayer.set(k, arr); }
    arr.push(it);
  }
  for (const arr of byLayer.values()) arr.sort(byIdAsc);
  return { byLayer, indexById };
});
```
- Replace the two buckets at `canvas.jsx:2553` and `:2708` with
  `<For each={itemsIndex().byLayer.get(layer.id) || EMPTY}>`.
- Pass `indexById` down via the existing `ctx` object. In `item.jsx:43`, replace
  `findIndex` with `ctx.indexById().get(it().id) ?? -1`. Use it for the `.find`
  at `item.jsx:26` (parent) too where the surface is root.
- In `model.js`, add `findById(items, id, indexMap)` and thread the index into
  the hot callers (`surfaceOf`, `moveDropTarget`, `maybeReparent`, …); keep the
  linear `find` as a fallback when no index is passed.

**Why safe:** memo is dep-equivalent to `rootItems()` (`itemLayer` is pure); DOM
nodes stay id-keyed. `indexById` is per-render — document that callers must not
hold it across ticks.

**Budget:** zero `find`/`findIndex`/`sortById` in the hot render path.

**Files:** `canvas.jsx`, `item.jsx`, `model.js`.

---

## Phase 3 — cached viewport rect + port index

**Goal:** kill per-frame layout flushes from the 17 `getBoundingClientRect`
calls and the O(N) DOM query behind `domPortPos`.

**Change:**
- `viewportRect()` helper caching `viewportRef.getBoundingClientRect()` keyed by
  `perf.frame()`; replace every `viewportRef.getBoundingClientRect()` in
  `canvas.jsx` (`toWorld`, `myViewRect`, `centerOn`, `fitCameraTo`, `localXY`,
  `clientToLocal`, drop handlers) and `presence.jsx` with it.
- Port index: a `Map` keyed by `` `${url}|${pathJSON}` `` → element, maintained
  by one `MutationObserver` scoped to `viewportRef` (not `document`), plus a
  force-refresh when a port-bearing element mounts. `domPortPos` becomes one
  `Map.get` + one bounded `getBoundingClientRect`.

**Why safe:** the viewport rect is stable within a frame; a stale port index can
only lag a wire endpoint by one frame.

**Budget:** ≤1 `gbcr` on the viewport per frame; zero
`querySelectorAll("[data-automerge-path]")` per frame.

**Files:** `canvas.jsx`, `presence.jsx`, `perf.js` (`frame()`).

---

## Phase 4 — coalesce high-frequency context Source writes

**Goal:** batch the per-pointermove / per-doc-change / per-presence Source
pushes that fan out to many subscribers.

**Change:** wrap the outlet Sources with the lib's `coalesce(src, { ms: 16 })`:
- `context.pointer` (fed by `trackCursor` `:1886`).
- `context.rects` (`:1908`, maps over all items — also feed it from Phase 2's
  bounds if a per-item bounds cache is added).
- `context.peers` (`:1904`), `context.view` (`:1905`), `context.bounds` (`:1903`).
- `myCursor` / presence broadcast.

**Why safe:** `coalesce` (opstreams:360) is a drop-in for any Source consumer;
16ms trailing edge = one frame, imperceptible. Downstream (minimap, magnifier,
share UI) can't render faster than a frame anyway.

**Budget:** ≤60 `push`/sec per coalesced source regardless of upstream rate.

**Files:** `canvas.jsx`.

---

## Phase 5 — per-item render memoization + resolveColor cache

**Goal:** stop allocating a fresh shape object and re-running
`resolveColor`/`getComputedStyle` per shape on every reactive flush.

**Change:**
- In `item.jsx`, memoize the render props:
  `const renderProps = createMemo(() => shapeRenderProps(renderIt(), ctx.resolveColor));`
  and drive the `<For each>` at `:116` off `renderProps()` / a memoized
  `shapePaths` instead of recomputing inline.
- Cache `resolveColor` results in a `Map<cssString,string>` in `canvas.jsx`,
  invalidated by the existing `themeTick` signal (the `<For>` already reads
  `ctx.themeTick()`).

**Why safe:** `shapeRenderProps` is pure on its inputs; caching is free
correctness. Color cache is keyed by input string, invalidated only on theme
change.

**Budget:** zero new per-render allocations for shape rendering except on
theme/shape change; one `getComputedStyle` per unique color per theme.

**Files:** `item.jsx`, `canvas.jsx`.

---

## Phase 6 — `visibleWires` memo + per-wire geom

**Goal:** stop recomputing all visible-wire geometry twice per render.

**Change:**
- Convert `visibleWires` (`canvas.jsx:2195`) from a function to a `createMemo`
  so the two callsites (`:2619`, `:2621`) share one computation.
- Inside `geomFor`, replace `rootItems().find(...)` port lookups with Phase 2's
  `indexById`; make per-wire `dx`/`dy` and the rough-link `seed` memos rather
  than function accessors re-evaluated in the row body.

**Files:** `canvas.jsx`.

---

## Phase 7 — `nodeStreams` store→Map + cheaper shape-stream equality

**Goal:** remove a proxy read per `nodeStream` call and a deep-equal on the
shape sync path.

**Change:**
- Replace `createStore({})` for `nodeStreams` (`canvas.jsx:1980`) with a plain
  `Map` (`.set`/`.delete`/`.get`). The one reactive consumer (`wireSpecs`)
  already re-derives on `rootItems()` change (mount/unmount mutates items), so
  the store's tracking is redundant; add a manual bump signal only if a future
  reader needs it. Update the `registerOutlets`/`unregisterOutlets` callsite in
  `editor-item.jsx`.
- Replace the `valuesEqual(s.value, props)` deep compare in the shape-stream
  sync with a `shapePropsEqual` that compares `points` by array **identity**
  first and avoids `JSON.stringify` unless identity changed.

**Files:** `canvas.jsx`, `editor-item.jsx`.

---

## Phase 11 — reduce `snapshotItems` cloning per gesture

**Goal:** stop the two full-doc `structuredClone` passes each gesture does.

Today `snapshotItems` (`history.js:27`) `structuredClone`s **every** item into a
Map; it's called at gesture start (`beginTxn`, `canvas.jsx:544`) and end
(`endTxn`, `:545`), and twice in `transact` (before + after). For a doc with big
strokes (thousands of points) that's an O(total-data) allocation + GC spike per
gesture — cheap at 3 items, expensive at 300.

**Change:**
- Add `snapshotItemsFor(items, ids)` in `history.js` that clones **only** the
  ids a gesture actually touches (the gesture already knows its `ids`); the
  before/after diff only needs the touched set plus reorder detection.
- Gestures (`beginTxn`/`endTxn`) pass their `ids`; `transact` (whole-doc atomic
  ops like delete/reorder) keeps the full `snapshotItems`.
- Keep `structuredClone` per-item, but skip it for `stroke.points` when the
  gesture is translate-only (origin bump, points untouched — `canvas.jsx:1287`):
  snapshot the scalar `x/y` origin, not the whole points array.

**Why safe:** the diff command only restores fields the command touched
(`restoreFields`, `history.js:45`); an item not in the gesture's id set can't
change, so cloning it is wasted. Reorder detection stays whole-array (cheap: ids
only, no per-item clone).

**Budget:** gesture start/end clone cost is O(selected · avg-item-size), not
O(all-items-and-their-points).

**Risk:** medium — undo/redo correctness. Covered by `history.test.js`; extend
with a case that drags one of many items and asserts undo restores exactly it.

**Files:** `history.js`, `canvas.jsx`.

---

## Phase 12 — dedupe + cache the per-item bounds pass

**Goal:** compute `itemBounds(projected(it))` over all items **once** per change,
not twice, and not on every camera/presence tick.

Today it's computed in two places that both map over all `rootItems()`:
`worldBounds` (`canvas.jsx:1889`) and the `context.rects` effect (`:1908`).
`worldBounds` also depends on `peers()` and `myViewRect()`, so it re-runs on
every presence tick and every camera move (60Hz during a pan) even though item
bounds didn't change.

**Change:**
- Add one memo `itemRects = createMemo(() => rootItems().map((it) => { const b =
  itemBounds(projected(it)); return { id: it.id, x:b.x, y:b.y, w:b.w, h:b.h,
  box: it.kind === "frame" }; }))` — depends only on `rootItems()` (and the
  camera-independent projection). Fold this into Phase 2's `itemsIndex` memo if
  the bounds map wants to share the single pass.
- `context.rects` pushes `itemRects()` directly (still coalesced by Phase 4).
- Split `worldBounds` so the **item** contribution reads `itemRects()` (memoized)
  and only the **cursor/viewport** contribution re-runs on peers/camera change —
  `contentBounds(itemRects()-derived box, peer cursors, myViewRect())`.

**Why safe:** `itemBounds`/`projected` are pure functions of an item (+ its
layer transform); memoizing the map is caching. Cursor/view still update live.

**Budget:** one O(N) bounds pass per `rootItems()` change; zero bounds passes on
a pan or presence tick (only the cheap cursor/view merge re-runs).

**Files:** `canvas.jsx`.

---

## Phase 13 — rAF-throttle per-event drop-target / escape during move

**Goal:** stop running the surface-scanning drop-target + escape computation on
every pointer event of a move.

`onPointerMove`'s `move` branch runs `setDropTarget(moveDropTarget(...))`
(`canvas.jsx:1298`, scans surfaces) and `setEscapeId(childLeavingBox(...))`
(`:1302`) every event — independent of Phase 1's doc-write coalescing, and each
`set*` triggers reactivity.

**Change:**
- Move the `moveDropTarget`/`childLeavingBox` computation into the same
  `rafBatch` used for the doc write in Phase 1, so it runs ≤1/frame. Keep the
  last pointer position on `gesture`; compute drop-target/escape in the rAF from
  it.
- `pointerup` flush (Phase 1) already resolves the final drop-target before
  `endTxn`, so drop precision is unchanged.

**Why safe:** drop-target/escape are visual affordances (highlight + un-clip
feel); a one-frame lag is imperceptible and the final drop is computed on the
synchronous pointerup flush.

**Budget:** ≤1 `moveDropTarget` call per frame during a move.

**Files:** `canvas.jsx`.

---

## Kept from the superseded plans (amendments, agreed 2026-07-02)

Items plans 1/2 contained that this consolidation dropped, kept by decision:

- **Phase 1 absorbs plan-1 P11's listener cleanup** — the per-gesture
  `window` pointermove/pointerup listeners leak if a pointerup is missed; wrap
  the register-pair in a helper with owner-scoped cleanup while in those
  handlers.
- **Phase 8 (conditional)** — plan-1 P5's selection-bounds store
  (O(selected) outlines during gestures); gate on the overlay showing
  selection outlines still hot after Phases 1+2.
- **Phase 9 (conditional)** — plan-1 P10's editor-item `listEditors`/
  `inletDefs` memoization; same gate.
- **Phase 10 (correctness)** — plan-2 §6 (brush-module loading not reactive)
  and §9 (text auto-measure writes w/h to the doc on the render path,
  polluting undo).
- The async inlet race (plan-2 §4) is correctness, not perf — landed in
  wave A alongside Phase 0.
- Dropped as noise: plan-1 P8 (1Hz heartbeat Map churn), P12 (chrome row
  closures), P13 beyond what Phase 6 absorbs.

## Out of scope

- Maintainability / renames / canvas.jsx split / logger — that's
  `optimization-plan-3.md`; it should ride Phase 0's scaffolding when tackled.
- Bundle size — already code-split into 48 chunks (1.4M; largest is
  lazy-loaded Leaflet `map-node`, 159K). Not an urgent lever; revisit only if a
  measured load-time budget demands it.
- Opstream library internals, share-session multi-peer load — separate concerns
  with their own tests.

## Sequencing & PRs

| PR | Phase | Why |
|---|---|---|
| 1 | 0 | establishes measurement; every later PR references it |
| 2 | 1 | biggest single win; single coherent gesture change |
| 3 | 2 | indexes unlock Phases 5/6; touches canvas + item + model |
| 4 | 3 | cached rect + port index |
| 5 | 4 | coalesce context sources |
| 6 | 5 | per-item render memo + color cache |
| 7 | 6 + 7 | wire memo + nodeStreams Map + shape equality |
| 8 | 11 | snapshotItems clone reduction (rides Phase 1's gesture path) |
| 9 | 12 | bounds pass dedupe + cache (rides Phase 2's index) |
| 10 | 13 | rAF-throttle drop-target/escape (rides Phase 1's rafBatch) |

Phases 11–13 depend on earlier phases (11→1, 12→2, 13→1), so they land after
their prerequisites. After PR 1, gate each subsequent PR on the overlay showing
its budget met.

## Verification

- **Unit tests:** run `pnpm test` (vitest) after each PR. The hot
  paths are browser-only (no direct canvas unit test), so model/lenses/opstreams
  tests are the regression net — keep changes mechanical. Add a small
  `perf.test.js` for `rafBatch` (coalesces N calls to 1, `flush` runs sync) and
  for the `itemsIndex` memo (index correctness, layer bucketing).
- **In-app profiling** (the Phase 0 overlay + counters), per PR:
  - Drag a 50-item selection → confirm `docWrite`/sec ≤60 (Phase 1).
  - Pan with ~10 wires → confirm `gbcr`/sec drops to ~frame rate (Phase 3),
    render buckets don't re-sort (Phase 2 counter flat).
  - Live-edit a wired doc → confirm shape-stream sync doesn't re-push on
    unchanged large `points` (Phase 7).
  - Nested-frame render + drag a stroke inside a rotated frame → no visual
    regression, frame time improved vs. baseline.
- **Build:** `pnpm build` then `pushwork sync` only once the suite is green and
  the overlay confirms the budgets (per repo CLAUDE.md deploy step).
- Record before/after numbers from the overlay in `perf-baseline.md` so the
  wins are documented, not asserted.
