# Layouts, lenses, and the complement — can a folder be a canvas AND a dock AND a list?

> A hot reference — src comments point here (layouts.js, layout-switch.js,
> list-tool.jsx, grid-tool.jsx, dock-tool.js, index.jsx, brush/constants.js),
> so it stays its own file. The wider design rationale is
> [ARCHITECTURE.md](./ARCHITECTURE.md) (layouts are §4 primitives); open
> layout work is tracked in [TODO.md](./TODO.md).

> Your question: can we add a **dockview** layout that loads as the root of a sketchy
> (keeping the sub-doc affordances)? Can we **switch layouts** while keeping the same
> documents (a lens?) and **display the complement**? Can a user build a tiling WM /
> patchwork-frame and use it as their main view? Can someone else view the same folder
> as a **canvas**, and someone else as a **list** — and *know what they're not seeing*
> because it's in the complement, unused?

**Short answer: yes — this is exactly what the architecture is for.** It's the whole
reason "layout" and "complement" are first-class. The pieces are in place
conceptually; the work remaining is to *generalize the layout* (today the canvas is
the only, hardcoded one) and to *split the per-layout complement* off the folder.

## The model

- A **folder** is the shared document: `{ title, docs: DocLink[] }`. The `docs` are
  the nouns — the things that exist. This is what syncs between people.
- A **layout** is a *lens over the folder* that decides how those docs are presented.
  Each layout carries its own **complement**: the layout-specific data that the folder
  itself doesn't hold.
  - **canvas** (today) → a `sketch-layout` doc (referenced from the folder as
    `.sketch`; was `.newspace`, migrated): `items[]` with x/y/w/h, rotation,
    z-order, frames, ink, editor wiring, plus `layers` (the coordinate-space
    stack) and `layout` (the shared chrome config). *That is the canvas's
    complement.*
  - **dock / tiling** → a dock layout doc: a split/tab tree of pane → doc.
  - **list** → little or no complement (just order, maybe).
- A **surface** is a doc placed in a layout. Crucially, a surface's affordances —
  its editor, its opstream, its wires — are independent of the host layout. The same
  doc is the same surface whether it's a canvas box, a dock pane, or a list row. So
  **the sub-doc affordances are preserved across layouts for free.**

So a layout = `lens.get(folder, complement) → presentation`, and edits flow back via
`lens.put`. The folder is the constant; the complement is what each lens adds.

## Layers and membership

A sketch's layer stack (layers.js) is an ordered list of coordinate SPACES. An
item relates to that stack through **`layers: string[]`** (model.js
`itemLayers`/`itemHomeLayer`):

- **`layers[0]` is the HOME space.** It owns the item's coordinates and
  transform — semantically what the old single `layer:` field meant. The home
  decides which `.ns-layer` container renders the item: one DOM node, never
  two.
- **Every further entry is a pure MEMBERSHIP.** Memberships never move or
  re-project anything — they drive VISIBILITY. An item shows iff its home
  layer sits at or below the ACTIVE layer in the stack (lower layers keep
  rendering, frosted, under the active one), or its memberships include the
  active layer (model.js `itemVisibleForActive`). So an overlay-home widget is
  hidden while the canvas tab is active unless it was given a canvas
  membership (the Properties "appears on" row) — that's how the seeded
  toolbar-palette stays usable while drawing. Hidden = `display:none` with the
  DOM kept (live embeds survive; nothing hidden can be hit or clicked).
- **Reading is back-compat and additive:** `layers` wins; else a legacy
  `layer: "x"` reads as `["x"]`; else `["canvas"]`. Writers never delete the
  legacy `layer` field. New items write `layers: [<active layer>]`, and mirror
  `layer` to a non-base home (base was the untagged default) so old clients
  keep placing the item in the right space. Membership edits (the Properties
  "appears on" row) rewrite only `layers`.
- **Future per-layer placement:** a `layers` entry can later grow into
  `{ id, x, y }` without a model break — `itemLayers` already normalizes
  object entries to their id.

(A "modes" experiment — workshop/play visibility presets over these
memberships — was removed 2026-07-02. Existing docs may still carry a
`layout.modes` field; it is ignored and never deleted.)

