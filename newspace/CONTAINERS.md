# Container types & the sketchy doc — design note (PROPOSAL, nothing built)

chee's correction (2026-07-02): shapes are part of the doc, not a "layout";
container types and layouts got conflated; chrome parts should be ordinary
overlay items, not toggles. This note states the consolidated concept set for
approval before any code.

## The four concepts (orthogonal)

1. **The sketchy doc** — the `.sketchy` doc linked from a folder (or opened
   directly by a sketchy tool). It owns the CONTENT: `items[]` and the
   document's own `layers[]` (shared — part of the work itself; array order =
   space order). Marks, shapes, nodes, wires: all items in this doc.
   *(Today's ".sketch complement" already holds exactly this — the data is in
   the right place; what dies is calling it a "layout doc" and hanging layout/
   chrome/mode config off it.)*

2. **User layers** — a person may have their own layers for a specific
   document, composited over the doc's layers. Same layer model — an added
   layer shows only what you've chosen to put on it (`layers: []` membership).
   Your chrome (palette, minimap, zoom — and eventually toolbar, properties,
   presence, flaps) is ordinary items on YOUR layers. Stored per-user (the
   existing top-layer user-state doc is the seed of this).

3. **Container types** — a property of the VIEWER: different ways of laying
   out the same content (canvas is one; list/grid/dock can return as these
   later). The `patchwork:tool` chooses the default container type for the
   `patchwork:component`; the person can switch in-view. NOT persisted on the
   doc, NOT separate registered tools, NO per-type complement docs.

4. **tool / component split** — unchanged, and load-bearing: **the
   patchwork:component only knows what it's told.** It renders content,
   layers, and a container type from the opstreams handed to it — all of
   which can be derived from ANY automerge docs. The tool is the wiring: the
   default sketchy tool derives content+doc-layers from the `.sketchy` doc
   and user layers from the viewer's own doc, but nothing in the component
   knows or cares which docs those were. A different tool can wire the same
   component from entirely different documents (or the same doc for
   everything, or a doc per layer).

## What this dissolves

The `sketchy:layout` registry, `@layouts.*` complements, layout switchers as
separate tools, chrome-part toggles + "this sketch / just me" scope, modes.
(All removed or being removed 2026-07-02.)

## Migration sketch (pending approval)

- **Content**: no data move — existing `.sketch` docs are re-understood as the
  sketchy doc. The folder's link stands. Persisted names stay per the Names
  table (`sketch` datatype, `.sketch` field; ".sketchy" is how we talk).
- **Container types**: the canvas is the only container type initially; the
  dormant list/grid/dock files return later as in-view container types.
- **User layers**: the top-layer user-state doc grows real layer definitions;
  the layer strip shows doc layers + your layers.

## Consequences of "the component only knows what it's told"

- A LAYER is an input: `{ id, name, kind/transform, items-opstream }` — the
  component composites however many it's handed. "Doc layers" vs "user
  layers" is purely which document the tool derived each from; the component
  never distinguishes them.
- The CONTAINER TYPE is an input value (with the tool supplying the default);
  where a switcher UI lives is a tool/chrome question, not a component one.
- Chrome-as-items falls out: the tool seeds chrome items into whichever
  layer-source it wired as "yours".

## Consolidation plan (the muddled-concepts list, sequenced)

Three rings, by how much concept-approval each needs. Ring 1 is mechanical
(no doc-model or concept change — buildable now). Ring 2 items are DECIDED
INSIDE this redesign, not piecemeal. Ring 3 items each get their own short
design section here before any code.

### Ring 1 — free-standing unifications (mechanical, no approval gate)
1. **Sticky subsumes anchors** — migrate-on-read `anchor` → `sticky`
   (corners = edge + corner `t`), delete the anchor write paths. One
   positioning system.
2. **Palette entries become THE model** — `config.brushes` becomes a
   read-shim (normalize-on-read); writes always `entries`.
