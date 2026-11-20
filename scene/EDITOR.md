# The editor

The editor is view plugins the scene package ships (`src/parts/`), on the
kernel's public api ([STAGE.md](STAGE.md)); the boundary test
(`src/native/boundary.test.js`) keeps them off its internals. This page is what
they do and the conventions packages meet them by: commands, traits described,
drops, templates and parts. An **edit** is the editor's write
(`src/parts/editor.js`): undoable, this viewer's, in the focus doc.

| Plugin | Is |
|---|---|
| `scene.edit` | the Edit hand: picked up and put down; its click selects |
| `scene.select`, `scene.others` | the selection (Select, Remove, the box); everyone else's boxes (an extension of every doc) |
| `scene.keys`, `scene.use`, `scene.menu`, `scene.touch` | the key map; the use prompt; the context menu; the touch controls |
| `scene.toolbar`, `scene.body`, `scene.clock-chip`, `scene.packages` | the bar of tools; the body chip, Edit, who's here, the Esc hint; the clock chips; the packages prompt |
| `scene.inspector` | the one pane: the outline (`outline.js`) and the selection's fields |
| `scene.halo`, `scene.handles`, `scene.dimensions`, `scene.measure` | Move (`V`), a tool, and while it's held the selection's move, rotate and scale handles (in the parent's drawn frame, one write on release) and knobs; dimensions; Measure |
| `scene.frame`, `scene.autoframe`, `scene.grid`, `scene.axes`, `scene.bounds`, `scene.units`, `scene.legends` | the view's aids |
| `scene.add`, `scene.transfer`, `scene.parts`, `scene.undo` | drops; copy and paste; the parts bin; Undo and Redo |

## The Edit hand

`scene.edit`'s, an ordinary hand of kind `edit` (`api.hand`). The body chip's
Edit runs its `edit` command, and `view.start.edit: true` (the outermost doc's;
a new scene's) picks it up on arriving, else puts it down. While held a click
selects at the focus (on nothing it clears, outside the focus it selects
nothing and goes no further), offered first to a widget's owner under it
(`api.offerWidget`); presses aren't its; it wants the pointer. Its `escape()`
clears the selection, then leaves the entered link. It stays in hand across
Enter and Leave, in any body; a tool can sit over it. A second click on the
same thing within 500 ms and 6 px Opens the selection. **Editing** is
`editing(view)` (`stage/bodies.js`): the editor's chrome (Move, inspector,
toolbar's editor commands, grid, axes, bounds, dimensions, Measure, every
`edit: true` command) shows exactly then (H13). Putting it down puts down every
such tool, wherever it is in the hands, and the selection.

## A command

```js
{ id, name,
  key?: string | string[],    // KeyboardEvent.key values
  show?: string | string[],   // "toolbar", "world", "menu", "inspector", "use"; [] none
  hold?: boolean,             // shown as "hold F"
  reach?: true, edit?: true,
  open?: true,                // the target's Open (below)
  group?: string, icon?: string, order?: number,  // where it sits on the bar (below)
  tool?: { keys?, pointer? },
  state(target, ctx) → null | { title?, label?, checked?, value?, choices?, options?, disabled? },
  run(target, value?, ctx) → void | session | input }   // ctx: api.context(hit)
```

An instance's `commands`, run by the kernel (`api.run`) in the context every
surface passes. **Open** (`open: true`, `src/parts/open.js`) goes into a thing
to edit what's inside, in place: a link's (scene.links'), a package's editor
for its content; a target's Open is the first that applies, and the inspector,
the menu (after Select), the outline (its → and a double-click) and a
double-click in Edit run it; an Open's key is `Enter`. `state` null: not for this target; no `state`: the scene only.
`label` names the verb for this target; `title` is the tooltip, and the reason
when `disabled`; `options` become inspector checkboxes passed as `value`.
**Surfaces**: absent `show` means every surface but `"world"`; keys work
whatever `show` says. **`edit: true`**: only while editing (`inBody`).
**`reach: true`**: beyond the body's reach it is "too far" and runs nowhere
(H9). **`hold`**: a held verb, whose `run` returns `{ end(), cancel(),
update?(dt) }`, kept while the key is down. **`tool:`**: `run` returns an
input, held as the tool (STAGE.md, "Bodies", **Hands**); running it again puts
it down.

### Targets and refs

A target is null (the scene), an object or group id, or a ref `"<kind>:<id>"`
(`"dimension:<id>"`; object ids have no colon). The selection is one target. A
ref's owner answers for it and lets go when its thing is gone. Object-only code
checks `scene.objects[target]`.

## The use prompt and key map

**The key map** (`scene.keys`, the only `input.key`; `src/keymap.js`): a key the
gesture, the hands and the body don't reserve runs the first command whose
`key` matches and that applies to attention's path (the selection, else the
look's hit and what it hangs on, nearest first), then the scene's; within one
target in running order, then command order. With ctrl or meta held a key is the
browser's; an auto-repeat is claimed but not run again; Escape is never a
command's. **A shown key works** (H3): every surface asks `hintFor`, which
resolves a key as it is dispatched. **The use prompt** (`scene.use`) shows
attention's keyed verbs (`show` including `"use"`, or none), up to three, under
the crosshair under lock, else at the pointer; it shows, the key map does. **On
touch** declared keys become pad controls (`src/touch-keys.js`); codes labelled
alike are one control, so distinct actions need distinct labels.

## Undo

`src/parts/editor.js`, `src/undo.js`: the editor records its own writes from
what `change` returns, per person and per focus doc, in the focus stage's
`local.edits`; a package's verb, a clock act or a process save is never one. A
step restores only if the doc still holds all it wrote, else it is dropped and
said; kept objects come back as their keeper has them now. Undo and Redo are
`edit: true`. A package puts its own writes on it with the `edits` service
(`scene.undo`'s): `use("edits").edit(doc, fn, { label })` writes `fn` to `doc`
(`{ url, doc(), change(fn) → patches }`; the patches are what the step takes
back, so a doc leaves out writes that aren't the person's) as one step of this
viewer's in the focus doc; `false`, nothing written, where the focus doc can't
be written here.

## Drops, templates and parts

### Drops

A doc added by drop or paste goes to each extension whose metadata `drops`
takes its datatype (`"*"`: any): its module's `drop(ctx, info)` → boolean (or a
promise of one), until one says true; the
traits it writes start its extension. A drop-only extension declares the marker
trait its layout writes. **The drop context** `ctx` is `{ id, repo, handle,
url, viewer, doc, scene, change, newId, addObject, file, content, worldOf,
registry, local, select, notify }`, made from the focus, its writes one undo
step. `info` is `{ url, doc, handle, group, at }`. Drops, templates, parts and
paste write the focus doc: to add to a linked doc, enter it.

### Templates

`{ type: "scene:template", id, name, icon?, description?, params?: ParamSpec[],
load() → { create(ctx, params) → Promise } }`. The empty scene's start screen
lists every template from metadata, with a form for its `params`
(`src/param-form.js`); `create` gets exactly those (`paramsBySpec`). It writes
objects, traits and `view.start`, and its maker then arrives as the doc says
(`api.view.arrive()`).

### Parts

`{ type: "scene:part", id, name, icon?, category?, description?, tags?, traits?,
load() → { create(ctx, at) → Promise<string | null> } }`. The bin
(`scene.parts`) lists them from metadata; `create` gets `at` = `{ parent,
transform, world }` and may adjust it or make several objects; what it returns
is selected. `ctx.file(key, make)` → `{ url, hint }` is the scene's file doc for
a versioned key (`"sailing/mast@1"`), made once and kept in `doc.assets`. A
dropped part goes under the object hit, snapped to a connector that takes its
`tags` (Alt: free), upright (`src/parts/parts-place.js`); a trait a body reads
(`walk.spawn`) has a part declaring it.

## Copying objects

One copy rule (`src/transfer.js`; `scene.transfer`) serves paste, drops from
another scene, extract and bundle. The payload is `application/x-scene-object`
= `{ scene, id, ids, lift?, copy? }`. In its own scene paste duplicates; in
another it copies the objects and everything under them with new ids, landing
by the parts bin's rule. `claims`, `saved`, `runtime` keys and `copy: "drop"`
fields stay behind. Files are shared; renders are copied with their build. An
`object` reference to a copy follows it, else is kept in the same scene and
cleared in another, with a notice (`copyRefs`, `refEdits`).

## Extract and bundle

The copy rule in two directions (`src/extract.js`), each one host change and
one undo step. **Extract** takes S (tops sharing one parent p), writes doc T
whole (ids and transforms kept), then replaces S with a link to T at p,
clearing references into S; if S changed meanwhile, nothing is written.
**Bundle** copies what a link shows into the host in its place and removes the
link; the linked doc is never written. **K**, the root traits that go along, is
the command's `options`; Bundle refuses a trait the host has.

## Describing traits

`describes` in an extension's metadata says what its traits are, so the
inspector can write them; offering a trait starts nothing; the first describer
wins.

```js
describes: { "<trait>": { name, on?: "object" | "scene" | both, blurb?,
  fields?: ParamSpec[],          // plus kinds object, entry (of: traitKey), url, json
  entries?: { label, noun, prefix, fields, init },   // value is a map of entries
  runtime?: true | string[],     // play state: copies leave it behind
  init? } }                      // a field may also say runtime: true or copy: "drop"
```

Any extension writing play state into a trait must mark it `runtime`. Writes
are field by field; undescribed keys are never touched; readers take a missing
field as its default.

## The interface

- **The toolbar** (`scene.toolbar`): the scene commands of every stage on the
  focus path, focus first: the editor's at the left while editing, `"world"`
  ones at the right in every body. The editor's are in groups, by a
  command's `group`: history (undo, redo), tools (Select, Move, Measure),
  the rest, panels (Inspector, Dimensions, Parts), view (frame, grid, axes,
  bounds) and settings, behind a gear in a popover (units, snap); `order`
  sorts within a group. A command with an `icon` (`src/parts/icons.js`) is
  drawn as it; otherwise a button, toggle (`checked`) or picker (`choices`,
  `value`).
- **The body chip** (`scene.body`): Look, the bodies with `here` not false,
  Leave; **Edit** beside it; who's here in the focus doc, with body and top
  hand; the Esc hint (the layer the next Escape pops).
- **The clock chips** (`scene.clock-chip`): one per focus-path doc with a
  process (its `"clock"` service), ▶ or ⏸, pausing or resuming that doc.
- **The trail** (NATIVE.md, "Links"): the focus path, each a way out, and Leave.
- **The inspector** (`scene.inspector`, `src/parts/inspector-model.js`): one
  drawer pane, the outline on top and the selection below: a header (what
  it is, its name, its Open), **In this scene** (the scene's representation
  of it: placement, display, lock, layers, behaviours) and **Built from**
  (its source as a row, version, the build's summary, Rebuild, Pinned and
  its params as fields). No document is mounted: each is a row with Open
  Editor and Dock. While editing it opens on the first selection and stays
  open.
- **The outline** (`outline.js`): the focus doc's tree; rows select, drag,
  group; a link's row says what it is and enters.
- **The menu** (`scene.menu`): a target's commands with `"menu"` (or none),
  Select first, then the scene's asking for a menu; each key shown by the
  resolver.
- **The packages prompt** (`scene.packages`): one card for every open doc's
  missing packages, each by name and URL, Load or Not now (STAGE.md,
  "Packages"). Only listed URLs load, the card always shows the URL, and a
  URL loaded on a click is remembered (`localStorage`
  `scene-packages:accepted`); a Not now lasts the view's life.

## Invariants

| | Invariant |
|---|---|
| H3 | A shown key works: hints come from the dispatching resolver; each key reaches at most one invocation; a shown touch control reaches its reserver. |
| H9 | A `reach` command runs iff distance ≤ body.reach, else shows "too far". |
| H13 | Editing ⇔ the Edit hand is held: its chrome shows exactly then, in any body; no body changes it; putting it down puts down the selection and every `edit: true` tool, wherever it is in the hands, and no other. |
| I9 | Extract and bundle are each one host change; `bundle(extract(S, K), K)` restores every non-runtime field when S has no edge outside. |
