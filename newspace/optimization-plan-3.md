# Optimization Plan 3 — maintainability & hygiene

Plans **1** and **2** are performance plans (frame time, memoization, gesture
coalescing, render buckets). They deliberately did **not** touch the
maintainability debt that a read of the codebase surfaces: the half-finished
rename, the 2,896-line god component, the doc sprawl, the console-log litter,
the comment protesting, and the git-log hygiene. This plan covers exactly that
complement. Nothing here is expected to move frame time; the metric is
**time-to-orient** — how long it takes a reader (you, in three months) to find
the right file and trust a change.

## Conventions

- **NON-BREAKING FIRST.** Every phase is ordered so that persisted identifiers
  (the `newspace` / `sketch` **datatype ids**, the `@patchwork.type` field on
  existing docs) are **never** renamed. Those ids are stored on real documents;
  renaming them is a doc migration, out of scope (see *Out of scope*). The
  renames in this plan are limited to **non-persisted** namespace: plugin
  registry type-keys, console tags, localStorage key prefixes, the on-disk
  directory, and identifiers that don't escape the bundle.
- **DEFINITION OF DONE** replaces the "budgets" of plan 1 — a hygiene change
  has no frame-time budget, so each phase states a concrete, checkable
  completion criterion instead.
- **RISK** notes whether a phase touches the reactive dep graph, the persisted
  doc model, or the public plugin registry (consumed by the host and by other
  tools). Anything touching the registry is flagged because a registry key
  rename can break an external consumer that registered under the old key.
- **TEST IMPACT** — the suite is ~1160 tests across 89 files. Most hygiene
  changes are mechanical and covered by existing tests; phases that need new
  tests say so.
- **LAND ONE PHASE PER COMMIT**, with a real subject line (see Phase 7). No
  `prable`.

---

## Phase 0 — decide the end-state names, write them down once

**Goal:** stop the four-name drift (`newspace` / `sketch` / `sketchy` /
`littlebook4`) by picking the canonical name for each **layer** and recording
it in one place, so every later phase has a single source of truth to
mechanically apply.

The current state, audited from the code:

