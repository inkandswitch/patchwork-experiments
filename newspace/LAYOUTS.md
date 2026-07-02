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
- the **`sketchy:layout` registry** (layouts.js + index.jsx): canvas, list, and grid
  are registered descriptors, each pointing at the patchwork:tool that renders it —
  layouts ARE pluggable now;
- the **list + grid layouts** — keyed-reconcile rows/cells over the same folder, each
  with a switcher (`layoutsFor` re-opens the folder through another lens) and each
  **surfacing the canvas complement** (`complementSummary`/`complementBanner`:
  "also a canvas layout … not shown here") — the honest-lens payoff, demonstrated.

Still needed for the full vision:
1. the folder referencing **multiple** complement docs, e.g. `@layouts: { canvas: url,
   dock: url, list: url }`, instead of the single `sketch: url` — switching picks one
   (generalise `ensureLayout` → `ensureLayoutDoc(repo, fh, key)`);
2. a **layout switcher in the canvas chrome** (list and grid have one; the canvas
   doesn't yet);
3. the **dock / tiling** layouts themselves;
4. dock (and the canvas) surfacing the other layouts' complements the way list/grid
   already surface the canvas's.