3. **One catalog** — `partsCensus` is the single source of "placeable
   things"; the + menu and place brush consume it.
4. **State-home principle, stated and enforced** — device state (camera,
   debug) in localStorage; person state (brush config, chrome placement,
   flap open/closed) in the top-layer user doc. Write the rule into
   CLAUDE.md; audit call sites to conform.
5. **Undoability principle, stated and enforced** — user intent is
   undoable; derived/measured state (auto-size, view persistence) is not;
   per-viewer state never is. One paragraph + a conformance sweep.
6. **One peer store** — a single presence source of truth; `context.peers`
   and the share mesh derive from it.

### Ring 2 — settled inside THIS redesign (blocked on the open questions)
7. **`docs[]` vs `items[]`** — RESOLVED IN PRINCIPLE (chee, 2026-07-03):
   both persist, because they're different facts — `docs[]` is the FOLDER
   CONTRACT (the interop that makes sketchy a folder viewer) and `items[]`
   is sketchy's content. The component never knows: the TOOL composes
   folder-doc + sketchy-doc into ONE items opstream (a lens) and hands it
   over. The join's put-side (doc appears → item exists) must converge
   across peers' lenses — deterministic `linkItemId` already provides
   this (pinned collab-safe). So the work is PACKAGING, not migration:
   lift the reconcile/dedupe effects out of Canvas/model into a named
   lens in the adapter's wiring. A bare sketchy doc simply has no docs
   lens input — which also answers the standalone-doc question below.
8. **`sketch` datatype vs folder-viewed-as-canvas** — resolved by
   container-types-as-viewer-property; decide what the datatype means
   (likely: the .sketchy doc shape, not a viewing mode).
9. **`config` split: settings vs content** — content (palette entries,
   LLM prompt, map marks) gets a home consistent with "shapes are part of
   the doc"; settings stay config. Decides undo/share/template semantics
   per field class.
10. **Map marks: one shape** — marks are doc content; the bidi
    shape/pixel streams PROJECT from it; the standalone map reads the same
    shape. The annotation/content distinction stays (two provenances, one
    data shape).
11. **Chrome migration completes** — Properties + PresenceLayer become
    items; the chromePart resolver dies.

### Ring 3 — architectural unifications (own design section each, after Ring 2)
12. **Window unification** — `kind:"doc"` + `kind:"editor"` → one windowed
    item; a patchwork tool is a window with the legacy 1-inlet contract;
    ONE port model (declared inlets and `data-automerge-url` div ports
    unified behind readPort semantics).
13. **Layers are root boxes** — a layer = a root-level frame with a
    transform-kind; the parallel layer machinery dissolves; membership /
    sticky / flaps / clipping compose with layers for free.
14. **Wiring per surface** — graphs legal inside any box (falls out of 13
    if done right; otherwise a deliberate decision to keep root-only).
15. *(optional)* **Seeds as templates** — LAYOUT_SEEDS expressed via
    template instantiation instead of a bespoke DSL in constants.js.

Migration rule throughout: additive only; old fields read forever; never
delete persisted data. Each ring lands as its own reviewable tree state.

## Ring 2 design (DRAFT for chee's review — nothing built)

Concrete shape for Ring 2 items 7–11 + the answered questions above. Every
judgment call is marked RECOMMENDATION. No code has changed.

### 1. The Sketch document format

ONE format. A Sketch doc is:

```
Sketch = {
  "@patchwork": { type: "sketch" },   // new docs; "sketch-layout" read as a synonym forever
  title,
  items: Item[],                      // ALL content — marks, shapes, nodes, wires, AND chrome
  layers: Layer[],                    // the doc's own space stack (defaultLayers() shape)
}
```