| Layer | Current value(s) | Persisted? | Canonical (this plan) |
|---|---|---|---|
| Directory | `newspace/` | no | **`newspace/`** (keep — moving a patchwork tool dir churns the host's path mapping for no value) |
| Datatype id | `newspace` **and** `sketch` (both registered, both in every `supportedDatatypes`) | **yes** (stored on docs) | **keep both, as-is** — `sketch` is the forward name, `newspace` stays as a back-compat alias forever |
| Doc field | `.sketch` (was `.newspace`) | **yes** | **`.sketch`** (read `.newspace` for back-compat, as the code already does) |
| Plugin type prefix | `sketchy:brush` **and** `newspace:brush` (split — see Phase 1) | no (registry key) | **`sketchy:`** for all plugin types |
| Tool id | `sketchy`, `sketchy:list`, `sketchy:grid`, `sketchy:dock`, `sketchy:pencil` | yes (tool registration) | **keep as-is** (already consistent) |
| Console tag | `[newspace]` **and** `[sketchy]` mixed | no | **`[sketchy]`** (one logger — Phase 2) |
| localStorage prefix | `newspace:camera:` | no | **`sketchy:camera:`** with a one-time migrate-read of the old key (Phase 2) |
| Design doc codename | `LITTLEBOOK4.md` | no (a doc) | **keep the codename** — it's a name for the *project*, not a code identifier; just stop using it as if it were a fourth runtime name |

**Why first:** every later phase references this table. Without it, "rename to
sketchy" is ambiguous (datatype? prefix? dir?) and each phase re-litigates it.
The table is the decision; the rest is execution.

**Definition of done:** the table above lives in `CLAUDE.md` under a
"## Names" heading, and no source file asserts a *different* canonical name in
a comment.

**Files:** `CLAUDE.md` (new section). No code change.

**Risk:** none.

---

## Phase 1 — finish the `newspace:` → `sketchy:` plugin-type rename

**Goal:** kill the dual-registry fallback that currently holds the half-done
rename together.

The split today:

```
src/marker-brush.js, ink-pen-brush.js, crayon-brush.js, charcoal-brush.js  → type: "sketchy:brush"
src/constraint.js, voice.js, highlighter.js                               → type: "newspace:brush"   ← legacy
```

`canvas.jsx:223` papers over it by loading from **both**:

```js
for (const reg of ["sketchy:brush", "newspace:brush"]) { ... }
```

…with a comment at `:217` calling `newspace:brush` "legacy". A brush's
registry **type-key is not persisted** (only the brush `id` is stored on a
configured brush), so this is a safe, mechanical unify.

**Steps:**

1. In `constraint.js:264`, `voice.js:127`, `highlighter.js:27`: change
   `type: "newspace:brush"` → `type: "sketchy:brush"`.
2. In `canvas.jsx:223`: drop the `newspace:brush` entry from the loop; load
   only `"sketchy:brush"`.
3. Grep the whole tree for any other `newspace:` plugin-type prefix
   (`newspace:window`, `newspace:lens`, `newspace:layout`) and unify the same
   way. (Spot-check says they're already `sketchy:` — confirm, don't assume.)
4. Update the now-stale comments at `canvas.jsx:196`, `:217`, `:833` that
   still call the prefix `newspace:brush`.

**Definition of done:** `grep -rn '"newspace:' src/` returns zero hits in
non-test source; the dual-registry loop is a single registry.

**Files:** `src/constraint.js`, `src/voice.js`, `src/highlighter.js`,
`src/brush/canvas.jsx`.

**Risk:** medium — registry type-keys are a public-ish surface. If an
**external** tool registered a brush under `newspace:brush` expecting the
canvas to find it, this breaks it. Mitigation: keep the `newspace:brush` load
line for **one release** behind an `if (DEBUG_LEGACY_BRUSH)`, log a
deprecation when it hits, then remove. Or just announce it; the canvas is the
only known consumer.

**Test impact:** `brush-host.test.js` and `shape-brush.test.js` cover brush
loading; extend with one test asserting a brush registered solely as
`sketchy:brush` is found and one registered solely as `newspace:brush` is
**not** (after the fallback is gone).

---

## Phase 2 — one logger, one tag, one localStorage prefix

**Goal:** replace the scattered `console.log/error/warn` with a single
`src/log.js` that carries a consistent `[sketchy]` tag, a dev-only verbose
toggle, and a clean separation of *diagnostic* (delete) vs *error path* (keep).

Today there are 10 `console.*` calls in `canvas.jsx` alone, with mixed
`[newspace]` / `[sketchy]` tags (`:77`, `:80`, `:216`, `:296`, `:999`, `:1049`,
`:1526`, `:1619`, `:1850`, `:1929`). Some are genuine error paths
(`ensureLayout` failed, `loadSpace` failed); some are diagnostics that
shouldn't ship (`:80` logging "layout converged → …").

**Steps:**

1. New `src/log.js`:
   ```js
   const VERBOSE = import.meta.env?.DEV ?? false;
   export const log = {
     warn: (msg, ...a) => console.warn("[sketchy]", msg, ...a),
     error: (msg, ...a) => console.error("[sketchy]", msg, ...a),
     debug: (msg, ...a) => { if (VERBOSE) console.log("[sketchy]", msg, ...a); },
   };
   ```
2. Replace `console.error("[newspace] …")` / `console.warn("[sketchy] …")`
   across the tree with `log.error` / `log.warn`. The `:80` "layout converged"
   line and any other `console.log` (not `.error/.warn`) become `log.debug` —
   visible in dev, silent in prod.
3. localStorage: rename the camera-persistence key
   `newspace:camera:<url>` → `sketchy:camera:<url>`, with a one-time
   migrate-on-read: if the new key is absent and the old key is present, copy
   it across and delete the old one. (`makePersisted` in `canvas.jsx:84`.)

**Definition of done:** `grep -rn 'console\.' src/ | grep -v test` returns
only the inside of `src/log.js` (and `test-harness.js` if it needs raw
console). No `[newspace]` tag anywhere. Camera position survives the key
rename for existing users (verified by hand once).

**Files:** new `src/log.js`; `src/brush/canvas.jsx`; any other file with a
`console.*` (sweep — there are a handful outside canvas).

**Risk:** low. The migrate-read is the only stateful part; make it best-effort
(swallow errors) so a corrupted key never blocks camera load.

**Test impact:** none required; optionally a tiny test for the localStorage
migrate-read.

---

## Phase 3 — split `canvas.jsx`

**Goal:** break the 2,896-line god component into cohesive modules behind a
stable `Canvas` entry point. This is the single biggest readability win in the
plan and also the highest-risk, so it lands last among the code phases and in
the smallest viable slices.

The file today is essentially four things stitched into one `Canvas(props)`
body (lines 58–~2547) plus a giant JSX return (~2549–2870) plus two
free-standing subcomponents (`Chooser` ~2884, `Float` ~2919):

1. **Layout / doc acquisition** — `folderDoc`, `rootLayoutH`, `ensureLayout`,
   `loadSpace`, `loadDoc`, `loadDatatype`, the `.sketch`→layout convergence
   effect (`:60–:330`).
2. **Coordinate spaces & boxes** — `layersList`, `txFor`, `layerBoxOf`,
   `chainFor`, `boxToScreen`, `resolveItemPos`, `toAnchorOffset` (`:88–:141`).
3. **Gestures** — `onItemDown`, `startMove`, `startCopyMove`, `startResizeSel`,
   `applyResize`, `startGroupResize`, `startGroupRotate`, `startRotate`,
   `resetRotation`, `startSegEnd`, `reorder`, `toWorld/toSpace` (`:443–:832`).
4. **Draw-claim & wire-drop** — `drawTarget`, `convertToLocal`, `pushItem`,
   `callBrush`, `callWire`, `dropWire`, `dropFromInlet`,
   `onPointerDownCapture`, `onDrawClaimCapture` (`:334–:1125`).
5. **The JSX render tree** — the ~320-line `return (...)` plus the
   subcomponents at the bottom.

**Slicing principle:** extract **pure-ish helpers first** (no signal
ownership), then **a context object** that the gesture/draw modules close
over, then **the JSX**. Never move ownership of `cam`/`selected`/`tool` out of
`Canvas` — they stay the source of truth; extracted modules receive accessors.

**Steps (each its own commit):**

1. **Extract `src/brush/coord-spaces.js`** — the pure transform helpers
   (`layerBoxOf`, `chainFor`, `boxToScreen`, `boxScale`, `resolveItemPos`,
   `toAnchorOffset`) that take their inputs as arguments. These are already
   nearly pure; they read `viewportRef`, `layersList`, `activeLayerId` — pass
   those in. ~80 lines out.
2. **Extract `src/brush/gestures.js`** — the move/resize/rotate/reorder
   cluster. They need `cam`, `selected`, `transact`, `active()`, `surfaces`.
   Define a `GestureApi` (the accessors + mutators they call) and pass it in;
   do **not** move signal ownership. ~400 lines out.
3. **Extract `src/brush/wire-drop.js`** — `dropWire`, `dropFromInlet`,
   `onPointerDownCapture`, `callWire`, `dropOntoMap`, `maybeRebox`. ~300 lines.
4. **Extract `src/brush/draw-claim.js`** — `drawTarget`, `convertToLocal`,
   `pushItem`, `onDrawClaimCapture`, `callBrush`. ~250 lines.
5. **Extract the two subcomponents** — `Chooser` (~2884) and `Float` (~2919)
   into `src/brush/ui/chooser.jsx` and `src/brush/ui/float.jsx`. They are
   already self-contained; trivial.
6. **Last:** consider splitting the JSX return into a `<CanvasSurface>` /
   `<CanvasOverlay>` pair, but **only if** steps 1–5 haven't already dropped
   `canvas.jsx` under ~800 lines. The JSX split has the worst risk/reward
   (Solid's fine-grained reactivity is sensitive to component boundaries
   around memos); skip it if the file is already readable.

**Definition of done:** `canvas.jsx` is the `Canvas` entry, the signal
ownership, the context wiring, and the top-level JSX — under ~800 lines. Each
extracted module has a one-line contract comment and no signal ownership of
its own. `grep -c createSignal src/brush/canvas.jsx` drops from 43 toward
~20 (the ones that remain are genuinely canvas-owned).

**Files:** new `src/brush/{coord-spaces,gestures,wire-drop,draw-claim}.js`,
new `src/brush/ui/{chooser,float}.jsx`; `src/brush/canvas.jsx` shrinks.

**Risk:** high. This is the path the perf plans live in — every memo they add
is inside `Canvas`. Extraction can silently change a memo's dependency
tracking if a closure captures a stale accessor. **Mitigations:**
- Do it on top of plan 1's Phase 0 measurement scaffolding, so a regression
  in frame time or `handle.change` count is visible immediately.
- Run the full gesture suite by hand after each slice (drag, resize, rotate,
  group, wire-drop, draw-into-frame, eraser).
- Keep the `createEffect`/`createMemo` call sites exactly where they are;
  moving them changes dep tracking.
- One slice per commit, each revertible.

**Test impact:** the canvas has no direct unit test (`canvas-chrome.test.js`
tests chrome exports, not the component). Add a thin `gestures.test.js`
exercising the pure `GestureApi` functions (resize math, anchor resolve) so
the extraction has a net. This is also the gap plan 2 §1 flagged.

---

## Phase 4 — comment policy: keep the *why*, cut the protestations

**Goal:** reduce the comment noise so the comments that remain carry signal.

The codebase has two comment smells:

- **Protestations** — comments that exist to pre-empt a code review that
  isn't happening: *"arrays-only is a design choice here, not a workaround"*
  (`datatype.js:21`), *"not a projection workaround"*, *"the current Solid
  projection reconciles cleanly… pinned by tests"*. These belong in a commit
  message or a doc, not inline. If a reader needs to know *why* arrays, point
  them at `NODES.md`; the inline comment should say *what invariant holds*.
- **Inline lectures** — multi-paragraph comments explaining CRDT semantics
  inside a function body (e.g. `canvas.jsx:63–:79`). These are valuable
  knowledge in the wrong place: move to `NODES.md` / `LAYOUTS.md`, leave a
  one-line pointer inline.

**Policy (add to `CLAUDE.md`):**

- A comment answers **why**, once. If the *why* is non-obvious and stable,
  it's a doc paragraph; inline, leave a pointer.
- Don't argue with an imagined reviewer. "not a workaround", "on purpose",
  "this is fine" — delete; if the choice is genuinely surprising, replace
  with the invariant it preserves.
- Caps comments (`// ATTACH THE PROVIDER FIRST`) are allowed **only** for
  ordering invariants whose violation causes a silent bug (the provider
  subscription one qualifies; keep it).

**Steps:**

1. Sweep `canvas.jsx` and `datatype.js` for protestation comments; delete or
   compress to a one-line invariant.
2. Move the CRDT/layout-convergence lecture at `canvas.jsx:63–79` into
   `LAYOUTS.md`; leave `// see LAYERS.md §layout-convergence` inline.
3. Add the policy paragraph to `CLAUDE.md`.

**Definition of done:** no comment contains the phrases "not a workaround",
"on purpose", "this is fine", "design choice here". Multi-paragraph inline
comments are gone; their content lives in the docs with an inline pointer.

**Files:** `src/brush/canvas.jsx`, `src/datatype.js`, `CLAUDE.md`,
`LAYOUTS.md`.

**Risk:** low — comments only. The danger is deleting a comment that encoded
a real invariant; mitigate by reading each before deletion and converting
(rather than removing) any whose invariant isn't already expressed in code or
docs.

**Test impact:** none.

---

## Phase 5 — consolidate the docs

**Goal:** four overlapping markdown files (`CLAUDE.md` 98 lines, `LAYOUTS.md`
97, `NODES.md` 209, `LITTLEBOOK4.md` 372) plus `TODO.md` is too many surfaces
to keep in sync — they already aren't (TODO.md admits it had to be rewritten
because items appeared 3–4× and many were already done).

