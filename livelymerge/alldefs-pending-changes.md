# alldefs.js — pending changes (for export to other projects)

Started: 2026-07-13

Track edits made on this branch before folding into pyonpyon or elsewhere.
Ask the agent to compile this into a patch file or port list when ready.

---

## 1. TextPane / TextBox — empty or null initial text (2026-07-13)

**Problem:** Opening a TextPane with `null` or `''` gave almost no vertical height and the caret/selection bar did not appear at the left as expected.

**Fix in `alldefs.js`:**
- `w.TextBox.proto.compose` — treat empty string as one blank line at full `lineHeight`.
- `w.TextBox.proto.setText` — coerce `null`/`undefined` to `''`.
- `w.TextBox.proto.setNullSelection` — place caret via `charSpecForIndex(0)` so the hairline sits at the text inset (left margin).
- `w.TextPane.proto.setText` — normalize `null` before passing to content pane.

**Files:** `alldefs.js` only.

---

## 2. Local storage browser panel (2026-07-13)

**Feature:** `LocalStoragePanel` — keys in a left `ListPane` (40% width, like system browser class list), value in a right `TextPane` (60% width, like browser message column). Uses `w.storageKeys`, `w.storageGetItem`, and `setLocalStorageKey` on edit/save.

**World menu:** third item `'Local storage'` opens `w.openLocalStorageBrowser()`.

**Demo:** `populateLively` world menu moved to `(160, 70)` (+30 right, +30 down from `(130, 40)`).

**Files:** `alldefs.js` — `LocalStoragePanel`, `w.openLocalStorageBrowser`, `showWorldMenuAt` menu items.

---

## 3. Panel default positions (2026-07-13)

**Browse panels:** default top-left **+20px right** (`PanelMorph`, `LocalStoragePanel`, `InspectorPanel`, `w.inspect`, halo inspect).

**Welcome panel:** `populateLively` welcome `MethodPanel` stays at y **350** (reverted from temporary +20px down).

---

## 4. HandMorph pointer tracking regression (2026-07-14)

**Problem:** After `window.pointerLocation` replaced per-morph `this.pointerLocation`, Init hand created a visible hand but it did not follow the pointer. Events appeared to hit morphs under the raw cursor while the hand stayed at its spawn point.

**Root cause:** `WorldMorph.onPointerMove` set `window.pointerLocation = p` *before* calling `hand.onPointerMove`, so the hand computed zero delta (`p - p`) and never moved.

**Fix in `alldefs.js`:**
- `HandMorph` — restore per-hand `this.pointerLocation` for move delta (matches pre-LM backup).
- `WorldMorph.onPointerMove` — call `hand.onPointerMove` first, then update `window.pointerLocation`.

**No-hands behavior:** unchanged; `handForID` returns null and world dispatch is the same as before.

**Files:** `alldefs.js` only.

---

## 5. `makeBouncer` cleanup (2026-07-15)

**Change:** Replaced `makeBouncer` body with the clearer `nudge` / `bounceX` / `bounceY` rewrite; removed `makeBouncerBetter`. Still registers on `w.bouncers` so `makeBouncerGoAway` works.

---

## 6. `initHand` — sequential hand IDs (user, 2026-07-15)

**User replacement** of `WorldMorph.initHand`:
- Hands keyed by slot index `this.hands.length` (0, 1, 2…) instead of `window.actorID`.
- Color cycles `green` / `blue` / `red` by that index.
- Still creates `HandMorph` at `window.pointerLocation` and `addHand`s it; `start == false` clears hands.

**Note:** Event dispatch still looks up `handForID(evt.actorID)` where `evt.actorID` is the Automerge actor string. Slot indices will not match that unless routing is updated to match (e.g. `myHand()` / first local hand).

---

## 7. RETURN TO: stickout submorph hit-testing under scaled/rotated parents (2026-09-08)

**Status:** Deferred — do not forget.

**Problem:** A submorph that sticks out of its owner's shape, where that owner is scaled and/or rotated, does not receive pointer hits in all the places it is rendered. Nested transform *math* (`localize` / `relativize` / `invertPt`) is fine for points that land on shapes along the owner chain; the stickout case is the incomplete part.

**Likely gap:** Descent / drop / some pointer paths gate on `includesPt` (owner **shape** only) rather than `fullBounds` (AABB including stickouts). `topMorphAt` already uses `fullBounds` as a prefilter then shape-exact hits — stickouts under a transformed parent still need a careful pass (we looked once and parked it).

**Files:** `newdefs.js` — `topMorphAt`, `onPointerDown` / move / up, `dropOnTopMorphAt` walk, related.

**Related shipped (not this):** Affine reparent / `morphCopy` world-appearance baking for grab/drop object constancy under transforms.

---

## 8. checkpointToRepo → xdefs.js (2026-09-08)

**Shipped in `newdefs.js`:** `checkpointToRepo(path?)` writes a bootable live-system dump (default `xdefs.js`) via host hook `window.checkpointWriteFile(path, text)`.

**Also:** `exportBootableSystemString()` — classes first (with Color.* data), filtered globals (no host natives), top-level data, trailing `init()`.

**Verified:** load newdefs → checkpoint → boot `xdefs.js` → checkpoint again → ~33 byte drift (timestamps). See `src/checkpointToRepo.test.ts`, `xdefs-compare.json`.

**Usage (browser / Patchwork):**
```javascript
checkpointToRepo('xdefs.js')  // triggers a file download — no writeFileSync
```
Clear a bad hook if you installed one earlier:
```javascript
window.checkpointWriteFile = null
```