- **Chrome is items** (per the answered question): the toolbar palette,
  palette-config, minimap + zoom + their ctx source nodes, the parts flap,
  presence, and (new, §6) properties are ordinary entries in `items[]`, home
  `layers: ["overlay"]`, wired by real persisted inlets (`MINIMAP_INLETS` /
  `ZOOM_INLETS` / `PALETTE_INLETS` conventions, unchanged). There is **no
  `layout` config block** in new docs — `layout.component/tools/properties/
  presence` are read forever on old docs (§8) but never written again; the
  tool set lives where it already does, in the seeded palette-config item's
  `config.entries`.
- **Identity**: datatype id `sketch` forward, `newspace` a registered alias
  forever (both stay in every `supportedDatatypes` — the Names table).
  `@patchwork.type: "sketch"` on new docs; every existing complement carries
  `"sketch-layout"`, which reads as the same thing forever.
- **Two ways in**:
  1. **Natively** — a doc created as datatype `sketch` IS the Sketch; the
     tool opens it directly. A sketchy-native doc never gets a `.sketch`
     field written on it (that's purely the folder bridge).
  2. **Via a folder** — `folder.sketch` (legacy `.newspace`; mirrored
     `@layouts.canvas`) points at a **normal Sketch doc**. The
     `sketch-layout` special type dissolves: what the link targets is just a
     Sketch. The convergence rule stands (LAYOUTS.md §Layout-doc
     convergence): the field is reactive, peers switch to the winning url.
- **Doc-acquisition rule** (replaces the effect at the top of
  brush/canvas.jsx, in order):
  1. `opts.layoutHandle` injected (component mode) → use verbatim.
  2. doc has `.sketch`/`.newspace`/`@layouts.canvas` → follow it, reactively
     (folder bridge + the `.sketch`-on-native legacy, §8).
  3. doc has `items[]`/`layers[]` or is datatype `sketch` with no link → it
     IS the Sketch (native).
  4. plain folder, no link → create a Sketch via the datatype template (§3)
     and write `.sketch` + the `@layouts.canvas` mirror (today's
     `ensureLayoutDoc` write path, kept verbatim).

### 2. The docs-lens

The tool-side join that makes sketchy a folder viewer. It is PACKAGING of
behavior that already exists in brush/canvas.jsx — same semantics, relocated.

- **Inputs**: the folder doc stream and the Sketch doc stream (in tool.jsx
  these are the opstreams sketchy-streams.js already builds).
- **Output**: ONE items opstream the component consumes. The component never
  sees `docs[]`.
- **Put-side, add** (today: the reconcile effect at canvas.jsx ~2320): a link
  appears in `docs[]` with no `doc`/`frame` item for its url → the lens
  **writes a materialized item into the Sketch doc** — `{ id:
  linkItemId(url), kind: isBoxType(link.type) ? "frame" : "doc", url, x, y,
  w, h, rotation: 0, toolId: "" }`, staggered at viewport centre. It writes
  through (persisted), never synthesizes view-only rows — that's what keeps
  old clients and peers seeing the same item.
- **Put-side, remove** (today: `removeItems`, canvas.jsx ~795): removal
  flows **sketch → folder**, not folder → sketch. Deleting the last shape for
  a url (`shouldUnlinkDoc` — alt-drag copies share a url) drops the folder
  link FIRST, sets a 1.5s **tombstone** on the url so the add-side can't
  recreate it mid-race, then splices the item a microtask later. A link
  removed externally (another folder tool) does NOT remove the item — the
  current reconcile is add-only in that direction, and the lens keeps that:
  the item stays, an orphan shape over a still-existing doc. Same behavior,
  same ordering, relocated.
- **Dedupe** (today: the effect at canvas.jsx ~2344): `duplicateItemIds` by
  ID (never url — intentional copies survive), splice high→low.
- **Convergence**: two peers' lenses observe the same `docs[]` addition and
  each write an item with the SAME deterministic id (`linkItemId(url)` =
  `"li-" + url`, model.js); the dedupe pass collapses the doubled push to
  one; array splices merge. Already pinned collab-safe (model.test.js /
  integration.test.js).
- **API sketch** (lives in the adapter's wiring — sketchy-streams.js /
  tool.jsx; runs in the TOOL, per "the component only knows what it's told"):

  ```
  docsLens(folderStream, sketchStream) → { items /* Opstream<Item[]> */, tombstone(url), dispose() }
  ```

  `items` passes Sketch-doc ops through untouched and applies the put-side
  writes above; `tombstone(url)` is exposed so the delete path (still a
  canvas gesture) keeps its timing guarantee. A bare Sketch wires no
  docsLens — the component gets the Sketch's items stream directly.
- **Sub-question — does the Sketch format include `docs[]`?** Both analyzed:
  - *Include it (every sketch is also a folder — the historical shape)*:
    interop win — folder-aware tools can list a native sketch's embedded
    docs; the lens self-joins (folder stream == sketch stream), which works
    but needs echo care; two facts (item.url + link.url) maintained in one
    doc forever.
  - *Strictly the folder contract*: the format stays minimal; the bridge is
    the folder, as the resolution above already frames it; a native sketch's
    embedded docs are items only.

  **RECOMMENDATION: `docs[]` is strictly the plain-folder contract; a native
  Sketch does not maintain it.** (1) The self-join re-couples exactly what
  the docs-as-lens resolution decoupled; (2) migration is lighter — nothing
  new to keep in sync; (3) it's recoverable: `docs[]` can be added to the
  format additively later if folder interop for native sketches turns out to
  matter. Legacy is unaffected: old `sketch`-datatype docs whose `init` wrote
  `docs: []` read forever (§8) — if such a doc has links, the tool wires the
  self-join and it behaves as today.

### 3. Datatype templates

Variants are DATATYPES: same tool + component, different creation-time seed.

- **Registration shape** (registry/layout-tools.js grows entries):

  ```
  { type: "patchwork:datatype", id: "sketch", name: "Sketch", icon: "PenTool",
    async load() { return SketchDatatype } }   // + "pad", … later
  ```

  `SketchDatatype.createDoc(repo)` (async — it may create sub-docs) returns a
  doc seeded `{ "@patchwork": { type: "sketch" }, title, items:
  [...defaultOverlayItems(), partsFlapItem(...)], layers: defaultLayers() }`.
  Because createDoc has the repo, the parts flap's folder+layout pair
  (today's async `seedPartsFlap`, which had to run from the root canvas)
  moves to creation time. A **pad** datatype seeds differently: a pen-only
  palette (`entries: [pen, eraser]`), no minimap/zoom/parts/presence — what
  `opts.minimal` + `SketchpadTool` hack in today is just a smaller template.
- **What happens to `ensureLayout`/`upgradeCanvasLayoutDoc`**:
  - **Remain legitimate**: healing missing fields on OLD docs (`items`,
    `layers` absent), the dismissal-respecting seed pass (it's a no-op on
    templated docs — their items exist; `dismissedSeeds` already
    distinguishes "user deleted it" from "old doc never had it"), the
    null-tombstone-aware inlet/anchor rewires for pre-existing seeds, the
    palette-customization preservation, and the `.sketch` + `@layouts`
    mirror writes. `seedPartsFlap` stays for old docs.
  - **Die**: seeding as the way NEW docs get chrome; the `LAYOUT_SEEDS` /
    `DEFAULT_LAYOUT` DSL in brush/constants.js as the source of truth —
    the seed content moves into datatype templates (this absorbs Ring 3
    #15, per the answered question). `ensureLayout` demotes from "the
    thing that makes a sketch a sketch" to a back-compat healer.
- **Seeds as template content**: `defaultOverlayItems()` (ctx-mm, minimap,
  ctx-zoom, zoom, palette-config, palette, presence) + the parts flap +
  properties (§6) are the default Sketch template, verbatim — same stable
  ids (SEED_IDS), same wires, now written by `createDoc` instead of first
  open.

### 4. The config split (settings vs content)

- **The rule**: a node-config field is **content** when it holds something a
  person authored or arranged — palette `entries`, the LLM `prompt`, map
  marks, template text, js code, a raw `value`. It is a **setting** when it
  parameterizes how the node runs or renders — delay/throttle ms, the map's
  view (center/zoom), clock format, buffer size.
- **What each class implies**: content is undoable (history diffs include
  it), is what a datatype template meaningfully seeds, and is the natural
  unit of sharing/copying. Settings are still shared + persisted (they live
  in the doc) but are excluded from undo (a nudged delay-ms must not occupy
  an undo step) and carry no template weight beyond defaults. Per-viewer
  state is NEITHER — it stays in the top-layer user doc / localStorage
  (Ring 1 #4/#5 principles).
- **Minimal representational change — a registry convention, not a doc
  migration**: both classes stay exactly where they are, in `item.config`.
  The split is metadata on the descriptor's `params` (editors.js):
  `{ name, type, schema?, default?, kind: "content" | "setting" }`, default
  `"setting"`. History (`snapshotItems`/`diffCommand`) and template copying
  consult it. Argument: the fields already converge, sync, and read
  correctly today; moving content fields to a different home would be a
  migration with no behavioral payoff, would break old clients reading
  `config.*`, and the two behaviors that differ (undo granularity, template
  semantics) are exactly the ones a registry flag can decide.
  **RECOMMENDATION**: the flag, no data move. (Map marks are the one
  exception with a real new home — §5 — because they're spatial content,
  not a config value.)

### 5. Map marks as doc content

The one-shape resolution (Ring 2 #10):

- **Where marks live**: ordinary `stroke`/`shape` items in the containing
  Sketch's `items[]`, `parent: <mapItemId>`, geo-local coords — exactly the
  existing annotation-parenting convention (model.js
  `annotateItemIntoBox`: points are `[lng, lat, pressure]`, a shape's `h`
  typically negative). Nothing new in the item model; the map stops being a
  private store.
- **The bidi shape/pixel streams become projections**: the map node's two
  outlets project from `items.filter(it => it.parent === mapItemId)` — a
  lens over the items opstream, not a parallel `marks` array
  reconciled by hand (map-node.js `reconcileMarks`/`persistMarks` collapse
  into the lens's put/get). The standalone map tool reads the same shape.
- **`config.marks`: read forever, additive**. The mount merges legacy
  `config.marks` (and pre-marks `config.strokes` polylines) into its render
  set exactly as it does today; new drawing writes parented items; old docs
  are never rewritten. An old client sees its old marks; a new client sees
  both.

### 6. Chrome migration completion

- **Properties** becomes a `sketchy:window` (editorId `"properties"`) + a
  seeded item `ns-properties` — overlay home with a canvas membership
  (usable while drawing), sticky on the left edge, reading
  selection/brush from the canvas context (the same convention as the
  presence bar's auto-wired `peers`). The panel body is the existing
  `paramDefs`-driven UI, unchanged.
- **PresenceLayer** (peer cursors/views/follow) becomes a `sketchy:window`
  (editorId `"presence-layer"`) + a seeded item `ns-presence-layer`:
  viewport-filling, `pointer-events: none`, reading `peers` +
  camera from the context. The presence BAR (`ns-presence`,
  presence-node.js) already exists — this completes the pair.
- **What dies**: the `chromePart` 3-tier resolver (canvas.jsx ~2503) and
  the `layout.properties`/`layout.presence` toggles. Back-compat mapping in
  the §3 healer: an old doc with `layout.<part> === false` gets the
  corresponding seed id appended to `dismissedSeeds` (additive) so the old
  "off" survives as the new "deleted"; the `layout` field itself is never
  deleted. The per-viewer `chrome[part]` tier is dropped (user override is
  deferred, per the answered question); the top-layer field is never
  deleted, just no longer read.
- **The default template seeds**: `defaultOverlayItems()` +
  `propertiesSeedItem()` + `presenceLayerSeedItem()` — both dismissable
  like any seed (added to SEED_IDS).

### 7. Container types v1

- **Canvas is the only container type initially.** No registry churn needed
  on day one; the `sketchy:layout` registry's canvas entry is the seed of a
  future `sketchy:container` registry (rename when a second type lands).
- **The input**: per the answered questions, the container type is an input
  VALUE with a tool default — concretely `containerType` in the component's
  opts (`"canvas"` default from the `sketchy` tool; in component mode it
  rides the existing opts/config channel of sketchy-streams.js). NOT
  persisted on the doc, NOT a registered tool per type, NO per-type
  complement docs. In-view switching is a chrome/tool question; when a
  switcher lands, the chosen type is person state → the top-layer user doc
  (state-home principle).
- **How list/grid/dock return**: each dormant file (list-tool.jsx,
  grid-tool.jsx, dock-tool.js — kept on disk as reference) becomes a
  container-type module: `{ id, name, icon, mount(items, ctx) → cleanup }`
  receiving the SAME items opstream + context the canvas gets, laying the
  same content out its own way. The canvas complement (positions) is
  untouched while you're in list — the constant-complement property from
  LAYOUTS.md holds. (Dock's split/tab tree needs a home when it returns —
  its own short design note then; likely items, not a complement doc.)

### 8. Migration table (additive-only)

Every field read forever; nothing persisted is ever deleted.

| field | old meaning | new docs write? | read |
|---|---|---|---|
| folder `.newspace` | original layout link | no | forever (alias of `.sketch`) |
| folder `.sketch` | canvas complement link | **yes** (folder bridge — old clients converge on it) | forever, wins for canvas |
| folder `@layouts.canvas` | mirror of `.sketch` | **yes** (kept) | forever |
| `@layouts.{list,grid,dock}` | per-layout complements | no (container types need none) | forever if present |
| `@patchwork.type: "sketch-layout"` | the complement's type | no — new docs write `"sketch"` | forever, synonym of `sketch` |
| `.sketch` on a native `sketch`-datatype doc | today's ensureLayout gave EVERY opened doc a complement | no (fresh createDoc is single-doc) | **forever** — an existing native sketch with a complement keeps opening THROUGH it (acquisition rule 2 beats 3) |
| `docs: []` on a `sketch`-datatype doc | the historical init | no (per §2 recommendation) | forever; links present ⇒ the tool wires the self-join |
| `items[].layer` | legacy single home | mirrored for non-base homes (kept, LAYOUTS.md) | forever |
| `config.brushes` | palette id list | no (writes `entries` — Ring 1 #2) | forever |
| `config.marks` / `config.strokes` | map's private marks | no (parented items — §5) | forever, merged |
| `layout.{component,tools}` | shared chrome config | no | forever (ignored once chrome is items) |
| `layout.{properties,presence}` | chrome toggles | no | once, by the healer → `dismissedSeeds` |
| `layout.modes`, `toolbar: true`, `customParts`, top-layer `chrome[part]`, `flaps[id]` orphans | removed experiments | no | never again — and never deleted |
| `dismissedSeeds` | don't re-seed deleted chrome | **yes** (still the deletion record) | forever |

**Upgrade passes that remain**: the §3 healer (field healing, dismissal-aware
seeding for pre-template docs, null-tombstone inlet/anchor rewires, palette
preservation, the toggle→dismissedSeeds mapping), `seedPartsFlap` for old
docs, the `.sketch`/`@layouts` mirror writes, `migrateStorageKey`.

**What new docs write**: `{ "@patchwork": { type: "sketch" }, title, items:
[template seeds], layers: defaultLayers() }` — no `layout`, no `docs`, no
`.sketch`.

### 9. Sequencing (each step independently landable + testable)

1. **docs-lens extraction** — lift the two reconcile effects + the
   tombstone/unlink ordering out of canvas.jsx/model call sites into
   `docsLens` in the adapter wiring; Canvas consumes one items stream.
   Behavior-preserving. Pinned by: model.test.js + model-extra.test.js
   (linkItemId, duplicateItemIds, linksNeedingItems, shouldUnlinkDoc,
   itemPresent), integration.test.js + harness.test.js (two-peer
   reconcile); add one lens-level two-peer convergence test.
2. **Native-Sketch open path** — the four-step acquisition rule in §1;
   rule 3 is the only new branch. Pinned by: brush/ensure-layout-doc.test.js
   (creation/mirror/convergence); add a native-doc open test.
3. **Datatype templates** — `createDoc` seeding (incl. the parts flap);
   `ensureLayout` demoted to the healer. Pinned by:
   brush/constants.test.js + ensure-layout-doc.test.js (seed idempotence,
   dismissedSeeds, palette preservation — these keep passing against the
   healer).
4. **Chrome completion** — properties + presence-layer as seeded windows;
   chromePart removed; the toggle→dismissedSeeds healer mapping. Pinned by:
   canvas-chrome.test.js, chrome-exports.test.js; add the mapping test.
5. **Config split flag** — `kind: "content" | "setting"` on params; history
   filtering. Pinned by: history.test.js (undo diffs), brush-host/params
   tests; add one settings-not-undoable test.
6. **Map marks** — parented-items projection + the legacy `config.marks`
   merge. Pinned by: map-node tests, sketchy-streams.test.js.
7. **Container-type input value** — plumb `containerType` through opts /
   sketchy-streams; no behavior change (canvas only). Pinned by:
   automerge-doc-over-port / port-opstream tests (the opts channel).

Steps 1–2 unblock everything else; 3–7 are order-independent after them.
Safety rail throughout: the full vitest harness (~1160 tests) stays green.

## Open questions (need chee's call before building)

a. ~~Chrome seeds shared or personal?~~ ANSWERED (chee, 2026-07-03), and it
   went deeper than the question:
   - **One document format: the Sketch** — items, layers, AND the
     palette/chrome info, shared, in the doc. A sketchy-native doc never
     has a `.sketch` field — that's purely the FOLDER bridge, and what a
     folder's `.sketch` links to is just a normal New Sketch document
     (the "sketch-layout" special doc type dissolves).
   - **Variants are DATATYPES, not tools** — a "pad" is a datatype: same
     tool + component, different document TEMPLATE (what createDoc seeds:
     which palette, which chrome items). Seeding moves from open-time
     `ensureLayout` upgrades to creation-time templating (absorbing ring
     3's "seeds as templates" into this redesign).
   - **User override: deferred** — shared-in-doc now; a personal
     layer/override story later.
   - Axes, now orthogonal: datatype = shape + seeded content; container
     type = how a viewer lays content out; tool = the adapter wiring docs
     into the component and picking defaults.
   - Sub-question SETTLED (chee, 2026-07-03): **sketchy stops being a
     folder for now** — the Sketch format does NOT include `docs[]`.
     The one-codepath instinct ("always let docs[] be in the root so
     other folder tools can load it") is real but it's a SYSTEM problem:
     Patchwork should let a doc declare a LENS over itself to the
     folder-shape, so any doc can present as a folder without carrying
     the field. Parked as a host wishlist item. Folder viewing stays the
     `.sketch` bridge + docs-lens. Existing sketch docs with `docs[]`
     read forever (additive rule).
b. ~~When a sketchy tool opens a bare sketchy doc directly (no folder), is
   `docs[]` simply empty/absent, or is folder-linking a required shape?~~
   ANSWERED by the docs-as-lens resolution above: no folder → the tool
   wires no docs lens → the component is none the wiser. `docs[]` is the
   folder contract, not a required part of the sketchy shape.