**Target structure:**

- **`CLAUDE.md`** — the *operating manual*: commands, globals, the Names
  table from Phase 0, the comment policy from Phase 4, build/deploy. Nothing
  that changes per-feature.
- **`ARCHITECTURE.md`** (rename of `LITTLEBOOK4.md`) — the *design rationale*:
  why arrays, why the box-transform model, why brushes-not-tools, the
  coordinate-space-as-box proof. Stable, rarely edited.
- **`NODES.md`** — the wiring system reference (keep; it's a focused
  reference, not sprawl).
- **`LAYOUTS.md`** — fold into `ARCHITECTURE.md` unless it's a hot reference;
  if it is, keep but cross-link.
- **`TODO.md`** — living list, single section, no "STILL TODO" / "Landed
  (was untracked)" splits. Rule: a done item is deleted, not moved to a "done"
  section; an untracked-but-shipped feature was never a TODO and doesn't
  become retroactively one.

**Steps:**

1. Move the design-rationale content of `CLAUDE.md` (the architecture
   section) into `ARCHITECTURE.md`; keep `CLAUDE.md` to operating manual +
   the Phase 0 names table + the Phase 4 comment policy.
2. Rename `LITTLEBOOK4.md` → `ARCHITECTURE.md`; add the layout-convergence
   lecture moved in Phase 4.