**Flaps** (2026-07-02): a `flap: true` FRAME is a named sticky container
placeable on any layer — full frame containment (its own folder+layout
sub-space, drops in/out, clipping), except that while STUCK it collapses to an
edge TAB; clicking the tab opens it as a drawer, and open/closed is PER-VIEWER
(the top-layer doc's `flaps[id].open`, not shared). The parts bin ships as the
seeded "parts" flap (`ns-parts`), its window parked inside as a plain item.

## Layout-doc convergence

The folder references its canvas complement by URL (`folder.sketch`; `.newspace`
back-compat). If two peers open the same folder for the first time
simultaneously, each creates a layout doc and writes the field; the CRDT
resolves the race last-write-wins, so the field converges to ONE url. The
canvas must therefore treat the field as reactive and SWITCH to the winning doc
when it changes — every peer has to end up on the SAME layout doc. A canvas
that kept its own losing doc would look shared (each peer placing items
independently) while config/value writes silently went to different docs —
"sharing doesn't work". The doc-acquisition effect at the top of
`brush/canvas.jsx` implements the switch.

## Your questions, point by point

**Dockview as the root of a sketchy, keeping sub-doc affordances?** Yes. A dockview is
just another `layout` (lb's `Layout` contract: `{element, place, remove, restore,
save, focus, name?}`), hosted by the same plugin shape that hosts the canvas. The
docs it places are the same surfaces (patchwork-views / `sketchy:editor`s), so wiring,
opstreams, the Inspector, follow-mode, etc. all still work inside it.

**Switch layouts while keeping the same documents (a lens) and show the complement?**
Yes. Switching layout = switching which lens you open the folder through. The folder
(the docs) is untouched; you swap the complement you're viewing. And because the
complement is **explicit and retained**, the previous layout's data isn't lost when
you switch away — it's the complement, sitting there, recoverable. (This is the
constant-complement property: `put(get(s), complement(s)) === s`. The list lens drops
the positions; the positions remain as the complement; switching back to canvas
restores them exactly.)

**Build a tiling WM / patchwork-frame and use it as your main view?** Yes. A tiling
layout is a `layout` plugin like any other. Once registered, a user picks it as the
folder's view. It composes with the same surfaces + wire affordances — you could even
wire a doc's field into a pane, or follow someone, inside your tiling WM.

**Two people, same folder, one canvas + one list, simultaneously?** Yes. The folder
docs sync; each layout's complement is a *separate* doc. So your canvas complement and
my list-order complement are different docs over the same folder — we edit the shared
docs together in real time, each through our own lens. (A folder can also have a
*default* layout, but the lens is fundamentally a per-viewer choice.)

**The list viewer KNOWING what they're not seeing (the unused complement)?** Yes —
and this is the payoff of making the complement first-class instead of hiding it. The
list lens's `get` drops the canvas's positional complement. Because that complement is
named and retained, the list view can *show it*: "this folder also has a **canvas
layout** (positions for N of these docs) and a **dock arrangement** you're not seeing
here." The view is honest about what it's hiding. You're never silently missing data —
the complement is visible *as* complement.

## What's actually built vs. what's needed

Built / proven:
- the **canvas as one layout** (folder doc + the `.sketch` complement doc), with
  surfaces that carry their own editors/opstreams/wires;
- **opstreams with an explicit complement** that passes through lenses (the mechanism);
- the **two-doc split** (folder = docs; `.sketch` = the canvas complement) — already
  the "folder + per-layout complement" shape;
- the folder referencing **multiple** complement docs (`@layouts: { canvas: url, … }`,
  `ensureLayoutDoc(repo, fh, key)` in brush/constants.js), migrated additively from
  the single `sketch: url`.

**Status 2026-07-02: the list, grid, and dock layouts (and the pad tool) are
UNREGISTERED.** How container types, layouts, and chrome relate is being
rethought — the concepts as shipped were wrong (see TODO.md). The list/grid/dock
sources and the shared switcher stay on disk, dormant (list-tool.jsx,
grid-tool.jsx, dock-tool.js, layout-switch.js), and the `sketchy:layout`
registry still exists with the canvas as its one entry. This document's Q&A
above describes the direction, not the current registrations.
