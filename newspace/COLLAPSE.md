# PLAN — the collapse: one box, a few pluggable dimensions

Audience: a capable model picking this up cold. Read first: `CLAUDE.md`
(operating manual), `PLAN.md` (**rules of engagement — chee owns git; you NEVER
commit/push; migrations additive-only; suite + build gate every step**),
`CONTAINERS.md` (the rings this sequences), `NODES.md`, `LAYOUTS.md`, memory at
`~/.claude/projects/-Users-chee-soft-inkandswitch-patchwork-tools/memory/`.

**This is a REDUCTION plan, not a feature plan.** Its goal is to make Sketchy
smaller in bytes AND in conceptspace *without losing malleability* — by
collapsing duplicated machinery into ONE model. Every step should **delete more
than it adds** (see §Scoreboard). It is design-first: the Ring-3 collapses need
chee's explicit yes on their design section before code (marked ⛔ below);
the rest live inside already-agreed redesigns.

---

## The endpoint (what everything collapses toward)

There is **one noun — a box** — rendered from **one items opstream**. A box fills
a few pluggable **dimensions**; every current "kind of thing" is just a box with
different dimensions set:

| dimension | what it decides | registry / seam today | instances |
|---|---|---|---|
| **transform-kind** | how the box's local space maps into its parent | `box-transform.js`, `transformKindOf`, layer-transform/-kind | translate (default), rotate (frame), reproject (map) |
| **container-type** | how the box lays out its CHILDREN | *(new)* `sketchy:container` (seed of the old `sketchy:layout`) | canvas (spatial, default), list, grid, dock |
| **membership** | which spaces the box appears in + sticky placement | `layers[]`, `sticky`, `parent` | canvas / overlay / a flap / a frame |
| **content role** | what the box renders as | `kind`, `sketchy:surface`, brushes | window (tool/editor/doc), mark (stroke/shape), pure container |
| **wiring** | inlets/outlets — a box can be a node | ports, `readPort`, wires | any box |
| **flap** | collapse-to-edge-tab + per-viewer open state | `flap:true`, top-layer `flaps[id]` | parts bin, set-aside |

Layers, frames, windows, chrome, the map, and the aside are **not separate
systems** at the endpoint — they're boxes with these dimensions filled in. The
component renders the box tree from the opstream and knows nothing else.

**The test for "did this keep malleability?"** After each step, a third-party
tool must STILL be able to: wire the component from arbitrary docs; contribute a
new transform-kind / container-type / window / brush via a registry; and nest/
wire/transform any box uniformly. Collapses that widen this pass. Collapses that
hardcode a list, delete a registry, or bake policy into the component FAIL —
keep the extension seam, delete only the duplicated implementation behind it.

---

## Scoreboard (how we know it's working)

Track per landing, in the commit body:

- **nouns**: the count of distinct "kinds of thing" a contributor must learn
  (data path, window kind, layer-vs-box, chrome-part-vs-item, positioning
  system…). Target: strictly down.
- **bytes**: net LOC. Each step should be **net-negative** (deletions >
  additions) or explain why not. `brush/canvas.jsx` is ~3532 lines today; the
  Tier-1 collapses are where the big deletions live.
- **seams**: registries / extension points — target: **flat or up**, never
  down. (If a step reduces seams, it's probably the bad kind of reduction.)

---

## Track A — the collapses (ordered; each its own suite+build-gated landing)

Ordered so each step removes special-casing the next one would otherwise have to
navigate. Steps 0–2 are within agreed redesigns; 3–4 are Ring 3 (⛔ need chee's
design yes first); 5 is cleanup.

### 0. One data path — the component consumes streams only  *(in flight)*
The root docs/items join now runs through the opstream `docsLens`. Framed here
as **deletion**: when the component only ever consumes opstreams, delete
`docHandleFromOpstream`, the
handle-dressing in `automergeDocOverPort` (`sketchy-streams.js`), the
`__fromOpstream` branch of `surface-doc.js`, `makeSketchyTool`'s direct-handle
path (`tool.jsx`), and `createDocsLens` (`docs-lens.js`, keep only the opstream
`docsLens`). **Nouns −1** (handle-or-stream question gone). **Bytes −−.**
Malleability ↑ (any source backs the component). Gate: full suite + browser
(two tabs). *This unblocks the rest — the box tree comes from one stream.*

### 1. Chrome-as-items completes  *(CONTAINERS Ring 2 #6/#11)*
Finish what's mostly done (minimap/zoom/palette/parts/presence-bar are already
items — TODO.md). Make **Properties** and **PresenceLayer** seeded `sketchy:surface`
items; **delete the 3-tier `chromePart` resolver** (`brush/canvas.jsx` ~L2483)
and the `layout.{properties,presence}` toggles (old "off" → `dismissedSeeds` in
the healer, additive). **Nouns −1** (chrome-part is no longer a thing distinct
from an item). **Bytes −.** Gate: `canvas-chrome.test.js`, `chrome-exports.test.js`.
*Set Aside rides this — it's just another seeded box.*