3. Audit `LAYOUTS.md`: merge into `ARCHITECTURE.md` or keep + cross-link.
4. Rewrite `TODO.md` as a single flat list; delete the "Rewritten / Updated"
  meta-header (it's git history, not content).

**Definition of done:** four files, each with one job, cross-linked, no
duplicated content. `TODO.md` has one section and no done-items.

**Files:** `CLAUDE.md`, `LITTLEBOOK4.md`→`ARCHITECTURE.md`, `LAYOUTS.md`,
`TODO.md`, `NODES.md`.

**Risk:** low. Doc moves can break a deep link from a memory file or a
comment pointer; grep for `LITTLEBOOK4` references (memory + code comments)
and update them in the same commit.

**Test impact:** none.

---

## Phase 6 — tool proliferation audit

**Goal:** make the tool zoo legible: `NewspaceTool`, `SketchyTool`,
`SketchpadTool`, `makeNewspaceTool(opts)`. Two are the real tool, one is a
migration-in-progress behind a "flip the registration" comment, one is a
factory.

Today (`src/tool.jsx`):

- `NewpaceTool = makeNewspaceTool()` — the full tool (registered as `sketchy`).
- `SketchyTool` — the "thin tool", with a comment saying it's *"Not the
  registered default yet — flip the registration in index.jsx to go live, once
  `<patchwork-view component>` is confirmed in the host."*
- `SketchpadTool = makeNewspaceTool({ minimal, minimap:false, defaultTool:"pen" })`
  — registered as `sketchy:pencil`.

**Steps:**

1. Decide the `SketchyTool` fate: if `<patchwork-view component>` is confirmed
   in the host, flip the registration and make it the default, then delete
   `NewspaceTool`. If it isn't, either delete `SketchyTool` or move it behind
   an `experimental` flag with a tracked decision and a date. **No
   half-finished migration should sit in `tool.jsx` with a "TODO: flip later"
   comment** — that's exactly the drift Phase 0 is meant to end.
2. Rename `makeNewspaceTool` → `makeSketchyTool` to match the tool id, since
   this identifier doesn't escape the bundle. (Or keep `newspace` if you'd
   rather the factory match the dir — but pick one and apply the Phase 0
   table.)
