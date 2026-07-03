# PLAN — "Set Aside" + the opstream docs-lens

Audience: a capable model picking this up cold. Read first (in this repo):
`CLAUDE.md` (operating manual — names, state homes, undoability, comment/commit
policy), `PLAN.md` (the standing rules of engagement — **chee owns git; you
NEVER commit/push; migrations are additive-only; suite + build gate every
step**), `CONTAINERS.md` (the container-types / Sketch-doc redesign this plugs
into), `NODES.md`, `LAYOUTS.md`. Honor the auto-memory at
`~/.claude/projects/-Users-chee-soft-inkandswitch-patchwork-tools/memory/`.

This plan does two coupled things:

1. Ships **Set Aside** — a shared holding area for documents that don't have a
   place on the canvas yet.
2. Uses it to unblock the **opstream docs-lens** — making the
   `patchwork:component` (the Canvas) consume an **items opstream** instead of
   reading an automerge doc.

They're coupled because Set Aside *dissolves the placement problem* that made
the tool-side join awkward (see §2).

---

## 0. Status at handoff (what already exists, green)

- **`src/docs-lens.js`** — the docs↔items join, extracted from `brush/canvas.jsx`.
  Two forms, both tested (`src/docs-lens.test.js`), full suite green (1653),
  `pnpm build` clean:
  - `docsLens(folderStream, sketchStream)` — the **real opstream lens**:
    returns `scope(sketchStream, ["items"])` (a granular, writable `Item[]`
    opstream) with the folder join folded in (materialize-on-link-add,
    unlink+tombstone-on-last-shape-removal reacting to the stream, dedupe
    convergence). **Nothing consumes it yet** — the tool doesn't serve it.
  - `createDocsLens()` — the pure array-level core (`reconcile` / `dedupe` /
    `unlinkForDelete` / tombstone) still called by the **handle-based Canvas**
    during migration. `brush/canvas.jsx` delegates its three inline join sites
    to this (add effect ~L2310, dedupe effect ~L2333, unlink in `removeItems`
    ~L805; `context.tombstoned` reads `isTombstoned`).
  - Both materialize a link via `itemForLink(link, pos)`; today `pos` is a
    viewport-centre guess (handle path) or an origin fallback (opstream path).
    **Set Aside removes the need for `pos` entirely** (§2).

- **The tool↔component boundary** (already built, this is the target
  architecture — see memory `component-opstream-powered`):
  - `src/tool.jsx` `SketchyTool` — acquires folder + layout handles, serves
    them as opstreams via `provideSketchyStreams` (`sketchy:folder`,
    `sketchy:layout`); renders `<patchwork-view component="sketchy">`.
  - `src/component.js` `SketchyComponent` — subscribes those, wraps each port
    as an opstream, then **dresses them back as DocHandle adapters**
    (`docHandleFromOpstream` / `automergeDocOverPort` in
    `src/sketchy-streams.js`) so the doc-shaped Canvas can run unchanged. **That
    dressing is the thing to delete** — it's why the component still "knows" it
    has an automerge doc.
  - `src/surface-doc.js` — the ONE reactivity seam (handle → Solid store).

- **Opstreams vocabulary** (`import { … } from "./opstreams.js"`, re-exports the
  `opstreams` lib): `Opstream`, `Source`, `automergeOpstream(handle,{path})`,
  `scope(stream, path)` (structural lens, granular both ways), `transform`,
  `bind`, `splice(path, from, to, value)` (**`range` is `[from, to)`** — a
  delete of index `i` is `splice(p, i, i+1, [])`; an append is
  `splice(p, n, n, [values])`), `set`, `snapshot`.

**The standing direction (non-negotiable, from chee, in memory):** the
component MUST be opstream-powered and MUST NOT read `handle.doc()` / write
`handle.change()`. Do not reintroduce the handle-shortcut.

---

## 1. The Set Aside concept (confirmed with chee 2026-07-03)

A **shared** holding area for documents that have arrived but haven't been given
a place on the canvas.

- **What it is:** a seeded **flap** (a `flap: true` FRAME item) on the
  **overlay** layer, shows-on-canvas, collapsed to an **edge-tab** when sticky —
  same machinery as the parts bin. Its contents render as a **LIST**, not a
  spatial sub-canvas (this is the first real non-canvas *container type* to ship
  in-view — reuse the dormant `src/list-tool.jsx` as reference; ties into
  CONTAINERS.md §7).
- **Membership = parenting.** An item "in the aside" is one **parented into the
  aside flap** (`parent: <ASIDE_ID>`), the same field annotations use to live
  inside a box. Differences from spatial parenting: the aside renders children
  as list rows (name + icon, like the parts-bin census tiles / a file list), and
  a listed item needs **no meaningful `x`/`y`** — its order is list order, not
  coordinates. So parenting into the aside is pure membership: set `parent`, do
  NOT reproject coordinates (unlike `model.js annotateItemIntoBox`, which is for
  spatial boxes).