### 2. Container-type is a dimension, not a tool  *(CONTAINERS Ring 2 #7 + §7)*
Establish the **container-type** dimension: a box renders its children via a
pluggable child-layout function chosen by `container` (default `canvas`).
**Set Aside (list) is the first instance**. Generalize it:
`list-tool.jsx` / `grid-tool.jsx` / `dock-tool.js` stop being
tools and become container-type modules `{ id, name, icon, layout(children,ctx) }`
over the SAME items stream; delete `layout-switch.js` and the per-layout tool
registrations / complement docs. Rename the dormant `sketchy:layout` registry to
`sketchy:container`. **Nouns −1** (no "layout tool"). **Bytes −** (dead tools
deleted). **Seams +1** (a clean container registry). Gate: container-type units +
the Set Aside browser checks.

### 3. ⛔ Window unification — doc + editor → one windowed box  *(Ring 3 #12)*
Needs a design section in CONTAINERS.md + chee's yes. Collapse `kind:"doc"` and
`kind:"editor"` into ONE windowed box with ONE port model (declared inlets and
`data-automerge-url` div ports unified behind `readPort` semantics; a patchwork
tool is a window with the legacy 1-inlet contract). **Nouns −1** (one window
kind). **Bytes −** (one render/port branch). Gate: window + port-opstream tests;
browser (embed a tool + an editor, wire both).

### 4. ⛔ Layers are root boxes — the capstone  *(Ring 3 #13, and #14 falls out)*
Needs a design section + chee's yes. **The single biggest conceptspace collapse.**
A layer = a root-level box with a transform-kind; the parallel layer machinery
dissolves — `itemLayers`, `layers[]` membership special-casing, the
layer-transform/-kind registries folding into `box-transform.js`, and the
hardcoded `"canvas"` base (`model.js` `itemLayers` fallback — make "the base
layer" stack-relative, not a literal). Membership / sticky / flaps / clipping
then compose with layers for free, and **wiring-per-surface (#14) falls out** —
graphs legal inside any box because a layer is just a box. **Nouns −2** (layer
system + the base-layer literal). **Bytes −−** (a whole parallel machinery).
Malleability ↑↑ (a layer is now as nestable/wireable/transformable as any box).
Gate: `layer-membership.test.js` + a broad suite; heavy browser verification
(draw across layers, sticky, flaps, clipping, wiring inside a frame). *Do last:
the earlier steps remove the special-casing that would otherwise fight this.*

### 5. Cleanup — collect the dividends
- Delete dead files: `flaps.jsx` / `flaps.test.js` (superseded), `NewspaceTool`
  (unregistered, `tool.jsx`), tool.jsx's dead handle path (after step 0).
- Drop the read-forever `layout.*` read paths (`rootLayoutDoc().layout?.tools`,
  etc.) **once clients have shipped everywhere** (mixed-version safe until then —
  see PLAN.md's churn note).
- Re-check the registries: if several tiny ones (`sketchy:surface`,
  `sketchy:brush`, `sketchy:container`, transform-kind, layer-kind) are now
  identical `getRegistry(type)` shapes, unify the *plumbing* (one registry
  keyed by type) while keeping each type as its own seam. **Seams flat, bytes −.**

---

## Track B — one-mechanism-not-two  *(mechanical; interleave anytime)*

These are `CONTAINERS.md` Ring 1/2 items — no design gate, each a small
net-negative landing. Do them whenever they're in the way; they shrink the
special-casing the Track-A collapses navigate.

- **Sticky subsumes anchors** (Ring 1 #1) — migrate-on-read `anchor` → `sticky`;
  delete anchor write paths. One positioning system. **Nouns −1.**
- **Palette entries are THE model** (Ring 1 #2) — `config.brushes` / id-lists
  become read-shims; writes always `entries`. **Nouns −1.**
- **One catalog** (Ring 1 #3) — `partsCensus` is the single "placeable things"
  source; the + menu and place brush consume it. **Nouns −1.**
- **One peer store** (Ring 1 #6) — `context.peers` + the share mesh derive from
  one presence source. **Nouns −1.**
- **Config split as a registry flag** (Ring 2 #4) — `kind:"content"|"setting"`
  on params; NO data move (content = undoable + template-weighted). Decides undo/
  template semantics with metadata, not a migration.

---

## Guardrails (the reductions NOT to make)

- **Keep the tool/component split** — it IS the malleability. The component
  stays "knows only what it's told"; the tool stays the wiring.
- **Keep every registry as a seam** — brushes, windows, container-types,
  transform-kinds, datatypes. Unify their *plumbing* if identical; never their
  *extensibility*.
- **Keep the opstream wiring** — nodes/inlets/outlets are raw
  `stream.connect(cb)` + plain DOM (memory `opstream-processing-raw-callbacks`),
  NOT re-frameworked.
- **No hardcoded lists** where a registry exists; no policy in the component.

## Verification

happy-dom can't exercise the port/merge path, rects, pointer-events, or Leaflet.
Steps 0, 3, 4 and the Set-Aside gestures need a **browser check from chee**
(backtick op-debug overlay; draw / embed / delete / drag-aside / two-tab
convergence / wire-inside-a-frame). Diagnose in code first; ask for a console
probe when the harness can't see it.

## Recording as it lands

Update CONTAINERS.md (mark each ring item collapsed, and add the "box +
dimensions" endpoint at the top as the thing the rings converge on), TODO.md
(reconcile the flap/container/layer items), and memory. The docs being
trustworthy is a feature chee values.
