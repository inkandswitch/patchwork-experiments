# Optimization Plan 2

## 1. Add Measurement First

- Add lightweight dev-only counters around `rootItems()` render buckets, wire geometry, shape stream sync, and item render count.
- Add one reproducible stress board fixture/test path: many items, many strokes, several wires, nested frames.
- Goal: know whether each change actually moves frame time.

## 2. Build Shared Item Indexes

- In `src/brush/canvas.jsx`, add memoized indexes:
  - `rootItemById`
  - `rootIndexById`
  - `itemsByLayer`
  - maybe `spaceOwnersById`
- Pass equivalent indexes to child surfaces where needed.
- Replace repeated `.find`, `.findIndex`, `.filter`, and layer bucketing in render and hot paths.

## 3. Memoize Render Buckets

- Replace inline render expressions like:

  ```jsx
  sortById(rootItems().filter(...))
  ```

  with `createMemo` buckets per layer.
- Do the same for child frame item lists in `src/brush/items/item.jsx`.
- Goal: panning/selection should not rebuild sorted arrays unnecessarily.

## 4. Fix Async Inlet Race

- In `src/brush/items/editor-item.jsx`, add per-inlet generation tokens.
- Every async `resolveInlet(w).then(...)` should only apply if:
  - component token still matches
  - inlet token still matches
  - current persisted wiring still equals the wiring that launched the async lookup
- Add a test for rapidly switching URL-backed inlets.

## 5. Stop Deep Equality on Shape Streams

- Replace `valuesEqual(s.value, props)` in shape stream sync with a cheaper comparison.
- Options, in order:
  - compare field identity for large fields like `points`
  - maintain per-shape revision/version
  - split geometry streams into smaller fields instead of one `props` object
- Immediate fix: custom `shapePropsEqual` that avoids `JSON.stringify(points)` unless the points array identity changed.

## 6. Make Brush Module Loading Reactive

- Replace `brushMods` plain `Map` reads with a signal/store version counter or store-backed map.
- When async brush modules load, update reactive state so `isBrushTool`, params, and UI refresh deterministically.
- Add a test or small harness for selecting a brush before its module resolves.

## 7. Memoize Wire State

- Make `visibleWires` a `createMemo`, not a function called repeatedly from JSX.
- Use `rootItemById` and `itemsByLayer` instead of rebuilding maps/scanning inside `geomFor`.
- Keep per-wire geometry memos, but feed them indexed lookups.

## 8. Coalesce Pointer/Camera Streams

- Keep raw gesture handling imperative.
- rAF-coalesce `context.pointer.set/push`.
- Consider rAF-coalescing camera-derived context outlets: `bounds`, `view`, `rects`.
- Presence can stay throttled separately.

## 9. Remove Doc Writes From Text Measurement Hot Path

- Change text measurement to local measured bounds for selection/render.
- Persist text `w/h` only on edit commit, font change, or debounced idle.
- Ensure undo history is not polluted by auto-measure writes.

## 10. Clean Dead/Redundant Code

- Remove unused `interactive`.
- Delete or consolidate stale comments where they obscure the hot path.
- Centralize helpers like descriptor lookup and item lookup so performance assumptions live in one place.

## 11. Validation

- Run unit tests after each small batch.
- Add focused tests for:
  - stale inlet resolution
  - brush module late load
  - shape stream no redundant push on unchanged large points
- Manually profile:
  - pan with many items
  - drag selected large stroke
  - wire view with many nodes
  - nested frame render

## Suggested Order

Implement in this order:

1. Fix async inlet race.
2. Build shared item indexes.
3. Memoize render buckets.
4. Stop deep equality on shape streams.
5. Memoize wire state.
6. Coalesce pointer/camera streams.
7. Make brush module loading reactive.
8. Remove doc writes from text measurement hot path.
9. Clean dead/redundant code.

The async race is correctness. The indexes and render buckets unlock most of the performance fixes.