3. Add a one-line comment above each exported tool stating its registration id
   and whether it's the default.

**Definition of done:** every exported tool in `tool.jsx` has a registration id
and a default/experimental marker; no "flip the registration later" comment
without a tracked decision date.

**Files:** `src/tool.jsx`, `src/index.jsx`.

**Risk:** low–medium. The `makeNewspaceTool` rename is bundle-internal (safe).
The `SketchyTool` flip is a real behavior change — only do it if the host
capability is confirmed; otherwise this phase's value is *forcing the
decision*, not making it.

**Test impact:** none.

---

## Phase 7 — commit-message hygiene

**Goal:** stop committing `prable` / `ok` / `lb`.

The recent log: `prable`, `ok`, `lb`, `i hate this, and it's fragile`. The
last one is honest but useless in a `git log --oneline`.

**Policy (add to `CLAUDE.md`):**

- Subject line: imperative, ≤72 chars, lowercase prefix matching the area
  (`canvas:`, `brush:`, `nodes:`, `docs:`, `rename:`, `fix:`).
- No subjects that are only a codename or interjection (`lb`, `ok`, `prable`).
  If the change is genuinely a scratch commit, squash before it lands on
  `main`, or use `wip: <thing>` and follow up.
- The "i hate this, and it's fragile" energy is welcome **in the body**, not
  the subject. A subject like `fix: block recursive frame render in picker`
  with a body explaining why it's fragile is the ideal.