- **Shared, in the doc** (fork 1, answered): the aside item and its children
  live in the Sketch doc's `items[]`. A doc anyone adds lands in everyone's
  aside until someone places it. (A *personal* "shelf for later" is a possible
  future variant — out of scope; would live in the top-layer user doc.)
- **Per-viewer open/closed** state (the flap tab) stays where flap state already
  lives: the top-layer user doc (`flaps[id].open`) — device/person state, not
  shared. Only membership is shared.

### The rule that defines when a doc goes to the aside (fork 2, answered)

> A doc goes to Set Aside **iff it arrived through the folder contract** (an
> external link add / first-time open of a folder) — i.e. it was NOT placed by a
> canvas gesture. **There is never an "obvious spot" for such a doc.** A doc
> added by a canvas gesture (drop, paste, create-here, alt-drag copy) already
> has a position and NEVER touches the aside.

Concretely: the docs↔items join's **ADD side** is the only producer that routes
to the aside. Every canvas-gesture code path that creates an item with an `x`/`y`
is unchanged.

### Gestures

- **Drag out** (aside → canvas): a component-owned gesture. Unparent
  (`delete parent`) + set `x`/`y` at the **drop point** in world coords (the
  component knows the camera) + set canvas home layer (`layers: ["canvas"]`).
  Now it's an ordinary canvas item. **This is where a real coordinate finally
  gets assigned** — which is exactly why the tool never needs your camera.
- **Drag in** (canvas → aside): drop a canvas item onto the tab/flap → set
  `parent: <ASIDE_ID>`; its `x`/`y` become irrelevant (kept, ignored). Reuse the
  existing containment/drop machinery (`frameAtWorld` + `effFrame`; drops
  already work on any layer — note TODO.md: the *draw-claim* is base-layer only,
  but *drops* are not).
- **Remove from aside:** deleting an aside item is a last-shape removal like any
  other → the existing unlink path drops the folder link (an aside item is a
  `doc`/`frame` shape, so `shouldUnlinkDoc` counts it). No new behavior.

### Why this resolves placement (the whole point)

A freshly-materialized doc has **no position because it genuinely has none yet**.
The join stops guessing a coordinate; it just sets `parent: <ASIDE_ID>`. The
tool-side lens therefore needs **no viewport/camera** — the one thing that made
moving the join tool-side awkward disappears. The camera is only ever consulted
by the **component**, at drag-out, where it belongs.

### Open design details (decide while building; small, flag to chee if unsure)

- **Dismissability:** if the aside flap can be deleted (added to
  `dismissedSeeds`), externally-added docs would have nowhere to land. Options:
  (a) the aside is a **non-dismissable** seed; (b) if it's missing when a doc
  arrives, the join **re-seeds it on demand**; (c) ugly fallback to `x:0,y:0`.
  Recommend (a) or (b). Default (b) if unsure — most forgiving.
- **First-open of a populated folder:** by the rule above, a folder you open in
  Sketchy for the first time has links but no canvas items yet → **all its docs
  materialize into the aside**, and you drag them onto the canvas as you like.
  This is consistent and arguably correct (nothing was placed on THIS canvas),
  but it's a visible behavior change worth confirming with chee before shipping
  Phase 1. Existing Sketch docs whose items already have coordinates are
  untouched (only links lacking a shape materialize) — additive, no layout loss.
- **List ordering:** simplest is Sketch `items[]` order filtered to
  `parent === ASIDE_ID` (i.e. add order). Add an explicit order field only if a
  reorder gesture is wanted later.
- **`ASIDE_ID`:** a stable seed constant (e.g. `"ns-aside"`), added to
  `SEED_IDS`, so the join can reference it deterministically and it converges
  across peers.

---

## 2. Build sequence

Two phases. **Phase 1 (Set Aside on today's handle-based Canvas) is
independently shippable and removes the placement/camera dependency from the
join right now.** Phase 2 (the opstream re-seat) is then unblocked and much
cleaner. Each numbered step is its own suite+build-gated landing; leave the tree
for chee to commit.

### Phase 1 — Set Aside (handle-based; ships as a normal feature)

1. **Seed the aside flap.** Add `ASIDE_ID = "ns-aside"` to `SEED_IDS`
   (`brush/constants.js`); seed a `flap: true` frame item, `kind: "frame"`,
   `layers: ["overlay"]`, sticky-to-an-edge, shows-on-canvas, marked as a
   **list container** (a field the renderer keys on — e.g. `container: "list"`
   or reuse whatever list-tool.jsx expects). Seed it in `LAYOUT_SEEDS` /
   `defaultOverlayItems()` and in the `ensureLayout` healer for old docs
   (dismissal-aware, per CONTAINERS.md §3). Decide dismissability (§1).
   *Gate:* `brush/constants.test.js`, `brush/ensure-layout-doc.test.js`.

2. **Render the aside as a list.** When a flap/frame is a list container, render
   `items.filter(it => it.parent === ASIDE_ID)` as list rows (name from
   `linkFor(url)`, icon from the datatype) instead of a spatial sub-canvas.
   Reuse `list-tool.jsx`. An aside item is NOT drawn on the canvas (it has no
   canvas presence — it's parented into the list). *Gate:* add a render/units
   test; happy-dom can't measure — keep it logic-level.

3. **Route the join to the aside.** Change `docsLens`/`createDocsLens` so
   `itemForLink` sets `parent: ASIDE_ID` and drops the `x`/`y` guess (and the
   `place`/`placeBase` params). Update `brush/canvas.jsx`'s add-effect callsite
   to stop passing viewport centre. Existing placed items are untouched (only
   un-shaped links materialize). *Gate:* `docs-lens.test.js` (update the
   placement assertions to expect `parent: ASIDE_ID`, no coords),
   `model*.test.js`, `integration.test.js`.

4. **Drag-out / drag-in gestures.** Drag an aside row onto the canvas →
   unparent + set `x`/`y` at drop (world coords) + `layers: ["canvas"]`; land it
   in the canvas history (undoable — user intent). Drop a canvas item onto the
   tab → `parent: ASIDE_ID`. Reuse `frameAtWorld`/`effFrame`/drop machinery.
   *Gate:* gesture/geom tests; **browser check** (drag both directions).

   **After Phase 1 the placement problem is gone** and Set Aside is a real,
   shippable feature. `pushwork sync` when green (chee's call to deploy).

### Phase 2 — the opstream re-seat (the big migration; own landings)

Goal: the component consumes streams and holds no handle. The layout doc feeds
the component FOUR things — plan each as its own scoped stream. **The write path
is the crux**: ~26 `rootLayoutH().change(d => d.items…)` sites in
`brush/canvas.jsx`, plus the undo system (`transact`/`beginTxn`/`snapshotItems`/
`diffCommand`) is built on `handle.change`.

5. **Tool owns the join; component reads items from the stream.** In
   `SketchyTool` build `folderStream`/`sketchStream` once and construct
   `docsLens`; serve `lens.items` as a new `sketchy:items` selector. In the
   component, subscribe `sketchy:items`; `rootItems()` reads it. **Delete the
   Canvas's three join effects and its `folderDoc.docs` join usage** (they now
   live tool-side). Writes still go through the layout handle *temporarily*
   (same underlying doc → consistent). This kills the component's knowledge that
   it's a folder. NOTE: the lens has side effects (it writes materialized
   items), so this must land atomically with removing the component's join —
   don't serve the lens while the component still runs its own. *Gate:* full
   suite; **browser check** (two tabs: add/remove a doc, watch both).

6. **Item writes → the items stream.** Convert the ~26 `change(d=>d.items)`
   sites and the history layer (`transact`/`beginTxn`/`endTxn`/`snapshotItems`/
   `diffCommand`) to apply ops through the items opstream (`items.apply(op)`)
   instead of `handle.change`. The big one — do it in reviewable slices
   (draw, move/resize, wire, paste, delete, reorder). Undo semantics from
   CLAUDE.md's undoability section must hold. *Gate:* `history.test.js` +
   per-gesture tests each slice; **browser check**.

7. **`layers` + `dismissedSeeds` → their own scoped streams**
   (`scope(sketchStream, ["layers"])`, etc.); the component drops the layout
   handle entirely. *Gate:* `layer-membership.test.js`, chrome tests.

8. **Acquisition → the tool; delete the dressing.** Move the layout-url
   derivation (`folderDoc.sketch`/`.newspace`, `brush/canvas.jsx` ~L127) into
   the tool. Delete `docHandleFromOpstream` / the doc-shaped adapter usage. The
   component now receives only streams. *Gate:* full suite; **browser check**.

---

## 3. Verification (the harness can't do this alone)

happy-dom can't exercise the real port/merge path, rects, pointer-events, or
Leaflet. Every Phase 2 step and Phase 1 steps 2/4 need a **browser check from
chee** (backtick opens the op-debug overlay): draw, embed a doc, delete it,
drag to/from the aside, two tabs for convergence. Diagnose in code first; ask
for a console probe when the harness can't see it.

## 4. Consequences to record when it lands

- CONTAINERS.md: Set Aside is the first shipped **container type** (list) and
  the resolution of the tool-side-join placement question — update §7 and the
  Ring 2 §2 note (the lens materializes into the aside, no viewport).
- Memory: add a `set-aside` concept note (shared holding area; parenting =
  membership; externally-added-only rule) and link
  `[[component-opstream-powered]]`.
- TODO.md: the "route DRAWN marks into an open flap drawer" item and the
  list/grid/dock container-type item both touch this — reconcile them.