**Steps:**

1. Add the policy to `CLAUDE.md`.
2. Going forward: enforce by self-review before `git commit` — read the
   subject back; if you'd be embarrassed to see it in a changelog, rewrite.

**Definition of done:** the next 20 commits all have an area prefix and a
real subject. (No enforcement tooling — this is a habit, not a hook. If a hook
is wanted, that's a separate `commit-msg` task, out of scope here.)

**Files:** `CLAUDE.md`.

**Risk:** none.

**Test impact:** none.

---

## Out of scope

- **Renaming the `newspace` / `sketch` datatype ids.** They're persisted on
  documents. A rename is a doc migration with a back-compat alias and a
  sweep of every `supportedDatatypes` array; it's a real project, not a
  hygiene pass. The dual registration already provides the forward path
  (`sketch`); leave `newspace` as the permanent alias.
- **Renaming the `newspace/` directory.** A patchwork tool's directory path is
  referenced by the host's tool registry / path mapping; moving it for
  cosmetic reasons isn't worth the churn. The dir name doesn't appear in
  user-facing or persisted surfaces, so it's the lowest-value rename.
- **Performance.** That's plans 1 and 2. This plan should be sequenced
  *after* plan 1's Phase 0 (measurement scaffolding) exists, so the
  `canvas.jsx` split (Phase 3) can ride a frame-time baseline.
- **Adopting TypeScript.** The house style is vanilla JS, no TS (per the
  writing-patchwork-tools skill). Not happening.

## Sequencing

```
Phase 0  (decide names)          — no code, do first, blocks nothing
Phase 7  (commit policy)         — no code, adopt now so the rest lands clean
Phase 1  (registry rename)      — low risk, high clarity
Phase 2  (logger + tags + LS)    — low risk, mechanical
Phase 4  (comment policy)        — low risk, but do after 1–2 so the moved code is already touched
Phase 5  (doc consolidation)     — low risk; do alongside 4 (both move prose)
Phase 6  (tool audit)            — forces a decision; do when you can make one
Phase 3  (split canvas.jsx)      — HIGH risk; do last, on top of plan-1 Phase 0
```

Phases 0, 7, 1, 2 are an afternoon. Phases 4–6 are a day. Phase 3 is a
careful, slice-by-slice week — and it's the only phase that can regress the
perf plans, so it gates on their measurement scaffolding existing.