# The stage and its extensions: the contract

This is the working contract between the scene's core (the **stage**) and
everything that adds to it (**extensions**). [DESIGN.md](DESIGN.md) says why;
this says exactly what. It is plain data and functions throughout. No
extension imports another, and the stage knows no extension by name.

It describes the code as it is: one view per mounted tool and a stage per
open doc; links live, pinned, mirrored and closed; the focus, Enter and
Leave; extract and bundle; what runs (the doc's traits, nothing else) and
in what order input reaches it; the bodies, Look and Edit among them, and
the held tool; the clock; claims, presence and pose holds; packages; the
audience; undo of the stage's own edits. [SCOPE.md](SCOPE.md) is the same
model told from one question, whose a press is.
[TOOLS.md](TOOLS.md) and [COMPOSITION.md](COMPOSITION.md) are the design
notes it was built from, with the reasons, the decisions and the record of
each build step.

## Words

| Word | Means |
|---|---|
| **Stage** | The core, one per open doc: the doc, loading and building object content, presence, claims and pose holds on the doc's channel, the world clock, lenses, the audience, its extensions and the api each gets. It has no UI of its own. |
| **View** | One per mounted tool, shared by every stage it opens: the DOM and edges, the viewport (rendering, picking, the camera rig, drawing layers), the input router with its body stack and held-tool slot, the drawer, the selection and hover (as paths), notices, prefs, and one presence session. Its one opinion about input is the Edit body's: a click nobody else took selects (in Look, nothing does). |
| **Link** | An object whose source is a scene doc (`providerId: "scene.link"`): the view opens a stage for that doc, drawn where the link is, in the link's frame. Live without `at`; a pinned value with it, the doc at those heads. |
| **Mirror**, **pin** | A stage that is drawn and never acts: a mirror, a live doc at a placement other than the one it acts at; a pin, a doc at fixed heads. Both read-only. |
| **Closed link** | A link the view opens no stage for (a cycle, a doc that can't be opened, a live link inside a pin with no heads for it): drawn as its hint. |
| **Focus** | The path of links the viewer has entered (the outermost doc's, `[]`, until **Enter**; **Leave** goes back out one). The selection is always an element of the focus stage, and the general parts run there. The view's alone: no stage sees it. |
| **Extract**, **Bundle** | Extract turns a selection into a doc of its own, linked where it was; Bundle copies a linked doc into its host in the link's place. The copy rule in two directions. |
| **Extension** | A `scene:extension` plugin. Everything a person sees or does beyond a rendered scene and an orbiting camera comes from one. |
| **Template** | A `scene:template` plugin: a way to start an empty scene (an arena level), offered on its start screen. |
| **Part** | A `scene:part` plugin: something to put into a scene (a mast, a buoy, a target), offered in the editor's parts bin. |
| **Surface** | An extension that presents others' contributions (toolbar, menu, key map, use prompt), read with `api.collect(name)`. |
| **Contribution** | A field on an extension's instance that some other extension may collect. The stage reads only the ones listed under "instance". |
| **Invocation** | A command call as a value: `{ ext, command, target, value? }`. |
| **Body** | Where a viewer is in the world and how they move and look: Look or Edit (the stage's own, both the orbit camera, one always at the bottom: `src/stage/bodies.js`), walk (`walk/`), a seat (`seats/`), sailing's `aboard` and `station`. One stack per view; the top one is current, and its eye and reach are what verbs are measured from. Nothing stands on Edit. Contributed as `bodies` (the stage's two aren't). |
| **Look** | The stage's body for looking: the orbit camera, no default press, none of the editor. Where a doc that names no body starts people. |
| **Edit** (body) | The stage's body for editing: the orbit camera whose plain click selects, and the only body the editor's chrome shows in (TOOLS.md §3, "What is Edit's"): the halo and knobs, the inspector, the toolbar, grid, axes and bounds, and every command that says `edit: true`. |
| **Held tool** | One slot per view: empty, or one tool that is offered every event first and holds its declared keys (measure, arena's gun, a piece just drawn from a bag). A tool is held only if it takes input outside its own widgets. Escape puts it down. |
| **Selection** | One target per view, a path (each stage sees its element: `api.view.get().selected`). Select is the first entry of every target's menu, in every body; in Edit a plain click selects too. Leaving Edit puts it down (TOOLS.md Decisions 6). |
| **Halo** | The selection's handles (`scene.halo`): move arrows, rotate rings, scale corners, round its box in its parent's frame, in Edit, where the doc is writable and no tool is held. |
| **Attention** | One target per view: the selection if any, else the look (the pointer's hit, or the eye ray under pointer lock; a press moves the look to what it pressed, before anything handles it). Keys, the use prompt and a menu go to it. |
| **Carry** | Picking a thing up and putting it down. What can be carried is data: the `scene.carry` trait on the object, run by the `scene.carry` part. |
| **Clock** | The doc's world time, `doc.clock`: computed by one view (the one holding the doc's `"clock"` claim), followed by the rest, paused and resumed by anyone who may write. Nobody present, no time passes. |
| **Process** | Something an extension registers with the clock to be stepped in world time: sailing's ships, a door that closes itself, an emulator. |
| **Drawer** | One panel at the stage's right where panes are docked (`api.dock`), one shown at a time under tabs: the inspector (a selection opens it in Edit; it stays open, on the scene when nothing is selected, until its ×, the toolbar or leaving Edit), the outline, dimensions and parts (when the viewer opens them), Camber's Shape, a die's panel, a bag's. |
| **Start** | Where the doc starts people: `view.start = { body, place, home }`, read once on arrival (the body entered at the place; the camera at home). Not a mode: nothing about it lasts past arrival. |
| **Edit** (a write) | A write the stage's own editing parts make through `api.edit` (the halo's handles, the inspector, transfer, add, remove, the outline): this viewer's, undoable in the focus doc. A verb, a clock act or a process's save is never one. |

## Views, stages and links

A view shows one stage per open doc occurrence. The outermost doc's stage is
the view's first; every **link** (an object through the `scene.link`
source) whose doc is open opens another, its roots in the link's node (its
body: a link's content is its doc, so hiding the link hides its doc, its
layers and labels too, while its stage runs on, its boxes still its own
doc's say: `api.box`, `groupBox` and `sceneBox` ask what its stage shows,
and drawing, picking and rays what the view draws), in the link's frame
(COMPOSITION.md §2, §7). Expansion (`stage/links.js`) is a
pure function of the link graph: a live doc **acts** at one occurrence per
view, the first in path order (shallowest, then the smallest link id where
paths differ), and is a **mirror** at every other; a link with `at` is
**pinned**, its doc at those heads; a repeat identity on a path is closed
`"cycle"`; a doc that can't be opened is closed `"unavailable"`; a live link
inside a pin is held at the pin's `deps`, else closed `"unpinned"`. A closed
link, or one whose doc (or version) hasn't arrived, is drawn as its hint.
`api.link(id)` → `{ role: "acting" | "mirror" | "pinned" | "closed", open,
reason? }` (open: its doc is drawn). A stage whose occurrence changes role
or identity closes, with what was opened under it, and opens again.

- **Acting and drawn.** A stage that acts is where its doc is played. A pin
  and a mirror are **drawn**: their extensions run (so they look as the doc
  does, lenses, looks and dressing included) and draw into the world
  (layers, labels, styles), but nothing more. They have no segment in the
  chain, offer no body, tool, command or widget, put no chrome in the DOM
  (`overlay`, `edge`, `dock`, `popover` stay out of it), don't move the
  camera, select, notify or set prefs, and register no process (it is
  never started). All of that is one facet of the api (`drawnApi` in
  `stage/stage.js`), and the view asks only stages that act for segments,
  bodies, widgets and commands (`view.acting()`). What its extensions read
  of their own stage they read as anywhere: `api.collect` (a roster, a
  keymap), `api.audience`, `api.shown`, looks; so a mirror and a pin show
  what the acting stage shows (I4). A mirror hears its doc's channel (and,
  over the page bus, its view's acting stage of the same doc, so a carry
  shows in both) and says nothing on it; a pin has no channel, so no claim
  counts in it. Seats are the doc's, so a pin's roster is who sat when it
  was fixed. Where a stage is placed is the view's to know (`stage.role`):
  an extension has no `api.role` to branch on, only `api.writable()`.
- **Read-only.** A stage is read-only when it doesn't act or its handle
  refuses writes (`api.writable()` false). It is then given its doc and its
  repo read-only (`stage/readonly.js`): `change`, `addObject`, `remove`,
  `claim`, `send`, `pose.hold`, the stage's own edits, parts, templates and
  drops are refused, package reconcile writes nothing, the render manager
  builds nothing, presence only listens (and holds the read-only handle,
  which refuses to broadcast), and every handle the repo gives out refuses
  writes, so a keeper in it can't write its container either (invariant
  I6). The stage's repo is exactly `find`, `create`, `create2` and
  `peerId`. A pin's repo finds each doc its `deps` lists at those heads,
  and any other doc as it is now (a viewer's own: a player's secret).
- **Fixing a link.** `api.fixPoint(linkId)` is where the inspector's Fix at
  this version fixes a live link: `{ heads, deps? }`, its doc's heads and
  in `deps` the heads of every doc reached through it: of the docs its
  stages hold or found through their repos (the live docs opened under it,
  render docs, files, a keeper's container), those its doc names by URL, or
  a doc so named names. A doc found that nothing in the pin names (a
  player's secret) is the viewer's and is never recorded; packages are
  read through the view's repo and never reached. A pin is keyed by its
  url, heads and deps: change its deps and it opens again. Follow latest
  removes `at`.
- **One doc per extension.** An extension runs in a stage when that
  stage's doc has one of its traits; a general one (no traits) runs once,
  in the focus stage; one of every doc (`traits: ["*"]`) runs in every
  stage. Everything an api reads and writes is its stage's
  doc: `null` is that doc's root, `api.url` its url, every id one of its
  own. No reference crosses docs.
- **The focus** (COMPOSITION.md §5, TOOLS.md §3) is the path of the links
  the viewer has entered: the outermost ([]) until **Enter** moves it into
  a link whose doc acts there. It scopes the selection (a selection is
  always an element of the focus stage: H10), and the general parts run in
  the focus stage and no other, so the editor (the halo, the inspector, the
  outline, add, paste, undo) edits the focus's doc in its frame. It cuts no
  segment: outside it, verbs, carries, keys and the menu still work. Enter
  goes where a link's doc acts: a live link there, a mirror where its doc
  is live (the same doc); a pin (a value) and a closed link aren't entered.
  **Leave** moves it out a link: Escape's last rung, the trail's crumbs (the
  view's breadcrumb along the top, shown while it's inside a link) and its
  Leave. A link that goes, is pinned or stops acting there leaves the focus
  out to the deepest stage still acting; so does one pointed at another doc
  (a new occurrence at the same path is not the one entered). Focus and
  selection change only through `selectionStep` (`src/selection.js`),
  whoever asks. Where the focus is is the view's: no stage sees it (an
  extension that did could act differently entered than not, I4): it isn't
  in `api.view.get()`, Escape's last rung (leave) shows there as no rung,
  a stage has no Leave, and a focus move doesn't count as placing the
  camera. The general parts, the view's own, are the exception: they see
  Escape's ladder whole, find the camera placed after a focus move
  (`api.camera.touched()`: it came along), and `api.view.reopened(title)` (theirs alone) says
  whether a drawer tab of that title was open as the focus last moved, once
  per title, so a tab open as the focus moved opens again where it went.
  The general parts move with the focus (`host.setGeneral`): the stage
  entered starts them; in the stage left, one holding nothing stops at
  once, and one holding something (a body: walk; the held tool: Measure; a
  session; a pose hold) lingers there, offering nothing, until it lets go,
  so a walk or a measurement goes on across Enter and Leave (back in that
  stage before then, it's kept). What each doc runs is untouched (H1).
  **Presence where it is.** What a doc's people are doing is drawn where
  that doc is, by a part of every doc (`traits: ["*"]`, "Activation"):
  `walk.people` (the others walking) and `scene.others` (everyone else's
  selection boxes). It runs in every stage, as that doc's own part, and
  the focus moving never starts or stops it, so it draws every doc's
  people, not only the focus path's: the focus scopes the selection and
  the editor, and a sibling doc is as live as one the focus is inside. A
  pin draws nobody (a value has no channel); a mirror hears its doc's
  channel, so it draws them again, as it draws their carried cards again.
  `scene.focus` offers Enter on a link (the menu,
  the inspector) and takes a double-click on one; the outline's link rows
  say what the link is here and enter; the inspector has a Linked scene
  row.
- **Frames.** Everything spatial in an api is in its stage's root frame,
  through one choke point (`stage/scope.js`): `worldOf`, `box`, `sceneBox`,
  `pick`, `ray`, `raycast`, `project`, `camera.*`, labels, world layers,
  extents, and every event's `ray`, `hit` and widget. A frame is a
  similarity: points by it, directions by its rotation, distances by its
  scale. A hit on anything not of this doc is `{ id: null, point, normal,
  distance }`; a hit inside one of this doc's links is the link. A world
  layer hangs in an anchor the viewport owns, at the stage's root, so what
  an extension places in it is in the stage's frame (a group at
  `api.worldOf(id)` lands on the object, however deep the link). Geometry
  inside an object is read in the object's own frame (`scope.js`
  `contentMatrix(root, node)`), which every frame above it cancels. No
  extension reads three.js's world matrices or holds the camera (COMPOSITION.md
  "Decisions, links loose ends").
- **Paths.** The selection and hover are paths (the links from the
  outermost in, then the object); each stage sees its element
  (`api.view.get().selected`), and `api.view.select(target)` selects its
  own target, cut at the focus (outside it, nothing; inside a link of the
  focus stage, the link). `api.view.enter(linkId)` moves the focus into a
  link of the caller's (false where it can't; a drawn stage's does
  nothing). Leaving is the view's (Escape, the trail). One key grammar (`stage/paths.js`) names an object in the
  viewport and an extension at the router: the outermost's ids are their
  own, any other's `SEP n SEP id`. A held verb pins attention to its
  target's path (`scene.keys`' `keymap.pinned()`), so its target holds in
  its own doc wherever the look goes, and it lets go when the target goes
  from that doc, its link goes, or its extension stops there.
- **Input** goes a segment per stage on the hit's path, innermost first:
  each its holders, nearest first, then its root's, out to the outermost
  whatever the focus; then the general parts (the focus stage's), wherever
  the hit is, with their stage's element of it (null off its path). A
  general part collects from every acting stage (the input path's first),
  each item tagged with its `stage`, and runs a command with
  `api.run({ stage, ext, command, target })`; `api.path()` is the input
  path's stages (each `{ stage, scene, collect, context, attention, look,
  run, nameOf }`), attention's from the innermost out, then the focus stage
  if it isn't among them, which the key map, the use prompt and the menu
  walk a stage at a time, each in its own context (a held verb pins
  attention in the stage it was held in). So the focus's scene commands
  (Frame all, Measure, Undo) are on every surface wherever the pointer is.
  `api.path({ focus: true })` is the focus path instead (the focus stage
  out to the outermost): the toolbar's, which doesn't follow the pointer.
  A reader also has `writable()` and its doc's `clock` (`status()`, as
  `local.clock`; `pause()`, `resume()`), so the clock chip shows and
  pauses each doc on the focus path (`view.clocks` says when any of them
  changed).
  `api.path` is a general part's only, as `view.packages` is: the readers
  are other docs, and a stage's extension reading them would depend on
  where it is placed (I4); any other extension's `api.path` is undefined.
- **Channels.** Presence, claims and pose holds are each doc's, on its
  channel, in its ids. Every stage of a view uses the view's one session.
  The **page bus** delivers a broadcast to every other presence on the same
  handle in the page (automerge-repo doesn't echo within a page), so two
  views of one doc in one page hear each other; presences on different
  handles are left to the network.
- **What the outermost doc gives the view**: its atmosphere, `view.start`
  (the body named may be any acting stage's; and a start placed on one of
  its links arrives through it, as that doc starts people: "Arriving"), the
  camera's home, and prefs' fallback (a pref falls back to the calling
  stage's doc).

## Three places for state

| | Shared? | Lasts? | Read | Write |
|---|---|---|---|---|
| **Doc** | yes | yes | `api.doc()`, `api.scene()`, `api.claimedBy(id, kind)` | `api.change(fn)`, `api.claim(id, kind)` |
| **Presence** | yes | no | `api.presence.get()`, `.watch(fn)` | `api.presence.set(key, value)`, `api.send(type, data)` |
| **Local** | no (this view) | no | `api.local.get()` (the stage's: `running`, `status`, `edits`, `clock`, `packages`, extensions' keys); `api.view.get()` (the viewer's: body, held, gesture, pointer, escape, theme, notices, prefs, drawer, and the selection and hover as this stage's elements; never the focus) | `api.local.swap(fn)`; `api.view.select(target)`, `api.view.enter(link)`, `api.setPref`, `api.notify` |

(There is no fourth, private place yet: what is one viewer's alone, lasting
and on all their devices. A keeper that needs one keeps it itself, as the
joint keeper keeps its player's secret with their account.)

These rules follow from that:

- **The doc holds what is true for everyone.** Per-viewer things never go in
  the doc: the camera, display toggles and the selection.
- **The doc may suggest a default.** It does so through `doc.view.*`, and a
  viewer's local choice overrides it. Read a preference with
  `api.pref(key, fallback)`, which returns
  `view.prefs[key] ?? doc.view[key] ?? fallback` (`view` the viewer's
  local value, `doc` the calling stage's). Display prefs (`units`,
  `grid`, `axes`, `bounds`, `snap`) stay live this way; `view.start` is the
  one key that isn't a pref: where people start, read once on arrival
  ("Arriving").
- **Ids are opaque.** Any id in doc data may be missing at any time, because
  concurrent edits merge. Readers ignore references to missing objects.
  Writers set fields; they never replace an object's whole map (or its
  transform: `ops.setTransform` writes only the numbers that changed).

Local state is two values, each a frozen plain object.

**`api.local`** is the stage's, shared by its extensions and the stage:

- `swap(fn)` replaces it with `fn(old)`.
- `watch(fn, select?)` calls `fn(next, prev)` after a swap, but only when
  `select(next) !== select(prev)` if `select` is given.

| Key | Written by | Means |
|---|---|---|
| `running` | stage | `[{ id, scope }]`, in chain order |
| `status` | stage | `{ [id]: { state, reason?, text, title } }` load and build state. `text` and `title` are for people; code branches on `state` and, for `"stale"`, `reason`: `"deps"`, `"contested"`, `"pinned"` or `"out-of-date"` |
| `edits` | stage | `{ undo, redo }`: the labels of the steps Undo and Redo would take in this doc ("Move", "Delete"), or null. See "Undo" |
| `packages` | stage | `{ ask, loading, failed, missing }`: the listed packages this viewer doesn't have, each `{ url, name }` (`failed` with `error`), and `missing`: whether any listed package isn't here (whatever was answered about it; true until that is known). See "Packages" and "Audience" |
| `clock` | stage | the doc's world time as the clock chip shows it (see "World time"), or null for a doc with no process anyone here knows of: `{ running, by, computer: { viewer, session, mine } \| null, stalled, able, why }` |

**`api.view`** is the viewer's, one per view, read as this stage sees it:
`get()` and `watch(fn, select?)` (as above); it is changed only through
the calls named here, never swapped.

| Key | Changed by | Means |
|---|---|---|
| `selected` | `api.view.select(target)` (the selection, the outline, add, a game, dimensions), Edit's click | the selection, as this stage's element of its path: one target (an object or group id, or a ref such as `"dimension:<id>"`; see "Targets and refs"), or null (nothing, or not in this stage) |
| `hovered` | the view | the object under the pointer, as this stage's element, or null |
| `body` | the view | the body on top of the stack (TOOLS.md §4): `{ id, label, ext, depth, lock, reach, keys, serial }`; at the bottom (depth 0) the stage's `{ id: "look" \| "edit", label: "Look" \| "Edit", reach: Infinity }`, Look until arriving says otherwise. `serial` says which time it was entered: the same body left and entered again is a new serial (the keys it held were let go; the touch pad's controls are a serial's, TOOLS.md §5). `ext` is the extension's id where it is this stage's own. The editor's chrome shows only in Edit (`editing(view)`, `src/stage/bodies.js`) |
| `held` | the view | the held tool, `{ ext, command, name, keys, pointer, serial }`, or null; held again, a new `serial` |
| `gesture` | the view | the open press session's declared keys, `{ owner, keys, serial }` (each press its own `serial`), or null |
| `pointer` | the view | `{ locked, lock, wanted, released, refused, touch }` (`src/stage/pointer.js`; `touch`: the last press on the view was a finger, or none yet on a coarse pointer) |
| `escape` | the view | `{ layer, hint }`: the layer the next Escape pops, and what the hint says (`src/stage/ladder.js`). Leaving the focus is a layer only a general part sees |
| `theme` | the view | the colour tokens (`{ accent: [r,g,b], … }`) |
| `notices` | `api.notify` | `[{ id, text, kind, at }]` |
| `drawer` | `api.dock` | `{ tabs, shown }`: the drawer's tabs by title, in docking order, and the one shown (null with none docked), so a surface showing whether a tab is open (the toolbar's Objects, Inspector) hears when it closes |
| `prefs` | `api.setPref` | this viewer's overrides of `doc.view` keys (persisted per scene) |
| `packages` | the view (general parts only) | every open doc's packages this viewer doesn't have, one prompt's worth (see "Packages") |
| `clocks` | the view (general parts only) | the focus path's clocks, outermost first: `[{ stage, name, status }]`, one per stage on the path whose `clock` is not null, `name` the trail's for that doc. The clock chip's: a chip per doc, Pause and Resume through each stage's reader (`clock`) |

Private local state lives in the extension's closure, or under a key prefixed
`<id>.`. Another extension doesn't write it: it runs one of the owner's
commands instead (measure saves through `scene.dimensions`' `add`).

Presence keys are the extension's own too, with one shared convention: the
selection extension (`scene.select`) publishes `selected` (any target) and
`hovered`, and surfaces read them: the outline marks peers' rows (objects
only) and `scene.others` draws their boxes. Peer colours come from
`src/peers.js`, so a peer's box and row match. Likewise walk's body (`walk`)
says `avatar` and `walk.people` draws it.

## Activation

```js
{ type: "scene:extension", id, name,
  traits?:     string[],              // active when the scene or any object has one of these trait keys ("*": every doc, held by its scene)
  drops?:      string[],              // may lay out a dropped doc of this datatype ("*": any)
  describes?:  { [traitKey]: description },  // what its traits are, for authoring them (below)
  …                                   // any other plain data: the stage ignores it, others may read it from
                                      // the registry (a keeper's `keeper: "plain"`, the seats' `roster: true`: "Conventions")
  async load() { return { create(api) → instance, drop?(ctx, info) → boolean | Promise<boolean>, … } } }

{ type: "scene:template", id, name, icon?, description?,
  async load() { return { create(ctx) → Promise } } }

{ type: "scene:part", id, name, icon?, category?, description?,
  tags?:   string[],                  // the connector tags it fits (as an object's tags, for the carry)
  traits?: string[],                  // the traits it brings, shown in the bin as what it does
  async load() { return { create(ctx, at) → Promise<string | null> } } }
```

**The running set** is a pure function of the registry's metadata and the
doc (TOOLS.md §1, H1). It is computed by `activeSet(metas, doc)` in
`src/stage/activation.js`. The stage recomputes it after every doc change
and every registry change, starts what's new and stops what's gone. Nothing
else changes it: not the body, the held tool, the selection, prefs, the
clock or where anyone stands.

An extension runs when **it has a reason of its own**, which also gives its
scope:

| Scope | Reason | Offered input at ("The input chain") |
|---|---|---|
| `scene` | a scene trait, or `traits: ["*"]` (every doc calls for it: what draws a doc's people, wherever the doc is) | step 3, every event: at its nearest holder, which is the scene unless the hit chain reaches one of its objects first (always the scene, for `"*"`) |
| `objects` | only object traits | step 3, and only when the event's hit chain reaches one of its objects (one with its trait) |
| `general` | it declares no traits at all (a general-purpose part: the key map, the menu, notices, the inspector, the walk body) | step 4 |

An extension that declares traits the doc doesn't have has no reason, and
doesn't run. Carrying is the plainest case: `scene.carry` declares the
`scene.carry` trait, so it runs with object scope wherever the doc has
something that can be picked up, and nowhere else. An extension that exists
only for its `drops` (doom's) declares the marker trait its layout writes
(`doom.map`), so it runs, doing nothing, where what it laid out is; and a
trait some body reads (the walk body's spawn points, `walk.spawn`) has a
part of its own that declares it (`walk.spawn`, in `walk/`), so a doc with
one calls for that package by the same rule. Nothing else decides what runs,
and metadata the stage doesn't name is ignored.

**Order:**
- `scene` extensions, in registry order;
- then `objects` extensions, in registry order;
- then `general` extensions, in registry order.

Registry order is the order plugins were registered in, so a package's
general extensions run in the order its `plugins` list gives them (the
scene's `src/index.js` lists the editor's parts in the order input should
reach them). This order (`local.running`) is the only order anything
combines in: input, lenses, `collect`, landing rules. The order extensions
happened to start in never counts.

**Chrome follows attention, never the doc** (TOOLS.md §1). Every general
part runs in every scene, a game's included; what keeps the editor's chrome
out of a game is that it shows only where attention asks for it. The
inspector is a drawer tab a selection opens in Edit; it stays open, on
the scene when nothing is selected, until its × (shut until the selection
changes), the toolbar's Inspector or leaving Edit shuts it; the outline (Objects), Dimensions and Parts are
drawer tabs the viewer opens from the toolbar; grid, axes and bounds are
drawn only in the Edit body (and, as display prefs, a doc may suggest them
off: a table does). All of that, the toolbar, and every command that says
`edit: true` are the Edit body's alone (TOOLS.md §3, "What is Edit's"):
looking, walking or seated, nobody sees an editor. The use prompt shows attention's verbs wherever there
are any. A part that was an edit-only verb is a verb with no mode: a bag's
Empty out is in its menu, whoever opens it.

**Drops** are not activation. To lay out a dropped document, the add
extension calls `api.drop(info)`. That loads each module whose `drops` match
and calls its `drop(ctx, info)` until one returns true, where:
- `ctx` is a temporary api, **the drop context**: `id` (the plugin's),
  `repo`, `handle`, `url`, `viewer`, `doc`, `scene`, `change`, `newId`,
  `addObject`, `file` (see "Parts"), `content` (read-only, as `api.content`:
  a part reads what it's dropped on), `worldOf` (read-only, as `api.worldOf`:
  a drop on something moving lands where it's seen), `registry`, `local`,
  `notify`.
  Templates and parts get the same one;
- `info` is `{ url, doc, handle, group, at: { point, hitId } | null }`.

A drop writes traits into the doc, and those traits are what activate the
extension.

**Templates** start an empty scene. An empty scene's start screen (the add
extension's) lists every registered `scene:template` from the registry's
metadata (`name`, `icon`, `description`; nothing is loaded to offer one),
and Blank. Choosing one calls `api.template(id)`, which loads it and runs
`create(ctx)` with the same `ctx` a drop gets. The template writes whatever
it needs into the doc: objects, traits, and `view.start`. Then this viewer
starts where the doc now says, as arriving does (below), so an arena
template that starts people walking at a spawn point lands its maker in the
game.

**Arriving** (TOOLS.md §2). `view.start = { body, place, home }` is where
the doc starts people, read once, when the stage opens (and again after a
template has run). `home` is the camera a viewer with no saved camera of
their own opens at (`startOf`, `initialCamera`). `body` says the base at
once: `"edit"` is Edit, anything else or nothing is Look (`startBase` in
`src/stage/bodies.js`). A scene made new says `"edit"` (the scene datatype's
`init` writes `view.start = { body: "edit" }`: they came to build); a
template or publisher writes its own `view.start` over it. Any other body is
entered over Look at `place` (a spawn point's object id, a seat's id, or absent:
`null`, the body's own "here") as soon as a running extension offers it and
the content shown has loaded (a walker started before its floor is in falls
through it), or `ARRIVE_WAIT_MS` (20 s) after it came on offer whatever is
still loading. Until it's on offer the wait lasts as long as the body may
still come: a package loading, or one asked about and accepted however much
later (someone a table starts seated, taking their time over the prompt,
is still seated once they say yes). A body that refuses when entered (its
`enter` answers nothing, say a seat not yet laid) is asked again until
`ARRIVE_WAIT_MS` after the offer. The viewer entering a body first, or
everything the doc calls for here and started (or failed to start) with no
extension offering that body, ends the wait with nothing entered. A package
declined or failed leaves it waiting, quietly, on the viewer. A later
change to `view.start` moves nobody already here. The body's package is
listed the ordinary way, by the trait its place carries (a spawn point's
`walk.spawn` calls for `walk/`; a table's `seats` for `seats/`): nothing in
`view.start` is looked up in the registry. A body given no place decides
what that means: the seat body puts you back in your own seat if the doc
seats you, else watching from the first seat's view (writing nothing).
A place that is one of the doc's links arrives **through** it: as the
linked doc starts people (its own `view.start`, body and place, in its
stage; and on down, where that place is a link in turn: `startArrival` in
`src/stage/view.js`), whatever the host's `body` says, and **only there**:
that stage offers the body or nobody arrives. Another linked doc offering a
body of the same id never takes it, not even while that stage is still
starting or its packages are on their way (it waits for that stage as
above): its place is that doc's id, meaningless in any other. So the Quiet games
room starts people through its Lost Cities link, and the game decides how
(its seat body). Nothing crosses: the host names its own link, the linked
doc its own place. Through a pin, a mirror or a closed link nobody arrives
(Look, nothing entered): a value isn't played, and a mirror is the same
doc drawn again. Extract moves a start placed on what it extracts so.

**Parts** are what you put into a scene once it's started: a mast on a hull,
a buoy in the sea, a target in a level. A template is a way to start a
scene; a part is a piece of one. Any package may contribute them, and the
stage knows none of them.

- **The plugin** is metadata the bin reads without loading anything: `name`,
  `icon` (a lucide name), `category` (the bin's heading), `description`,
  `tags` (the connector tags it fits: a connector that lists tags takes only
  parts with one of them, as it does the carry's pieces) and `traits` (what
  it brings, shown as what it does, by the name an extension's `describes`
  gives it).
- **`api.part(id, at)`** → `Promise<string | null>` loads the part and runs
  `create(ctx, at)` with the drop context, then selects the id it returns.
  `at` is `{ parent, transform, world }`: `parent` an object id or null,
  `transform` (`{ position, rotation, scale }`) in the parent's frame, the
  world's when `parent` is null, and `world` the same place in the world.
  The stage checks `parent` (gone, or a group: null) and fills the transform
  in. The part may ignore or adjust `at` (turn itself to its parent's bow,
  set itself on the waterline, put itself at the root at `world` rather than
  ride along), may make several objects, and returns the one to select (or
  null). A part that throws is a notice, and null. A part that awaits before
  it writes (making its files) checks, in the change that writes, that its
  parent is still there.
- **`ctx.file(key, make)`** → `Promise<{ url, hint }>`: the scene's own file
  doc for `key`, made once and reused, so ten buoys share one GLB. When the
  scene has none yet, `make()` → `{ name, bytes, extension, mimeType, hint? }`
  (or a promise of it) is called, a `file` doc is made from it, and the stage
  remembers it at `doc.assets[key] = { url, hint? }`. `hint` is an object's
  `hint` (`{ bounds, … }`, README), handed back as a fresh copy to write on
  what's made from it (`addObject(url, { hint })` does). Keys are namespaced
  and versioned, `"sailing/mast@1"`, so new art gets a new key and scenes
  made with the old keep theirs. Two calls at once in one view make one
  file; two peers at once each write theirs only if the key is still empty,
  and the merge keeps one in `assets`: what each peer made keeps the file it
  made (two docs for one key, shown alike), and later drops use the one kept.
  Nothing deletes a file `assets` names.
- **The bin** (`scene.parts`) is a drawer tab, Parts, that the viewer opens
  from the toolbar, listing every registered part by category, with a
  search once there are eight or more. With none registered there is no tab
  and no toggle. What it puts in is one edit (undo takes it out). Drag one into the view and it
  lands where the pointer hits; a click puts it where the view is looking
  (the middle of the view, on whatever is there). Either way:
  - on an object (locked or not), it goes under that object (`parent`),
    placed at the point in that object's frame; whether it rides along is
    the part's to say (`at.world`);
  - it snaps by the carry's rule (`snapCandidates`, `nearestSnap`): to the
    nearest of that object's connectors that takes it (one that lists tags
    takes only a part with one of them) within the object's `snapRadius`,
    in plan. Alt, or the Snap pref off, places it freely. A part writes its
    `tags` on the object it makes, so the carry sees the same fit;
  - it stands upright in the world, facing a snapped connector's way, else
    its parent's (the parent's +Z, seen from above), else the viewer (its +Z
    toward the eye);
  - while dragging, a ring shows where it will land: accent when snapped,
    muted when not, labelled with what it goes on.

  The drag is the browser's own, carrying `application/x-scene-part` =
  `{ part }`, so a part can be dragged into another scene open beside this
  one. The maths is `src/parts/parts-place.js`.

**Copying objects** between scenes, or within one (`src/transfer.js`; the
view's side is `scene.transfer`, editing only).

- **The row payload.** An outline row's drag carries
  `application/x-scene-object` = `{ scene, id, ids }`: the scene's URL (ids
  are only unique within a scene, and two scenes beside each other share one
  drag session) and the object ids, `id` being the first. In its type list it
  also says, since only types are readable during dragover (and come back
  lower-cased): which scene it's from, `application/x-scene-object-from;<doc
  id, lower-cased>`, and how far it reaches from its origin in plan,
  `application/x-scene-object-size;r=<scene units>`. Beside them it carries the
  object's document (`text/x-patchwork-dnd`, `text/x-patchwork-urls`,
  `text/plain`: its render doc, or its GLB file) for tools that aren't scenes,
  as before. The payload may also say `lift`: how far the copy's reference
  point (one top object's origin; several, the lowest) is above its lowest
  point, measured where it's drawn in its own scene (readable at the drop,
  which is when it's needed). ⌘C writes the same payload to the clipboard,
  with that link as `text/plain`, and `copy`: which Copy it was (repeated
  pastes are counted by it). The menu's Copy writes the same through a copy
  event of its own (`execCommand("copy")` from the click); where the browser
  won't run one, it writes only the link, and the payload reaches only
  scenes on the same page (Paste there reads it from the page).
- **In its own scene** a row drag is the outline's (reorder, reparent; never a
  copy) and the view ignores it. Paste in its own scene is a duplicate: beside
  the original (moved by its width in world x, the nth paste of one Copy n
  widths), on the same parent, in the same group. The original's place is
  read from the doc, its parent's too, so a pose being drawn (a simulation's
  hull, a carried piece) doesn't skew the duplicate.
- **In another scene** (dropped in the view, dropped in the outline, or
  pasted) it's a copy:
  - **What:** the named objects, everything attached under them, and for a
    group everything filed in it, at any depth; new ids, with their
    attachments and group membership among themselves kept.
  - **Where:** the top-level ones move together. In the view (or pasted, at
    the middle of the view) they land by the parts bin's rule: under the
    object hit, snapped to a connector whose tags take a lone object's tags
    (Alt, or Snap off: freely), turned to the connector's or that object's
    heading; on the ground they keep the heading they had. Tilt, scale and
    every transform below the top come as they were. Pasted, they go under
    the object at the middle of the view only when they snap to one of its
    connectors; else on the surface there, under nothing, and each repeat of
    one Copy steps sideways by the copy's width onto whatever is under that
    spot. In the outline the tree says only where in the tree (parent,
    group, `before`); they're put down as the view would: among an object's
    attachments, on that object at the nearest connector that takes a lone
    object's tags, however far (else at its origin, on its top), and at the
    top or in a group where the view is looking, under nothing. Where they
    were in their own scene's world means nothing here. Unless snapped, the
    landing point is raised by the payload's `lift` (without one, a lift from
    the objects' `hint.bounds` through the doc's transforms), so the copy
    rests on its base: a crate whose origin is its middle sits on the floor.
    A connector is made for an origin at the base, so a snapped copy isn't
    raised.
  - **Every field but runtime state.** Not copied: `claims` and `saved` (the stage's), and
    any trait key an extension marks as runtime in `describes` (below). Pose
    holds and presence were never in the doc.
  - **Files are shared, renders aren't.** A file object keeps its
    `sourceUrl` (a GLB file doc is immutable), and the source scene's
    `assets` entries naming copied files are copied under the same key,
    unless this scene has that key already. A built object gets a new render
    doc through `addObject` (`opts.render`), for the same source and provider,
    with the source render's `params` and, as the source is the same, its
    build (`glbUrl`, `builtFrom`, `builtAt`, `bounds`), so nothing rebuilds
    until someone changes it here, and tuning one scene's copy never
    changes the other's.
  - **References in traits** are fixed by their field kinds (`describes`,
    below). An `object` field naming something copied with it is set to that
    copy's new id (in the same scene too: a duplicated lever works its own
    duplicated door). Naming something not copied, it's kept in the same
    scene and cleared in another, with a notice ("This lever's target was
    left behind: choose one in the inspector."). An `entry` field is kept in
    the same scene, or where this scene's trait `of` has that key; else
    cleared, and `of` counts as a need (below) when the scene lacks the trait,
    or a notice names the missing entry.
    A field with `copy: "drop"` is left behind (a keeper's container, which
    holds one slot per object: the copy has no slot there).
    `url` and other fields are copied as they are. Every copy's id is
    chosen before anything is written (`addObject`'s `id`), so each
    reference is written once, already right. This is the one copy rule:
    extract and bundle (COMPOSITION.md §8) go through the same
    `copyRefs`, and the objects left in a doc when something leaves it
    through the same rewriter (`refEdits`).
  - **A missing scene trait.** When a copied trait's `entry` field names a
    scene trait this scene lacks, a notice says so ("This private zone needs
    seats: add Seats to the scene."). Nothing adds a scene trait for you.
  - The first copied root is selected.

**Extract and bundle** (COMPOSITION.md §8; `src/extract.js`; the view's side
is `scene.transfer`'s Extract and Bundle, editing only, each one undo step).
The copy rule above used in two directions, each followed by one change to
the host, written against the host as it is at that moment.

- **Extract** (on an object or a group) takes S: it, everything attached
  under it and everything filed in it, whose top objects must share one
  parent p (else it's refused, saying so). It writes a new scene doc T
  whole, before anyone can know of it: S's objects under their own ids
  (a fresh doc has no collisions), every transform as it was (p's frame is
  T's root), runtime state and `copy: "drop"` fields left behind, a built
  object's render doc copied with its build, the `assets` entries S's files
  use, the dimensions with both ends on S, the host's display prefs, the
  packages its contents come from, and the host's `"@patchwork"`. In T a
  reference to an object of S is kept, one to p becomes `null`, any other
  is cleared. Then the host, in one change: S goes; a link to T takes its
  place at p, with no transform of its own, filed in the group S's outer
  members share (else none), its hint S's box in p's frame, where S's first
  member was in the order; a reference into S is cleared; a dimension with
  one end on S keeps that end frozen where it is; a start placed on S moves
  to T, and the host starts people through the link instead. The link is
  selected. If S changed meanwhile, nothing is written (T is left unlinked).
- **Bundle** (on a link whose doc is open here) copies the doc the link
  shows (at its `at` when fixed: a live link inside it is copied fixed where
  the pin held it) into the host in the link's place, and removes the link,
  in one change. The linked doc is never written. Ids are kept unless the
  host has them, and every reference follows; T's top objects go under the
  link's parent at link · local, filed in the link's group; what was
  attached to the link stays where it is, on its parent; a reference to the
  link is cleared; a start through the link becomes T's start. Its top
  object is selected.
- **K, the root traits that go along**, is explicit: Extract moves the
  ticked host traits to T; Bundle copies the ticked traits of T to the host,
  refused for a trait the host has ("This scene already has Seats"). They
  are the commands' `options` (the inspector's checkboxes, none ticked: "A
  command"); the menu takes none. Nothing infers them.
- So `bundle(extract(S, K), K)` gives the host back on every field but
  runtime state and render doc identity when S has no edge outside it
  (I9), and no runtime state ever has two writable holders (I11).
  Every cleared reference is said in paste's words.

**Describing traits.** `describes` says what an extension's traits are, so a
surface can write them without a script (the inspector's Behaviours and "Add
behaviour…"). It is metadata like the rest: plain data that survives
`structuredClone`, read from the registry, so offering a trait starts
nothing; adding it is what starts the extension. The first plugin in
registry order to describe a key wins.

```js
describes: {
  "arena.target": { name: "Target", on: "object", blurb?: "Can be shot down" },
  "arena.level":  { name: "Arena level", on: "scene",
                    fields: [{ key: "look", label: "Look", kind: "enum", default: "",
                               options: [{ value: "", label: "The scene's own" }, { value: "arena", label: "Sky, haze and sun" }] }] },
  "seats":       { name: "Seats", on: "scene",
                      entries: { label: "Seats", noun: "seat", prefix: "seat",
                                 fields: [{ key: "name", label: "Name", kind: "string", default: "Seat" }],
                                 init: { player: null } } },
}
```

- `on`: `"object"` (the default), `"scene"`, or both as a list: where it may
  be added. A trait already on a holder is listed wherever it is.
- `fields`: ParamSpecs (`src/param-form.js`): `number`, `integer`, `string`,
  `boolean`, `enum`, `color`, each reading `value[key]` and showing `default`
  when it's missing, plus four kinds of the inspector's:
  `object` (an object or group id in this scene), `entry` (`of: traitKey`: a
  key of that scene trait's map, labelled by the entry's `name`; a zone's
  seat), `url` (an automerge URL, as text) and `json` (any value, as JSON
  text; also what an unknown kind is taken for). Clearing an `object`,
  `entry`, `url` or `json` field deletes its key.
- `entries`: the trait's value is a map of entries, id → `{ …fields }` (the
  seats). Each entry has the `fields`; adding one writes `init` plus their
  defaults under `api.newId(prefix)`.
- `runtime`: what of the trait is about now rather than about the object,
  so a copy leaves it behind (see "Copying objects"): `true` for the whole
  trait, or a list of its keys (`runtime: ["motion"]`). A field spec may say
  `runtime: true` too. Any extension that writes play state into a trait
  must declare it here, or copies carry it. (When that play state also moved
  the object, as a shot-down target's fallen transform, leaving the state
  behind leaves the object moved: such an extension must put it back first,
  or keep the state so its own reset can.)
- A field spec's `copy: "drop"`: a copy leaves that field behind (see
  "Copying objects", "References in traits").
- `init`: what a new trait starts as, before its fields' defaults are
  filled in. Keys nothing describes (a target's `down`, play state) are never
  shown and never touched.
- **Writes are field by field**: a trait's key on its holder, one field in it,
  one entry in it; never the whole traits map, and a trait's undescribed keys
  survive an edit. The scene's `traits` map always exists; an object's is
  made by its first trait (so two peers giving the same bare object its
  first trait at once keep only one).
- The code that reads a trait must take a missing field as its default: only
  `init` and the defaults present when it was added are written.

**Stopping** (one rule, H2):
- An extension that leaves the running set because of a doc change keeps
  running for 2 s, and for as long as it has a body entered, the held tool,
  an open session or a pose hold (the carry holding the table's card), so a
  peer's edit doesn't tear down someone's game.
- One still loading stops at once (it holds nothing), and so does one whose
  plugin left the registry (uninstalled: there's no code to keep running).
- A general part the view moves away (the focus moved: `host.setGeneral`)
  keeps the busy half: holding nothing, it stops at once (the 2 s are for
  a peer's edit undone, and a focus move isn't one); holding something,
  it lingers, offering nothing (no commands, bodies, widgets or place in
  the chain: its successor at the focus offers them), until it lets go.

When an extension stops:
1. cancel its open session;
2. pop its bodies (the router unlocks when the top body changes), put its
   held tool down, and release its camera holds;
3. remove its processes (a kept one this view computes is saved first, in a
   checkpoint, then stopped), release its pose holds as put-backs, and let
   go of its claims (no `onLost`);
4. clear its presence keys;
5. stop its loops, `afterRender` hooks and scheduled work;
6. remove its world groups, disposing their geometry and materials;
7. remove its labels, overlays, edges, docked panes (without `onClose`),
   styles, cursor and extent;
8. call `dispose()`.

`api.signal` aborts at the start of this. After that, every call through its
api that acquires something is a no-op.

**No migrations.** The stage reads only the current doc shape: it never
upgrades a doc, and an extension has no hook to. A scene in an older shape is
replaced, not read.

**Shared maps.** Nothing writes a map or list at a key that another peer
might also create (two peers each making one at once would leave one peer's
writes in a map that loses the merge). Claims are the one exception: an
object's `claims` map is made by its first claim, and a claim lost that way
is written again by its holder (see "Claims"). Every scene doc is made with
`traits`, `view` and `dimensions`: the scene datatype's `init` makes them,
and so does every tool that writes a scene doc whole (tabletop's tables, the
TTS importer's games among them, and bag's "Put it in a new scene"), so an
extension's `if (!d.traits) d.traits = {}` is only ever a fallback. The same
for `clock` (`{ running: true, t: 0 }`, "World time"): made with the doc,
written field by field by the stage, which makes it only as a fallback for a
doc made without it. `view.start` is written whole only by what lays a
scene out (a template, a tool writing the doc whole); the inspector's
Starts in and Set home view write its fields, making it only as a fallback. `init` makes `assets` too, as do tabletop and bag (each
writing a scene doc whole), and nothing else ever does: a scene without one
is from before `assets` and is
republished, not patched. The same goes for the `packages` list (see
"Packages"): made by `init` and by those, appended to by the stage,
never created by it.

## Packages

A scene's contents come from many packages (a sea from sailing, a table from
tabletop, a terrain's provider). The doc says which, and the stage loads the
ones a viewer doesn't have, so a scene's URL is enough to share it. The rules
are `src/packages.js` (pure); when they're applied is
`src/stage/packages.js`; the prompt is the `scene.packages` part.

**The list.** `doc.packages` is a list of `{ url }`, made with the doc by the
scene datatype's `init`, like `assets`. A `url` is a **package URL**: a
package's folder (`automerge:<id>`, bare) or where it's served
(`https://…`). An entry is an object so that a version (`heads`) can be
pinned beside the URL later; nothing reads one now. Readers go through
`listedPackages(doc)`: each package once, in the order first listed.

**The URL rule** (`packageUrl`): the one form a package is listed and
compared in, or null when it names nothing another viewer could load.
- `automerge:<id>`, with or without heads, is `automerge:<id>`. (The module
  watcher registers a package at the heads it loaded, `automerge:<id>#<heads>`;
  that is the same package.)
- `https:` on a public host is itself, without its fragment.
- Everything else is null: `http:` (a dev server, or code anyone on the way
  could swap), `https:` on localhost, a `.local` or bare machine name or a
  private address, a URL with credentials, `blob:`, `data:`, `javascript:`,
  a relative path.

A null URL is never written to the list, and an entry that reads as null
isn't there: it is never offered and never loaded.

**What the doc calls for** (`neededPlugins(doc)`): everything in it that is
answered by looking in the plugin registry.

| In the doc | Looked up as |
|---|---|
| an object's `providerId` (and the provider its render doc names) | the `scene:source` with that id |
| a trait key on the scene or on an object | every `scene:extension` whose `traits` include it |

`view.start` is no mark of its own: its body's package comes with its
place's trait (above). A part or a
template leaves no mark of its own (what it makes is objects and traits,
found above), so the stage notes it when one is run in this view. Nothing
else in a scene doc names a plugin: general extensions (the editor's own)
run for whoever has them, whatever the doc says.

**Reconcile: the list is true by construction.** After every doc change and
every registry change the stage adds `{ url }` for each package that
- a registered plugin answering one of those needs (or a part or template
  run here) was registered from (its `importUrl`),
- the URL rule gives a URL for, and
- the list doesn't name.

So whoever adds content has its plugin (they couldn't have added it
otherwise), and their stage names its package: a scene can't call for a
plugin whose package its list doesn't name, short of a doc written by hand
or made with a plugin from a dev server. Only someone who has a plugin can
say where it comes from; a viewer without it adds nothing. This includes the
scene package itself (its `file-glb` shows most objects): it can't help load
itself, but no rule is needed to leave it out, and the list is then the whole
of what the scene is made of.

- **Appends only.** Nothing is removed (a trait taken away leaves its
  package listed), the list is never rewritten, and it is never made: a
  scene without one is from before `packages` and is republished, not
  patched (see "Shared maps").
- **Concurrent adds.** Two peers who both have a package may both add it
  before either hears the other; the merge keeps both entries. Readers read
  each package once, each peer then finds it listed and writes nothing
  more, so there is at most one entry per peer per package, once.
- A read-only view (a scene at a version) is never written.

**The scene package as the suggested import.** `@patchwork.suggestedImportUrl`
is what Patchwork offers a viewer who has no tool for a doc; for a scene it
is the scene package, bare (no `frozenImportUrl`: versions aren't pinned
yet). Every scene doc carries it:
- one made through the host (the sidebar's New) gets it from the scene
  datatype's `importUrl` (`createDocOfDatatype2`);
- one written whole by another tool (tabletop's tables, bag's new scene; the
  TTS importer makes games, whose tables are tabletop's)
  gets it from the registry's `scene` datatype, by the URL rule
  (`src/scene-package.js` in each);
- a publish script states it (`probes/scene-packages.mjs`: the scene
  package's `pushwork url`), and checks it;
- and the reconcile pass writes it on any scene that names nothing loadable
  there (no field, or a dev server's URL), when the scene package here can
  be shared. One that names something loadable is never replaced.

**Loading.** The listed packages none of whose plugins is registered here
(`missingPackages`) are this viewer's to load.
- **One prompt, for every open doc.** Each stage publishes its doc's as
  `local.packages`; the view puts every open stage's together (acting or
  drawn: a pin's content needs its providers too; `unionPackages`, each URL
  once, asked about if any stage asks) as `view.packages`, which only the
  general parts see, and `scene.packages` shows it as one card over the
  view: "This scene uses 2 packages you don't have.", each by its own name
  (its `package.json`'s, read from its folder; never asked of an `https:`
  host) and its URL, with **Load** and **Not now**, which go to every stage
  that asked. So a host lists only what its own contents come from, and a
  viewer arriving at it is asked for what its linked games run too.
  (`api.packages` is a general part's view-wide, any other extension's its
  own doc's.)
- **Load** loads each as the module watcher would, on this thread:
  `importPackage` (`@inkandswitch/patchwork-filesystem`) at the folder's
  heads once it has gone `FOLDER_QUIET_MS` (500 ms) without a change, then
  `registerPlugins(plugins, url)`
  (`@inkandswitch/patchwork-plugins`) with the bare URL. (A folder found
  fresh is still catching up: its first heads are a prefix of its history,
  an old build, the rest arriving a moment later. The module watcher
  reloads when a folder changes; a scene loads once per page, so it waits
  for the folder to settle.) The registry
  changing is what starts things: the host starts the extensions the doc
  calls for, the render manager builds the objects whose provider was
  missing, objects with no render doc are routed again by the kind of
  content their provider makes (a file shows), and the parts bin, the start screen and the inspector list what
  arrived.
- **Each on its own.** One that fails is shown on the card with why, with
  **Try again** and **Dismiss**, and doesn't hold up the others. A failure
  isn't retried unasked.
- **Not now** asks nothing more in this view: the view keeps the declined
  URLs, so a doc opened after the click (a link added, a relink, a mirror
  that comes to act) isn't asked about them either. Opening the scene again
  asks again.
- **Remembered.** A package that loaded on a click is remembered in
  `localStorage` (`scene-packages:accepted`, a JSON list of package URLs),
  and loads without asking in the next scene that lists it.
- **Session only.** Nothing is written to the viewer's module settings or
  account: what a scene brings is gone on reload, and comes back when the
  scene is opened (asked about, or remembered).
- **Not at once.** Nothing is offered or loaded until the registry has been
  quiet for a second: the shell may still be registering the viewer's own
  packages as the scene opens. A package that arrives meanwhile is never
  asked about.

**Security.** A package is code, and loading one runs it with everything
this page can do, as the viewer. The list is doc data, so anyone who can
edit a scene can put a URL in it. Hence:
- nothing is ever loaded without a click on Load for that URL, or a
  remembered one (same URL, this browser);
- only URLs the doc lists are loaded, and only by the URL rule (`api.packages.load`
  takes no URL of its own: it chooses among what's asked about);
- the card always shows the URL: a package's name is its own claim.

**What it doesn't cover.** The documents objects are made *from* (an
implicit surface, a deck) are opened by their own tools, which usually come
in the same package as their provider; where they don't, Patchwork's own
suggested import for that doc applies. Two viewers who have one plugin from
different URLs (a fork) each list theirs, and a third is offered both.

## The input chain

The stage turns DOM input on the canvas into **events**, which are values. It
routes only events whose target is the canvas; anything else (edges,
overlays, labels) is left to the DOM. It offers each event down a chain:

1. **the held tool** (TOOLS.md §4: one slot);
2. **the widget's owner**, for the widget under the pointer;
3. **the holders, nearest first** (precedence is nearness: SCOPE.md §2).
   The hit chain is the hit object, then what it's attached to (nearest
   first), then its groups (nearest first), and last the scene; with nothing
   hit, it is the scene alone. An extension's holder is the nearest member
   of the chain carrying one of its traits, and the event it gets has
   `holder` set to that object (`null` for the scene). Nearer holders go
   first, and running order breaks ties only between extensions holding the
   same member: a card on a table aboard a boat goes to the table's
   extension, then the boat's, then the scene's. A hit inside a linked doc
   makes this a **segment per stage** on the hit's path, innermost first:
   the linked doc's holders out to its root, then the host's from the link
   out to its root, and so on to the outermost, whatever the focus;
4. **`general` scope**: the focus stage's general parts, in running order,
   wherever the hit is (each given its stage's element of the hit, null off
   its path);
5. **the top body's input** ("Bodies" below); Look, walk, seat, sailing's
   aboard and station have no default press. A body may name event types it
   takes **ahead** of steps 3 and 4 (after the held tool and a widget's
   owner only): Edit takes `click`, so in Edit a plain click selects (an object
   at the focus), clears (nothing, with something selected) or does nothing
   (an object outside the focus) before any package's click verb (TOOLS.md
   Decisions 6). Presses still go down the chain first;
6. **the stage default**. An unclaimed press orbits (left button) or pans
   (right button); the wheel zooms. The default is skipped while the camera
   is held (a first-person body holds it).

The held tool and the top body are the router's; steps 2–4 are
`chainOrder` and `holdersFor` (`src/stage/chain.js`, pure). Key events have
no hit, so in the chain they reach only extensions held at the scene and
general ones; in practice keys go by "One key order" below.

**Selection, the halo and carrying** (TOOLS.md §1, §3). None of the three is
a tool to pick first, and there is no `local.tool` or `view.tool`:
- **Carrying** is `scene.carry`'s, a trait part: an object with the
  `scene.carry` trait can be picked up, so the part runs (object scope) in
  any stage whose doc has one, whatever anyone is doing, and is offered a press as
  the holder of the nearest member of the chain with the trait (a press on what's attached
  to a card carries the card). A press that doesn't move is a tap it gives
  back, so the click goes on. `carryable(id)` vetoes only a passing state.
  F is carry's Flip on every surface; Frame is `.`.
- **Select** is the first entry of every target's menu (`scene.menu` puts
  `scene.select`'s Select first), whatever body you're in: the deliberate select,
  in a game too. A plain click selects only as the Edit body's click
  (`editInput` in `stage/view.js`), taken ahead of the chain, after only the
  held tool and a widget (TOOLS.md Decisions 6), on something at the focus;
  a click on something outside the focus is Edit's too and selects nothing,
  so after the held tool and a widget no package's click verb is offered it
  (COMPOSITION.md, Decisions, Edit's click is Edit's). Only a click on
  nothing (or on what its doc no longer has) with nothing selected is left
  to the chain. Only the click: presses and the double-click go down the
  chain in Edit as in every body, at the focus and outside it. Look has
  none. Where a selection may be is `src/selection.js`: an element of the
  focus stage (H10): with the focus on the boat, a card aboard selects the
  link it's in; Enter the link to select the card.
- **The halo** (`scene.halo`) is the selection's handles, in the Edit body,
  where the doc is writable and no tool is held: a move arrow along each axis, a rotate ring
  about each and a scale handle at each corner, all outside the thing's box
  and sized for the screen (`src/parts/halo-math.js`), plus the build-param
  knobs (`scene.handles`). They are drawn and dragged in the frame of what
  the object is attached to, as drawn this frame, so a winch's handles heel
  with the hull and a drag on them is along her deck while she sails. Found
  on screen and offered as a widget at its distance from the eye, a handle
  behind the thing loses to the thing; an arrow seen end on, or a ring edge
  on, isn't offered. A drag holds the pose and writes once, on release.

Each extension is offered an event at most once, at its earliest step. The
first to claim it wins. The stage then calls `preventDefault` on the DOM
event, and `stopPropagation` too for presses, so orbit never sees them.

```js
event = {
  type: "press" | "click" | "dblclick" | "menu" | "key" | "keyup" | "wheel" | "move",
  x, y,                       // port-local px (what overlay children position with)
  clientX, clientY,
  ndc: [x, y],
  ray: { origin, dir },
  hit,                        // lazy: { id, point, normal, distance } | null, the nearest shown object (no vertex snap); a dblclick's: its first press's (Double-clicks, below)
  widget,                     // lazy: { owner, onTop, distance, ...data } | null; a dblclick's: its first press's
  holder,                     // step 3: the holding object, null for the scene (and at every other step)
  button, buttons, pointerId, pointerType,
  shift, alt, ctrl, meta,     // the DOM's flag, or a modifier key down at the view's root, claimed or not (a touch pad's Alt: TOOLS.md §5)
  key, code, repeat,          // key events
  dx, dy, deltaY,             // move (locked) and wheel
  locked,                     // pointer lock: x, y and ndc are the canvas centre, ray and hit lie along the camera's forward ray
}
```

An extension's `input` (all parts optional):

```js
input = {
  press(ev)    → session | null,
  click(ev)    → boolean,
  dblclick(ev) → boolean,
  menu(ev)     → boolean,   // right-click, or a 500 ms touch hold
  key(ev)      → boolean,
  keyup(ev)    → boolean,
  wheel(ev)    → boolean,
  widgetAt(ev) → { onTop?, distance?, ...data } | null,  // "I have a widget here", for widgets the stage can't pick (the halo's handles, found on screen)
  cursor(ev)   → string | null,
}
session = {
  move(ev),                   // first call once the pointer passes 4 px; then every move
  end(ev),                    // released after moving
  tap?(ev) → boolean,         // released under 4 px: true = it was mine (no click follows)
  cancel(),                   // pointer cancelled, Escape, or the extension stopped; also a release under 4 px when there's no tap
  key?(ev) → boolean,         // keys during the gesture (Q/E/F while carrying)
  cursor?,                    // a cursor name while the gesture lasts
}
```

**Widgets** come from two places:
- meshes in the extension's `world()` groups (the default);
- an extension's `widgetAt`.

Either way the owner of the widget under the pointer gets step 2.
- An `onTop` widget beats any object.
- Other widgets compare by distance with the object hit.
- Subtrees whose `userData.noPick` is set are never picked.

**Clicks.** A press released under 4 px goes to its session's `tap`. If there
is no `tap`, or it returns false, the session is cancelled and a `click` goes
down the chain. While a session is open, presses from other pointers are
swallowed.

**Double-clicks.** A `dblclick`'s `hit` and `widget` are those of the press
that began it, resolved as that press was pressed, so the chain is decided
at that one moment: a thing that moved between the clicks (a boat pitching
on her sea) or a canvas that narrowed under the pointer (the inspector
opening on the first click's selection) still has the double-click. Its
`x`, `y`, `ndc` and `ray` are the dblclick's own, so `hit.point` was on the
first press's ray, not on `ev.ray`, and a moving nested stage localises
that world point with its frame now. This holds only within the router's
gates (`DOUBLE_MS`, `DOUBLE_PX` in `src/stage/router.js`): the presses at
most 500 ms apart and the dblclick at most 500 ms after the second, each
press within 6 px of it (16 px for a touch), none of them under pointer
lock, and the first hit's stage still open (a key whose stage closed
between the clicks names nothing). Outside them, or for a slower double,
the dblclick casts a new ray like any other event. A first hit whose object
the first click removed is kept: what it comes to is its consumer's. The
500 ms gates time the clicks as they were made, by each event's own
`timeStamp` (one clock for every pointer event), not as the page handled
them: a page busy between the clicks (the inspector opening on the first
click's selection) still has the double-click the browser fired, and one
catching up on queued events doesn't pass clicks made too far apart. The
dblclick is timed as the release that made it (the `pointerup` after the
second press), because Chrome stamps a dblclick when it dispatches it, not
when its release was made; a dblclick with no release heard after the last
press keeps its own stamp. When any of the three times has no stamp (a synthetic one with
`timeStamp` 0), all three are timed on the stage's clock as each was
handled instead, never one clock against the other. A driver that makes
input (a probe's `Input.dispatchMouseEvent`) gives each event its
`timestamp`, as an OS stamps a person's clicks: without it Chrome stamps
each event as it dispatches it, and a dispatch that waits out a busy page
carries the wait into the stamp. A test on the stage's manual clock that
times a double-click sets `timeStamp` on its events.

**A release that never comes.** A mouse that moves with no button down was
released where the stage didn't hear it, and a lost pointer capture or
leaving the window (blur, a hidden page) means the same: the gesture is
cancelled (`cancel`: put back, never committed where nobody saw it land),
so nothing stays open, held and following the bare pointer.

**Ordering.** Running order decides only between extensions that would both
claim the same event. An extension that handles an event without claiming it
(returns false, to observe it) only hears it if it comes before the one that
claims it, so nothing should depend on observing that way. The selection is
one value for this reason: a click that selects an object, or clears, replaces
a selected dimension too, whatever order the two run in.

**Keys:**
- They are heard on the tool's root, so only the focused view gets them.
  Focus that leaves an element in the stage for nowhere (a clicked button
  that was then removed) comes back to the root.
- Keys, pastes and drops inside a document embedded in the stage (another
  tool, such as the inspector's About) are that tool's. Whoever embeds marks
  the container with `data-stage-embed` (`EMBED_ATTR`, `fromEmbed` in
  `src/embed.js`); every pane of the drawer (`dock`) is marked so.
- **One key order** (TOOLS.md §5; `src/keymap.js`): a focused field (the
  DOM's), the open gesture's declared keys (a carry's Q/E/F), the held
  tool's, the top body's, then the chain, where the key map (`scene.keys`)
  is the only `input.key` implementer. Keys are declared as `[{ code,
  label }]`, so whether one is reserved is known before it is pressed; a
  reserved key is its reserver's even when it does nothing with it. Inside
  a menu or a dialog (`role="menu"`, `role="dialog"`) only Escape is the
  stage's.
- **Escape pops exactly one layer** (`src/stage/ladder.js`): the lock (the
  browser's own, unseen by the page), a focused field (it blurs), a popover
  (`api.popover`'s close), the gesture (put back), the held tool (put
  down), the selection, the focus. Never the body, never the clock. The
  next layer is the view's `escape`, and `scene.body` shows its hint.
- A `keyup` goes to whoever claimed its `keydown`.
- On blur, a hidden page or lost pointer lock, the stage sends a `keyup` for
  every key still down.

**Bodies** (TOOLS.md §4). The router's stack holds only bodies, the
stage's Look or Edit (the base) always at the bottom. Any other body is
contributed by an extension:

```js
bodies: [{ id, label, keys: [{ code, label }], lock, reach,   // reach: metres, or Infinity
           here?,                                               // false: it needs a place, so the body chip doesn't offer it
           enter(place) → { input, eye?() → { position, direction }, ride?: { id, at?, turn?, rise?, tilt? },
                            keys?, label?, leave() } | null }]
// keys: the codes it takes. Codes one declaration labels alike do the same thing (walk's W and ↑
// are both "Forward"): touch shows them as one control (TOOLS.md §5), so distinct actions need
// distinct labels. The same holds for a tool's and a gesture's keys.
```

The bodies there are: **Look** and **Edit** (the stage's, `src/stage/bodies.js`:
both OrbitControls, no keys, no lock, reach ∞; Edit takes a click ahead
of the chain and selects with it, and the editor's chrome is its alone;
Look has neither),
**walk** (`walk/`: WASD, lock, 2 m, standing on
whatever the rays hit and riding it), **seat** (`seats/`: no keys, no lock,
2 m, `here: false`, riding its table), and sailing's **aboard** (her navmesh
walker on her deck, 2.5 m) and **station** (pushed over aboard by a
station's verb, `here: false`, its keys by station). The first running
extension to offer an id has it (`look` and `edit` are never an
extension's). `view.start` enters one on arrival ("Arriving").

**Conventions for bodies.** Nothing stands on Edit: entering any other body
from Edit turns the base to Look first, so editing while walking or seated
isn't possible, and Leave never falls back to Edit. `api.body.enter("look")`
or `("edit")` (the body chip's first two entries) leaves every body over
the base and makes that one the base (the router's `setBase`). A package
asks "is this viewer on the orbit camera?" by `view.body.depth === 0`, and
"is this viewer editing?" never: it marks an editing command `edit: true`
instead.

`api.body.enter(id, place)` runs `enter` and pushes what it answers (its
`keys` over the body's, its `label` over the body's: the chip and who's here
say "Helm" for sailing's station at the wheel, "Watching" for a seat body
entered with no seat of yours); `api.body.leave()` pops the top (never
the base), and the body under it carries on (`input.resumed`); a body popped
from under another takes those over it with it; an extension stopping pops
its bodies. The top body's `input` hears every pointer move and the keys
it declares, and is offered presses after the chain; one pushed over is
`suspended`. The body is the source of `from` (its eye) and `reach`, which
every surface passes (`api.context`). Its ride, if any, is the only ride;
else the orbit camera's base rides apply.

**The held tool** is one slot per view, published as the view's `held` (`{ ext,
command, name, keys, pointer }`, or null). A command that declares `tool:
{ keys?, pointer? }` is a tool: running it holds the input its run returns
(running it again puts it down). Measure is one (`pointer: true`: it wants
the pointer free), arena's gun another (`keys`: R reloads). `api.hold({
name, keys?, pointer? }, input)` holds one not picked up through a command
(a bag's drawn piece; its `command` is null). Holding another, Escape, or
its extension stopping puts it down (`input.put()`). It is offered every
event first, and its declared keys are its own.

**The pointer** (`src/stage/pointer.js`): the top body asks for lock; the
view grants it while nothing else wants the pointer (a held tool with
`pointer: true`, a selection, an open popover or drawer). The browser's
Escape releases it; the next press on the world only relocks. A refused
lock leaves the body looking by drag, and so does touch (`touch`: every
press on the view, wherever it lands, edges included, says whether it was
a finger; a coarse pointer starts as touch; keys never change it). A finger
on a locked view lets the lock go and leaves nothing released; a mouse
after touch finds the lock released, so the next press on the world only
relocks (TOOLS.md Decisions 9). `locked ⇔ body.lock ∧ ¬wanted ∧ ¬released
∧ ¬refused ∧ ¬touch`.

## `api`

Each extension gets its own `api`. Everything acquired through it belongs to
that extension.

**Doc and identity**

| | |
|---|---|
| `id`, `repo`, `handle`, `url`, `viewer`, `session`, `signal`, `Counter` | `Counter` is the stage's automerge Counter. `session`: this view's presence session, what its claims and holds name (two tabs of one viewer are two sessions; it changes on coming back from the back-forward cache) |
| `doc()`, `change(fn)`, `newId(prefix)` | |
| `writable()` | may this view write the doc: false in a pin or a mirror, and where the handle refuses writes (Keyhive's to answer, in time). The halo shows no handles where it's false |
| `scene()` | the snapshot: `{ d, objects, ids, parents, groups, members, traits, world(id) → 4×4 as stored, toLocal(id, p) }`. `members`: group id → the objects in it, at any depth |
| `ops` | pure planners (`src/ops.js`). Each takes the snapshot and returns a change function or null: `api.change(ops.ungroup(api.doc(), id))` |
| `remove(ids, { edit? })` | remove in one change, after each extension's `beforeRemove(draft, ids)` tidy-up. Best effort only: concurrent edits can still leave dangling ids. With `edit` (an `edits` step), the change is that edit's |
| `edit(fn, { label?, handle? })`, `edits(label)` → `{ change(fn, handle?), end() }` | the stage's own editing (TOOLS.md, Decisions 2; "Undo" below): `edit` writes `fn` as one undoable step of this viewer's, on the scene or on `handle` (an object's render doc); `edits` opens a step of several writes, passed as `{ edit }` to `addObject`, `remove`, `drop` and `part` or made with its `change`, closed by `end()`. The halo, the handles, the inspector, the outline, transfer, add, the parts bin, dimensions and Set home view write through it. **Only the stage's own parts' api has these four** (`stage/own.js`: a module this package marks); a package's api has none, so its verbs, clock acts and process saves can't be on a stack |
| `undo()`, `redo()` → boolean | take back (or again) this viewer's last edit in the focus doc: false when there's none, the doc isn't writable, something it wrote has been written since (then it's dropped, whole, and said), or it showed or decided something others have a stake in (then it stays, and that's said). `scene.undo` binds ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y and the toolbar's Undo and Redo to them |
| `claim(id, kind, { onLost? })` → release \| null | take a claim of `kind` on an object (`id` null: the scene); null when another view, or another extension here, holds a live one. See "Claims". The scene's `"clock"` claim is the stage's own (see "World time") |
| `claimedBy(id, kind)` → `{ viewer, session, mine }` \| null | who holds it, if they're still here. `mine`: this view (any of its extensions) |
| `registry(type)` | |
| `port`, `root` | the element the canvas fills, and the stage's root (for DOM listeners: drops, pastes; focus) |

**Local, prefs, presence**

| | |
|---|---|
| `local` | `{ get, swap, watch(fn, select?) }` |
| `pref(key, fallback)`, `setPref(key, value)` | read through local and then the doc, as above. Set writes local only |
| `presence` | `{ set(key, value), get() → { [session]: { viewer, body, held, at, keys: { [ext]: { … } } } }, watch(fn), rate(hz), shownAt(session) }`. Keys are namespaced by the extension and cleared when it stops. `body` (`{ id, label }`) and `held` (`{ name }` or null) are what that peer's view says of its viewer on every channel it acts on (who's here: someone seated at a game linked elsewhere shows seated to a viewer of the game alone). `rate(hz)` raises how often this view's presence goes out, and its held poses with it (a simulation streaming a hull asks for 30 or 60). `shownAt(session)` is the moment, on that peer's clock (ms, its stage's `time.now()`: "Time"), whose held poses this view is drawing now, or null before any pose of its has arrived: something else that peer streams with its own timestamps (a sea's clock) is shown at the same moment as its holds by asking this, never by guessing the playout delay |
| `send(type, data)` | a one-off message to the same extension on every other peer, delivered at most once and never replayed. Received through `instance.receive(type, data, { session, viewer })` |
| `notify(text, kind?)` | |
| `packages` | `{ load(urls?) → Promise, dismiss(urls?) }`: the viewer's answer to the packages prompt (see "Packages"). `load` is a yes: it loads what's asked about or failed (all, or those of `urls` among them) and remembers what loads. `dismiss` asks no more in this view |

**Content**

| | |
|---|---|
| `nameOf(id)` | what this viewer sees, lenses applied |
| `content(id)` | `{ loaded, box, extras, stats, root }` or null. `extras` holds the GLB's extras: `connectors` (normalised), `snapRadius`, `legend`, and the scene's own. `root` is the live three.js node, for reading geometry (dimensions' on-surface test). Never change it, with one exception: **dressing**. An extension may move, scale or hide `root` and the nodes in it for objects that carry one of its own traits, each view for itself (a buoy bobbing on the waves, a sail lowered), and puts them back when it stops. Dressing is only a look: `box`, `worldOf`, picking and the shadow map go by the object's pose, not the dressed nodes, and nothing is sent |
| `loadState(id)` | where its content was routed at sync, `content`: `"built"` (the render manager), `"file"` (the GLB queue) or `null` (nothing to load: its provider isn't here, phase `"no-provider"`), with a copy of what the manager or the queue last said about it (notes, phase, contested, providerId, builtAt, builtHeads, bounds, retryAt, fixed, at, versionMissing…); null for a group or an unknown id. See README.md, "Content is routed at sync" |
| `box(id, { hints, in })`, `groupBox(id)`, `sceneBox()` | world `{ min, max }`, or null. `in`: an object's id, for the box in that object's displayed frame (from the object's own geometry, never a world box boxed again) |
| `worldOf(id)` | the displayed world matrix: held poses, and peers' played back, included; what is drawn this frame. `scene().world(id)` is the doc's |
| `focus(ids)` | load these first |
| `audience(id)` → `"all"` \| viewer[] \| `null` | who may see what this object is: every running extension's `audience` answer for it, merged. `null`: unknown, tell nobody. See "Audience" |
| `shown(id)` → `"all"` \| viewer[] \| `null` | who it is turned toward, before anything screens it (the union of the `show`s alone). `audience ⊆ shown` |
| `providersFor(url, doc)`, `addObject(url, opts)` → id | `opts`: `{ id?, providerId?, name?, group?, parent?, before?, transform?, heads?, hint?, fields?, render?, edit? }`. `id`: the new object's, made with `newId` beforehand (a copy maps its ids first, so its references are written once); refused when the scene has it. `heads`, or heads in the URL (`automerge:<id>#<heads>`, a Patchwork link at a version), adds it fixed at that version of its source (the object's `at`). `fields`: more of the object, in the same change (a copy's traits, tags, colour…; never the fields addObject sets itself, nor `claims` or `saved`). `render`: a render doc to start the new one from: its `params` when it's by the same provider, and its build too when it's of the same source (a copy's) |
| `rebuild(id)` | |
| `fixPoint(id)` | the `at` (`{ heads, deps? }`) that would fix an object at exactly what it shows now: a render-doc object at what its render was last built from; a live link at its doc's heads, with every doc reached through it in `deps`; else null (not built or open here yet, not loaded, a file, already fixed). Fixing is a plain field write: `api.change(ops.setField(scene, id, "at", point))`; `undefined` follows the latest again |
| `drop(info, { edit? })` | offer a dropped doc to the extensions that lay out its datatype; with `edit`, the drop context's `change` and `addObject` are that edit's |
| `template(id)` → `Promise<boolean>` | run a `scene:template` (see "Templates"); true when it ran |
| `part(id, at, { edit? })` → `Promise<string \| null>` | run a `scene:part` at `{ parent, transform }` (see "Parts"); selects and returns what it made; with `edit`, what it writes is that edit's |

**Picking and camera**

| | |
|---|---|
| `pick(x, y, { ground?, snapPx? })` | port-local px → hit (with vertex snap if asked) |
| `ray(x, y)`, `raycast(origin, dir, { far?, skip? })`, `project(p)` → `{ x, y, visible }` | a raycast hit is `{ id, point, normal, distance, back }`: `normal` faces the ray; `back` says the ray met the face from behind (from inside a closed solid) |
| `camera` | `{ get() → { position, target, fov, up }, set({ position, target?, quaternion?, fov?, near?, far? }), frame(box), hold() → release, ride(id, { turn?, rise?, tilt?, at? }) → off, limit(spec) → off, touched(), watch(fn), onEnd(fn) → off }`. `touched()`: the camera has been placed for this viewer (moved by them, or restored as the view opened; to a general part, also carried across a focus move), so nothing frames it on its own. `onEnd`: someone finished moving the camera (an orbit, a zoom), never while it's held. Everything is in the stage's frame (`get().up`: the picture's up, rolled as the camera is, turned as directions are); the three.js camera is the view's, and no extension holds it |

**The view, links and surfaces** ("Views, stages and links" above)

| | |
|---|---|
| `view` | `{ get(), watch(fn, select?), select(target), enter(linkId) → boolean }`, and a general part's `reopened(title)`: the viewer's local value as this stage sees it ("Three places for state"), selecting this stage's target (cut at the focus), and entering one of its links |
| `link(id)` | `{ role: "acting" \| "mirror" \| "pinned" \| "closed", open, reason? }` for one of this doc's links: what the view made of it here, and whether its doc is drawn |
| `collect(name)` | `[{ id, value }]`: running extensions' contributions of that name, in running order; a general part's from every acting stage, each item tagged with its `stage` |
| `run({ stage?, ext, command, target, value?, hit? })` | run a command, in the context surfaces compute (`context` below); `stage` (a general part's) runs it in that stage |
| `path({ focus? })` | a general part's only: the input path's stages, attention's innermost first then the focus stage, each `{ stage, scene, collect, context, attention, look, run, nameOf }`; with `focus`, the focus path |

**Bodies, the held tool, attention** (TOOLS.md §3–§5; "The input chain" above)

| | |
|---|---|
| `body` | `{ current() → view.body, enter(id, place) → boolean, leave() → boolean, eye() → { position, direction } \| null, reach() }`: any running extension's body, entered at `place` (an object id, or null for "here") |
| `hold({ name, keys?, pointer? }, input)` → put | hold a tool not picked up through a command (a bag's drawn piece), declared here, with this input; whatever was held is put down |
| `popover(close)` → release | an open menu or dialog: it wants the pointer, and Escape closes it (`close()`); release when it closes itself |
| `context(hit?)` | the command context every surface passes: `{ scene, local, view, from, reach, hit, distance(target) }` |
| `attention()`, `look()` | `{ selected, hit }`; the look's hit, `{ id, point, distance }` or null |

How the camera parts behave:
- **Hold.** While anything holds the camera, orbit is off and not updated,
  nothing auto-fits near and far unless the holder sets them, and nothing is
  saved. The last release re-seats the orbit target in front of the camera.
- **Riding.** `ride(id, { turn = true, rise = true, tilt = false, at })`
  (`id` null: the stage's root, which in a linked doc is the link)
  carries the orbit camera with an object, as a passenger: every frame,
  after the loops have moved what's drawn and before the orbit updates, the
  camera and its target move by how the object moved since the last frame
  (the shift of its point `at`, in its frame, else its origin; its turn
  about the vertical through that point, if `turn`; its rise and fall, if
  `rise`). Ride the point you look at (a seat rides the spot on the table
  its view is aimed at) and it holds still on screen. It follows from the
  frame it's asked in, so set the view from `worldOf` and ride at once.
  Roll and pitch are followed only by a ride that says `tilt`: then the
  camera moves with the object whole and its up is the object's (the seat
  body's ride tilts, so a seat at a table aboard rolls with the table);
  otherwise the orbit keeps world up. One ride
  applies at a time: the top body's own, when it has one (a seat rides its
  table), else the latest base ride (`camera.ride`: a ship keeping herself
  in view, which orbit rides), so a seat at a table aboard a ship wins with
  no flag. While the camera is held nothing rides it, and a ride
  starts again from where the object is then, so first person wins and
  nothing jumps after. It doesn't stop an orbit in progress. Set the view
  first (from `worldOf`, say), then ride. `src/stage/ride.js` is the maths.
- **Limits.** `limit({ minPolar, maxPolar, minDistance, maxDistance })`
  limits intersect.
- **Saving.** The camera is this viewer's. It is kept in `localStorage`
  (`scene-camera:<url>`). On open it comes from there, else
  `doc.view.start.home`, else a framing.

**Drawing**

| | |
|---|---|
| `THREE` | the stage's three.js |
| `world({ onTop? })` | a `Group` owned by the extension. Its meshes are widgets the owner gets first refusal of. `onTop` groups are drawn in a second pass over everything (depth-tested among themselves, lit) |
| `labels()` | `{ set(items) }`, where `item = { key, text, position? \| ends?: [p, p] \| screen?: { x, y }, className?, data?, rank?, onPointerDown? }`. Every extension's labels are decluttered together: one gives way to an overlapping label of higher (or equal, earlier) `rank` (default 1), and rank 2 and up never hide. The editor's: dimensions 3, axes 2, bounds 1, grid 0 |
| `overlay()`, `edge("top" \| "right" \| "bottom" \| "left")` | DOM owned by the extension. An overlay sits over the canvas and lets the pointer through, except that its direct children catch it by default (a rule with no specificity, so any extension rule wins): a full-size child (a HUD) sets `pointer-events: none`. An edge sits beside it, and the canvas shrinks to fit |
| `dock(el, { title, onClose?, embed?, show? })` | `close`. Docks `el` in the drawer: one panel at the stage's right, outermost, with a tab per docked element (its title and a ×), one pane shown. Docking shows it (`show: false`: behind the pane shown, a tab to pick, unless nothing else is docked; the inspector following the selection docks so, not covering the parts bin in use); closing the one shown shows the one shown before it; tabs keep docking order; with nothing docked the drawer takes no room. It closes by `close()` (idempotent), by its ×, or with its extension; only the × calls `onClose`, so the caller hears of the closes it didn't make. Docking an element already docked shows it (retitled) and returns its `close`. A pane is an embedded document: keys typed in it are its own; `embed: false` makes it the stage's own chrome instead, whose keys are the stage's (the inspector, the outline, dimensions and parts: `src/parts/tab.js`), and while one of those is shown the drawer is a side panel's width rather than a docked editor's. `src/stage/dock.js`; Camber's Shape, a die's and a bag's panels use it too |
| `style(css)`, `listen(target, type, fn, opts)`, `cursor(name)` | |
| `pose` | `{ hold(id, transform, { yields? }) → boolean, release(id, { landed? }) }`. `hold` says whether the hold stands: holds go in one order (see "Holding a pose"), and one that doesn't rank first is refused |
| `heldBy(id, { yields? })` | the peer session whose hold on this object ranks ahead of this view's, or null: the one it has, or else one it would begin now, of the kind `yields` says (by default what it holds, else a person's). So a person isn't kept off by a peer's yielding hold, and of two that grabbed it at once exactly one is told to let go (the carry and the halo put theirs back) |
| `extent(box \| null)`, `invalidate()`, `loop(fn(dt, now))`, `afterRender(fn(renderer, size))`, `schedule(fn)` | |
| `ambient(name)` → `null \| { value, mine, frame, clock }` | the world's ambient under `name` ("Ambients"): the outermost stage's stacked value (frozen plain JSON, the same object to every caller until it changes), `mine` (this is the outermost stage), this stage's frame (scope.js: the world is the outermost's root) and the outermost's world time now, `{ t, running }`. null when the outermost offers none. Read it once a frame and compare identities: nothing is pushed |
| `clock` | `{ t(), running(), computer(), pause(), resume(), process({ start?(t), step(dt, t), save?(d), stop?(), replicated? }) → remove }`: the doc's world time; `computer()` is who computes it (`{ viewer, session, mine }` or null). See "World time". And the stage's own time, which acts and liveness run on and which never pauses: `now()` (ms), `after(ms, fn) → cancel`, `frame(fn(now)) → cancel` (once, at the next frame); what they set is cancelled when the extension stops. See "Time" |

How poses and loops behave:
- **Holding a pose.** `pose.hold(id, transform)` shows an object at that
  local transform while it's held, under its doc parent. Peers see it: at
  most one pose per object goes out every 50 ms, or faster when this view's
  presence rate is higher (`presence.rate(60)` streams at 60 Hz).
- **One holder, in one order.** An object has one holder, the same in every
  view: holds rank a person's before a *yielding* one (`{ yields: true }`:
  a process's, which gives way to a person, as a hull nobody steers or a
  door closing itself does), then the first begun (`since`, a Lamport
  stamp), then the session. Here, a hold by another extension stands unless
  it yields and the new one doesn't; across views, a hold is refused while
  a peer's ranks ahead, and one this view has goes as soon as a peer's does
  (its holder's next `hold` returns false). `src/stage/holds.js`; the order
  is `presence.js` `ranksAhead`. There is no silent last-hold-wins. A
  holder reads the answer every time: one whose hold is refused doesn't
  have the object, so it writes nothing for it (carry and the halo put it
  back, a door's motion lets go, a ship's hull isn't stepped while someone
  else holds it).
- **Peers play holds back smoothly.** A peer doesn't snap to each pose it
  hears. It plays the stream about 1.5 send intervals late (75 ms at 20 Hz),
  drawing the pose between the two either side of that moment (position and
  scale lerped, rotation slerped), timed by the sender's clock so the wire's
  jitter isn't shown. If the next pose is late it carries on along the last
  step for one interval, then eases back onto the last pose over another and
  holds it there, so a drag that paused is shown where it really is. A simulated hull and a carried card are
  the same thing to the stage, so there is no flag for it: one kind of hold,
  always played back this way. The price, 75 ms more lag on a peer's view of
  a carry, buys a carry without the 20 Hz stutter too. A landed release still
  shows where it landed at once.
- **Readers see what's drawn.** The playback moves before any extension's
  loop runs each frame, so `worldOf` and `raycast` in a loop see this frame's
  pose: a walker on a moving deck stands on the deck as drawn. The playback
  alone doesn't call `update`; a new pose arriving does, as before. To follow
  a moving object every frame, read `worldOf` in a loop.
- **Releasing.** Call `release(id, { landed: true })` right after writing the
  put-down to the doc. Peers keep the pose until their doc shows the same
  transform, or 3 s pass. A plain release puts the object back at once.
- **Loops.** While any loop runs, the stage renders every frame, and `dt` is
  clamped to 0.1 s.

### Claims

Who is at the helm, who simulates the ship, whose hands a bucket is in: facts
about the shared world, so they're in the doc. A claim is a field on what's
claimed, `objects[id].claims[kind] = { viewer, session }`, or
`doc.claims[kind]` for the scene (`id` null). `kind` is any string
(`"station"`, `"held"`, `"seat:<id>"`); kinds are independent. `"clock"` on the scene is the stage's (see "World time").

- **Taking** (`api.claim(id, kind, { onLost })`) writes the field and returns
  a release, which deletes it if it's still this view's. It returns null when
  someone else holds a live claim of that kind: another view, or another
  extension of this one. Taking it again from the same extension returns the
  same release.
- **A claim counts only while its holder is here.** `claimedBy` reads a claim
  whose session isn't in presence (and isn't this view's) as null: it has
  lapsed, so a tab that died at the helm doesn't hold it forever, and nothing
  has to clean up after it. The next taker writes over it. A lapse is a
  presence change, not a doc change: something waiting to take over watches
  presence or checks in its loop.
- **The grace period.** A session this view has never heard from in presence
  still counts for 6 s (a heartbeat and a second) from when this view first
  read its claim: a peer that has just joined may write its claim before its
  hello gets here, and a view that has just opened hasn't heard anyone's
  hello yet. A session that was here and has gone (a bye, or silent for the
  presence TTL) lapses at once.
- **Concurrent takers are Automerge's to settle.** Two views taking the helm
  at once both get a release; the merge keeps one claim on every peer. After
  every doc change the stage looks at this view's claims: one whose field now
  names another session is gone from this view, and its taker's `onLost` is
  called once. One whose object was removed is lost too. One whose field is
  simply missing lost no contest (two views giving an object its first
  `claims` map at once keep only one of the maps), so the stage writes it
  again. This is the one map two peers may both create: whichever wins, the
  claims in it are re-asserted by their holders.
- **Letting go.** The release, the extension stopping (no `onLost`: it let
  go), and the page going away. On `pagehide` the view deletes its claims
  before its bye; back from the back-forward cache, as a new session, it
  writes them again, or calls `onLost` for any someone took meanwhile.
- **Motion stays in presence.** A claim says who; a pose hold says where,
  right now. The view computing the doc's clock holds `"clock"` and its
  processes stream the hull with `pose.hold`.

### Time

Everything in a stage that moves with time takes it from one source
(`src/stage/time.js`): the frame loop (and with it every `loop`, the bodies'
walking and looking, a ride, peers' poses played back), world time (the
clock ticks once a frame at the source's now), the timers that wait (a
pose's keepalive and TTL, an extension's linger, arriving's polling and its
content wait, a claim's grace, a notice's life) and the stamps (presence
samples). An extension reads it as `api.clock.now()` and sets timers with
`api.clock.after(ms, fn)` and `api.clock.frame(fn)`: a die's tumble, a
door's motion, a seat's confirm, a gun's reload, lots' deadlines. Never
`Date.now`, `performance.now`, `setTimeout` or `requestAnimationFrame` for
anything that moves or waits in the scene.

- **Real** (the default): `now()` is `Date.now()` (peers compare their
  stamps on it), frames are `requestAnimationFrame`, timers `setTimeout`.
- **Manual** (`manualTime()`): the host element's `time` (beside `repo` and
  `viewerId`) replaces it. Nothing moves until it's stepped: `tick()` runs
  one frame of exactly `frameMs` (1/60 s): the timers due by its end, in
  due order (`now()` reads each one's due time while it runs), then the frame
  callbacks asked for before it. `step(n)` runs n back to back, an
  event-loop turn after each (promises and loading land between frames), and
  only the last draws: a frame not drawn moves everything and skips only the
  picture (the viewport keeps the matrices and depth range picking reads).
  `until(pred, { frames, what, state })` steps until `pred` holds, or throws
  saying what it waited for and what it saw. Several stages given one
  manual clock run in lockstep. Its now() starts at 1,000,000 ms, small
  enough that a frame's length survives subtraction. A manual clock has no
  frame budget: the update flush coalesces by pass count alone, never by
  what a pass cost on this CPU.
- **Who uses manual time.** The browser probes (`probes/cdp.mjs`, "Simulated
  time"): their pages mount every stage on one `manualTime()` (from the
  built bundle's `loadTime()`) as `window.__time`, and step frames as fast
  as the CPU allows, so a run is the same run every time. Tests use it, or
  `wallAt(get)` (`src/test/stage-harness.js`) for a wall they set.
- **What stays on the wall,** because it waits on the world outside:
  loading (a package's load timeout, the registry settling, content builds
  and their retries, a contact's name from the network) and the cost of
  work (`perf`, CPU time). A die's own panel outside any stage (the dice
  package's tool) has no stage, so its lots run on the wall.
- **Checked.** `time.test.js`: N frames move now() by exactly N frame
  lengths; nothing reads the wall, sets a real timer or asks for a real
  frame in manual mode; timers fire in due order in the frame they fall in,
  over every order of setting them; processes see the same grid steps at
  60, 24 and 7 Hz and on the browser's frames. `time-stage.test.js`: a
  mounted stage on a manual clock moves only when stepped (its process, a
  timer, a frame, a notice's life) and calls none of `Date.now`,
  `setTimeout`, `setInterval` or `requestAnimationFrame` while it runs.

### World time

The doc has one clock, `doc.clock = { running, t, by? }` (absent: running
from 0; made with the doc, see "Shared maps"), and its processes: what the
extensions in its stage register with
`api.clock.process` (a sea and its ships, a door closing itself). TOOLS.md
§7 is the design; `src/stage/clock.js` the whole of it.

- **Who computes.** World time passes only while one view computes it: the
  one holding the doc's `"clock"` claim (on the doc, under the claim rules
  above), which the stage takes for a view that is eligible (its stage acts,
  its doc is writable, its tab visible, everything the doc calls for running
  and every listed package here) and has a process. It steps every kept
  process; the others follow. Nobody present, no time passes. It lets go
  when hidden, paused, no longer eligible, or on `pagehide`.
- **t.** `api.clock.t()` is this view's world time (s), which never goes
  back. The computer's runs with the stage's time ("Time": the wall, in a
  browser), at most a quarter second a frame.
  A follower's runs toward the computer's at the moment whose holds it is
  drawing (`presence.shownAt`), never past the newest the computer has said
  (its `{ t, at }` under the presence key `scene.clock`, at 10 Hz): so a
  hull sits on the waves drawn under it. Paused, every view's t is
  `clock.t` once the computer's checkpoint arrives. With nobody computing,
  `clock.t`, still.
- **Processes.** `process({ start(t), step(dt, t), save(d), stop() })`: the
  computer calls `start` at its t (warm from what the process has followed,
  else cold from the doc: the process's call), `step` on a fixed grid of
  world time (1/60 s), `save` at checkpoints, `stop` when it lets go (or
  another view wins the claim: then nothing is saved). A `replicated: true`
  process is stepped by every view that runs it, at its own t, on the same
  grid: a deterministic engine every present peer runs from a shared input
  log (machine/HOST.md). It makes a view eligible like any process, so
  someone moves t; only the computer calls its `save`; paused, it's stepped
  only up to `clock.t`, the pause point every view has.
- **Checkpoints.** On pause, on letting go and every 30 s while computing,
  one change writes `clock.t` and every process's `save(d)`. A process
  saves only what it still holds. Each object whose transform a save wrote
  is stamped `saved: t`: a write that moved it otherwise (the halo, the
  inspector, a paste, a carry) changes the transform and not the stamp, a
  late checkpoint both, so a process can tell them apart (sailing restarts
  a hull moved by hand at rest). `saved` is the stage's field, like
  `claims`.
- **Pause and resume.** Anyone who may write: `pause()` writes the
  clock's fields `running: false, t, by: viewer` (the computer in the same
  change as its checkpoint), `resume()` `running: true, t, by`. The stage
  writes `doc.clock` field by field, never whole, so a pause made as a
  checkpoint lands keeps its `running`; two pauses at once each write a t
  and the merge keeps one, and if it kept the follower's, the view that was
  computing writes its own again (no view has passed it), so all meet
  there. Two resumes or two pauses settle `by` by last writer, and the chip
  names who won. One clock per doc: pausing a host doesn't pause a linked
  doc's processes.
- **Who computes, asked.** `api.clock.computer()` is `{ viewer, session,
  mine }` for the view computing now, or null: a process that follows
  (sailing's ships, reading what the computer publishes in presence) asks
  this, not the claim.
- **Three times.** World time is only for what pauses with the world
  (processes, a door's wait). An *act* (a die's tumble, a carry, a door's
  motion once begun) runs on the stage's time ("Time": `api.clock.now`,
  `after`, `frame`), and finishes during a pause; *liveness* (presence
  TTLs, claim grace, a lots deadline) is the stage's time too, and never
  pauses.
- **Its numbers.** `clock.t` is written on a microsecond grid, rounded up:
  Automerge 3.3.0 stores 0.9999999999999999 assigned inside a new map as 0.

### Undo

Undo covers the stage's own editing writes only (TOOLS.md, Decisions 2),
per person and per focus doc, as inverse changes (`src/undo.js`):

- **What is an edit.** A write through `api.edit` or an `api.edits` step:
  the halo's move, rotate and scale; the build-param knobs (on the object's
  render doc, undone from the scene's stack); the inspector's fields,
  behaviours and Starts in; the outline's rename, re-file and new group;
  Delete; add (a drop laid out by an extension is one step with it); the
  parts bin; copy in and paste; dimensions; Set home view. A package's verb
  (a roll, a shuffle, a draw), a clock act (pause, resume, a checkpoint) and
  a process's save are plain writes, never on a stack, so undo can't
  un-roll a die, un-shuffle a deck or rewind a process.
- **A step** is what it wrote, recorded from the change's own patches
  (`handle.change(fn, { patchCallback })`), so nothing written meanwhile by
  anything else is in it: leaves `{ path, before, after }`, a path cut at
  its first list index (a list is one value), none under another.
- **Undoing** writes every leaf's `before` back in one change, only when the
  doc still holds every leaf's `after`; if anything the step wrote has been
  written since (by a verb, a process, a peer, or another edit not yet
  undone), the step is dropped whole and the viewer told ("Nothing to undo:
  “Move” has been changed since."). So undo never reverts anyone's later
  write, and never half an edit. The undo is recorded the same way, as the
  redo step; a new edit clears redo. 100 steps a stack.
- **Reveals and decides need the others' agreement.** Recording a step,
  the stage judges it from the doc before and after (`judgeEdit`): it
  *showed* an object when who may see what it is grew (every running
  audience policy, on both sides; unknown on either side counts), and it
  *decided* one a running extension's `decided(before, after)` names. Taking
  such a step back asks every running extension's `parties(scene)` who has
  a stake in those objects now; if anyone but this viewer does, it is
  refused ("Can't undo “Move”: it showed or decided something, and taking
  it back needs the others' agreement.") and stays on the stack, so a party
  who stands up frees it. Nothing answering: no parties, free (two people
  editing a CAD scene); a `parties` that throws: can't be told, refused.
  While a listed package is missing or an extension the doc calls for
  hasn't started, no audience is known, so every step counts as showing
  everything: at a seated table with a declined package, no stage edit can
  be taken back while anyone else is seated, and the refusal says why
  ("…who could see what it changed can't be told (a package the scene uses
  is missing or didn't start)…"). How agreement is asked and given is not
  designed yet (TOOLS.md, Decisions 2).
- **Kept contents don't come back.** A step that removed objects bound to a
  keeper (by the trait of an extension whose plugin says `keeper`) is
  undone as the doc held them, and says so: "what is kept for “Deck” comes
  back as its keeper has it now, not as it was". Undo never invents state
  it didn't see.
- **Per person, per doc.** Each stage keeps this viewer's stacks for its
  doc (its `local.edits` says what they'd take); Undo and Redo are general
  parts', so they take back in the focus doc.

## `instance`

| | Read by |
|---|---|
| `update(scene, local, prev, view)` | the stage, once per UI flush when the doc, the stage's local state or the view (as this stage sees it, `api.view.get()`) changed; `prev` = `{ scene, local, view }`. Also when what's shown changed without any (content arrived, a pose was held or let go, a lens changed): then `scene === prev.scene`, `local === prev.local` and `view === prev.view`. If what's shown changed in the same flush as the doc or local state (a rebuilt GLB lands as its status goes back to idle), that second call comes too, right after the first. A pose alone moves boxes, so something that follows content should look at what has loaded (`content(id).loaded`, `local.status`), not the box |
| `looks()` → `Map id → { sourceUrl?, name?, veil? }` | the stage (lenses combine in running order; later wins per field). `veil: true`: the stage draws its stand-in instead of the object's content. See "The veil" |
| `audience(scene)` → `(id) → { show?, only? } \| null` | the stage, for `api.audience` and `api.shown`: this extension's policy for who may see what an object is. See "Audience" |
| `parties(scene)` → `(id) → viewer[] \| null` | the stage, when an edit that showed or decided something is taken back ("Undo"): who has a stake in this object (seats: the people seated, here or away; not watchers). `null`, or no extension answering: no stake. One that throws (`parties(scene)` or its function) can't be told, and the take-back is refused, as a throwing audience policy hides |
| `decided(before, after)` → id[] | the stage, when an edit of its own is recorded ("Undo"): the objects whose outcome that change took from shared randomness or hidden state. Nothing answers it yet: no stage edit draws or rolls |
| `ambient()` → `{ [name]: json \| null }` or null | the stage, every flush: the values a world has once (its atmosphere, its water) that this extension offers. Stacked per name in running order (a later value wins whole, `null` clears), copied into frozen plain JSON (a value that isn't is refused, with a warning); the outermost stage's are the view's. See "Ambients" below |
| `input` | the stage |
| `receive(type, data, from)` | the stage |
| `beforeRemove(draft, ids)` | the stage |
| `commands` | surfaces and key maps |
| `hud()` → `[{ text, state }]` | status surfaces |
| `landing(id, worldPoint, hitId)` → `{ faceUp? }` | the carry (`scene.carry`). It carries, snaps, flips and puts down in the frame of the object's doc parent as drawn (the world at the root), so a piece on a moving table stays on it; the point it asks about is still in the world, as drawn |
| `carryable(id)` → `false` to veto | the carry: false from any running extension and it neither picks `id` up nor flips it just now (anything else allows). Only for passing states (a die under a cup): what can be carried at all is the `scene.carry` trait's. Asked each time |
| `carry(id, ev, opts)` → session | anything that wants to carry (`scene.carry` provides it; it carries only what has the trait) |
| `bodies` → `[{ id, label, keys, lock, reach, here?, enter(place) }]` | the stage's body stack ("Bodies"): the seat body from `seats`, the walk body from `walk`, sailing's aboard and station. Sitting down from walking pushes the seat body over the walk body; standing up pops it |
| `dispose()` | the stage |

A **command**:

```js
{ id, name,
  key?: string | string[],   // KeyboardEvent.key values (letters in either case)
  show?: string[],           // the surfaces that show it ("toolbar", "menu", "inspector", "use"); [] none; absent all
  hold?: boolean,            // the use prompt shows it as "hold F" (the session is what holds)
  reach?: true,              // applies only within the body's reach (below)
  edit?: true,               // the editor's: applies only in the Edit body (below)
  tool?: { keys?: [{ code, label }], pointer? },  // a tool: run's answer is the held tool's input ("The held tool")
  state(target, ctx) → null | { title?, label?, checked?, value?, choices?: [{ value, label }], options?: [{ value, label }], disabled? },
  run(target, value?, ctx) → void | session | input }   // ctx: api.context(hit), the same one state was asked in
```

- `state` returning null (or false) means the command doesn't apply to that
  target. Keys work whatever `show` says.
- `label` is the verb's name for this target, over `name` ("Lower sail" where
  `name` says "Raise sail"; "Someone's at the helm"). Every surface that shows
  a command's name shows it.
- `options` makes a command run with a set of its values: the inspector
  shows a checkbox for each beside the button, none ticked (a new
  selection starts again), and the button runs it with the ticked values,
  in their order, as `value`; every other surface runs it with no value.
  Extract and Bundle take the root traits that go along so.
- `title` is the tooltip. On a `disabled` command it's the reason ("Follow
  latest to shape"), and the inspector writes it out after the button.
- A command without `state` applies only to the null target, the scene.
- A **target** is an object or group id, a ref, or null (the scene). See
  "Targets and refs" below.
- Surfaces call `api.run({ ext, command, target, value, hit? })`. Every
  surface computes `state` in one context, `api.context(hit)`: `{ scene,
  local, view, from, reach, hit, distance(target) }`, `from` the body's eye and
  `reach` its reach; `run` gets the same context as its third argument.
  Keys are resolved, and their hints computed, in attention's context
  (`src/parts/resolver.js` `keyContext`: attention's hit, else the look,
  so with a selection the look still decides distance and point). A command that says `reach: true` applies only within
  reach: beyond it, it is disabled with the title "too far", on every
  surface, and no surface runs it (TOOLS.md §4, H9). `distance` is from the
  eye to the hit when the look is on the target (or under it), else to the
  target's box.
- A command that says `edit: true` is the editor's (TOOLS.md §3, "What is
  Edit's"): `commandState` answers null for it unless the view's body is Edit,
  so outside Edit it is on no surface, no key reaches it, and `api.run`
  doesn't run it. The stage's editing commands say so (Remove, Group,
  Ungroup, Fix at this version, Follow latest, Set home view, Copy, Paste,
  Measure, the dimensions', the drawer tabs' toggles, Grid, Axes, Bounds,
  Units, Snap, Inspector, Undo, Redo); a package may mark its own.
- Toolbars show commands for the null target. The toolbar (`scene.toolbar`)
  shows only in Edit.
- An inspector shows those for the selection, and a menu those for what was
  right-clicked.
- **Attention** is one target per view (TOOLS.md §3): the selection if
  any, else the look (the pointer's hit, or the eye ray under lock;
  `api.attention()`, `api.look()`). The key map (`scene.keys`) tries
  attention's path (the selection; or the look's hit, then what it's
  attached to, nearest first), then the scene, whatever kind of target the
  selection is. A key reserved by the gesture, the held tool or the body
  never reaches it. `src/keymap.js` is the resolver, and every surface that
  shows a key asks it (`hintFor`): a key is shown only where pressing it
  does that (H3), so walking, Draw shows without D and is in the menu.
- **The use prompt** (`scene.use`, general: it runs in every scene) shows
  attention's verbs where attention is (the crosshair under lock, else the
  pointer): on the selection, or the first object along the look's chain
  with a keyed command shown on `"use"`, at most three, each a button, its
  key the resolver's. It shows; the key map does.
- **Held verbs.** `run` may return a session, `{ end(), cancel(), update?(dt) }`.
  The key map keeps it open while the key is down: `update(dt)` each frame,
  `end()` when the key is let go, `cancel()` when the window or the view
  loses focus, the target leaves the doc, or the command's extension stops.
  `api.run` discards what `run` returns, so elsewhere a held verb is a press.
  A held verb keeps its target until its key is up: while anything is held,
  attention is pinned to that target wherever the look goes, and the prompt
  shows the held verb (marked held, as it was when pressed, even once it no
  longer applies from where you are) and that target's other verbs, whose
  keys run on it; the held key's auto-repeat is the key map's. Once the last
  key is up attention follows the look again.

**Targets and refs.** A target is a string, or null for the scene:
- an **object or group id** names that object;
- a **ref**, `"<kind>:<id>"`, names something an extension makes selectable
  that isn't a scene object: a dimension is `"dimension:<id>"`. Object ids
  have no colon, and an id that names an object always means the object.

The selection is one target, so there is only ever one selection and
nothing to reconcile: selecting a dimension replaces the selected object,
and selecting an object (or clicking on nothing) replaces the dimension.
- The extension that owns a kind makes its refs, answers for them in its
  commands' `state` (`scene.dimensions`' Delete applies to a
  `"dimension:…"` target; Escape deselects it as it deselects anything),
  and lets go of a selected ref whose thing is gone.
- Everything that only cares about objects checks `scene.objects[target]`
  and treats any other target as nothing selected: the halo, handles,
  bounds, the outline's marks, the inspector, the selection box. Commands on
  objects (Remove) don't apply to refs.
- `scene.select` prunes a selected object that's gone, and leaves refs to
  their owners.

`api.collect(name)` returns `[{ id, value }]` from running extensions that
have that field, in running order. The stage never reads the value.

### Audience

Who may see what a thing really is: a card's face, what's under a cup. The
stage holds no secrets and enforces nothing. It gives the extensions that
do hold them (keepers, below) one answer per object, the same on every
peer, made of every policy any package contributes. `stage/audience.js` is
the algebra (pure).

**A policy** is an extension's `audience(scene)`: a function of the
snapshot that returns a function of an object id.

```js
audience(scene) → (id) → null | {
  show?: "all" | viewer[],   // exposes: face up, in your hand, turned toward you
  only?: viewer[],           // occludes: a screen, a hand's privacy
}
```

- **Pure in the snapshot**: the doc alone (`scene`), never poses, presence,
  claims or local state. Every peer then answers alike, and nothing
  flickers as something carrying the object moves. The stage asks each
  policy once per snapshot.
- A viewer is a viewer id (`api.viewer`). Seats, roles, a referee are a
  policy's business, mapped to viewer ids; the stage never learns of them.
- A policy runs by its traits, as everything does, so it never stops under
  a viewer (stopping would take its `only` with it and enlarge the
  audience): tabletop's policy is the `tabletop` extension's own `audience`.

**The merge**, over every running extension's answer for one object:

```
shown    = ∪ show                  who it is turned toward
audience = shown ∩ (⋂ only)        who may see what it is
```

- `"all"` is the top: it includes someone who is in no list (a spectator).
  With no `show` at all the answer is nobody (`[]`).
- Unions and intersections of sets: the order extensions run in never
  matters, and `audience ⊆ shown` always.
- Two fields because policies do two different things, and one intersection
  can't say both: a face-down card (shown to nobody) in your own tray
  (turned toward you, screened from the rest) is yours.
- A policy that throws is read as `{ only: [] }`: nobody. A broken screen
  hides.

**`api.audience(id)`** → `"all"` | viewer[] (sorted) | `null`, and
**`api.shown(id)`** the same for the union alone. `shown` is what lets a
keeper tell "not turned toward you" (draw its own back) from "turned toward
you and kept from you" (draw the veil).

**Unknown, and failing closed.** A missing `only` *enlarges* the audience,
so a viewer who lacks a policy must not answer as if it weren't there. Both
calls return `null`, and whoever holds a secret then reveals nothing and
hands nothing over, while either holds:
- **a listed package isn't here** (`doc.packages` names one none of whose
  plugins is registered): asked about, declined, loading or failed, it makes
  no difference, and before the registry can be read at all it is unknown
  too. `local.packages.missing` says so. It is worked out from the doc as it
  is now, so a list entry arriving in the same change as its trait already
  counts;
- **an extension the doc calls for, of what's registered here, hasn't
  started** (still loading) **or failed to start**: it may be a policy.

`update` runs when the answer may have changed: a doc change, the running
set changing (`local.running`), a package arriving (`local.packages`).

**What this is and isn't.**
- Secrets are guarded by the clients that hold them, each by its own
  reading of the doc. It is not access control: anyone who can write the
  doc can change an audience (sit down, carry a card into their tray, turn
  it over). The guarantee is the physical one: no disclosure without a
  change everyone can see.
- A release can't be taken back. Something that passed through "face up"
  in one peer's view during sync lag may have been released.
- The list is appended to by whoever adds a package's content, in a change
  of its own just after: a peer can hear of the trait before the list
  entry, and for that moment answers without the new policy.
- A policy from a package the list can't name (a dev server's copy) is
  invisible to peers: they compute a different audience and nothing says so.
- A listed package nobody needs any more still counts as missing for a
  viewer who doesn't load it.

### The veil

A look may say `veil: true`: "what this is, is kept from you". The stage
then draws its own stand-in instead of the object's content
(`stage/veil.js`): a frosted box filling the object's `hint.bounds`, a pale
padlock on its two largest faces, both sides alike, upright on an upright
face and reading from across a table on a flat one.

- It is made from the bounds alone, for any shape: nothing of what it
  stands for can reach it, and no file is made and nothing written to the
  doc for it.
- While veiled, none of the object's own content is loaded or kept loaded
  (its `sourceUrl`, a lens's, its render). When the veil goes, its content
  loads again, and the veil stays up until that has.
- `box` and picking go by the veil, which is to say by the hint. Without a
  hint it is drawn to the bounds of whatever was there, else to a 5 cm cube.
- The merge is the lenses' own: field by field, later wins, so a later
  lens's `veil: false` lifts it. A veil beats a `sourceUrl` in the same
  look.

### Conventions

Contributions the stage never reads (`api.collect`), and module exports
found through plugin metadata, by which packages that don't know each other
meet. A package that depends on one of these names the convention, never
the package that provides it.

**Seats** (provided by the `seats` package: [seats/README.md](../seats/README.md)).
The places people take at a scene: trait `seats`,
`{ [seatId]: { name, player: <viewer> | null, lasting?: false, camera?: { position, target, in? } } }`,
on the scene (the doc's own seats: its table's) or on an object (that
object's own, copied and removed with it: a machine's ports). A lasting
seat keeps its player in the doc when they get up or go; one that doesn't
last is only the claim of whoever sits in it.
It runs wherever the scene or an object has seats; it is the seat
picker, the claim that says a seat's player is here (`seat:<id>`, on the
seats' owner), the seat
body (sitting puts the view at the seat's camera, riding the object its
camera is `in`), a seat as a station on the use prompt ("Sit as Player 1"),
and "sat down" told to the others. No other package reads
or writes the trait, and the stage knows nothing of it: a scene that seats
people lists the seats package like any other.

| | |
|---|---|
| `roster` (contributed by the seats' owner) | `{ seats(scene) → [{ id, name, viewer \| null }], viewers(scene) → viewer[], open(scene) → string[], nameOf(scene, viewer) → string \| null, who(viewer) → string, sitting() → { of, seat } \| null, stateOf({ of, seat }) → state \| null, sit({ of, seat }) → boolean }`. `seats`, `viewers`, `open` and `nameOf` are the doc's own seats, its table's: a doc has one table's seats (a second game is a doc of its own, linked), and an object's seats are never among them. All but `who`, `sitting`, `stateOf` and `sit` are pure in the snapshot (the doc alone), so a policy may be built on them. `who` is what to call a viewer now (a contact's name once known, else their seat's); `sitting` is the seat this view sits in now, anywhere in the doc (`of`: the object whose seat it is, null for the doc's own; the seat body on top), which a machine's port follows; `stateOf` is any seat as this view sees it now (free, mine, taken, away…), and `sit` sits this view there as the picker does, refusing a taken or away seat silently: a machine's Play sits you at a free port this way |
| `seatPlaces` (contributed by whoever gives a seat somewhere to be) | `(scene) → [{ seat, of?, id, min, max }]`: a box in object `id`'s own frame (a hand tray) for seat `seat` of object `of` (absent: the doc's own). The seats' owner puts a name tag on each, and a look at one is a look at its seat |
| `lay(d, seats, of?)` (the module of the plugin with `roster: true`) | writes `{ [seatId]: { name, lasting?, camera? } }` into a scene doc being set up, each seat empty (a seat already there keeps its player and takes the new name, view and lasting): the doc's own, or object `of`'s on it; setup code calls it instead of writing seats |

**Keepers.** A keeper holds what objects really are, away from the scene
doc, and shows each viewer what `api.audience` allows. It is an ordinary
`scene:extension`, attached to objects by its own trait, so the scene's
`packages` lists it like anything else and a viewer without it sees the
objects' own (closed) looks and is offered it.

- **The binding** is the object's: `"<keeper's trait>": { by: <container url>, slot: n }`,
  in the scene doc, so moving or drawing a kept thing is one change there.
  The trait is `runtime` and `by` is `copy: "drop"`: a copy is a bare
  closed object. Two objects naming one slot: the lower id keeps it, the
  other stays closed and is flagged.
- **What it contributes**: `looks()`, by one rule every keeper copies, and
  `hud()` for status. The rule, per object and viewer:

  | | drawn as |
  |---|---|
  | the keeper isn't ready for it, or the audience is unknown (`null`) | the object's own look |
  | the viewer is in `audience`, and their client knows the item | the item's look |
  | else, the viewer is in `shown` (turned toward them and screened, or theirs and not known here yet) | `{ veil: true }` |
  | else (face down; in another's hand) | the object's own look |

- **`keeper`** (contributed, for whatever handles kept things: a table's
  Shuffle): `{ kind, of(id) → container key | null, name(key) → string | null, shuffle(ids) → n }`.
  `shuffle` shuffles what those objects are among themselves and answers how
  many (0: nothing to do).
- **`contain({ repo }, { title, items }) → Promise<{ key, bind(slot) → traits }>`**
  (the module of a plugin whose metadata says `keeper: "<kind>"`): makes a
  container holding `items` (slot k: `items[k]`, any JSON; a scene object's
  is `{ sourceUrl, name }`). Setup code picks a keeper by kind (`"plain"`:
  anyone who opens the container reads it; `"joint"`: the seated players
  shuffle it between them) and writes `bind(slot)` into each object's
  traits.

**When something isn't loaded**

| Missing here | Effect |
|---|---|
| a keeper | its objects show their own (closed) look; the packages card offers it; nothing leaks |
| a listed package (a policy's, or any) | the audience is unknown here: this viewer's keepers show closed looks and hand nothing over, so a shuffle that needs them waits, and its HUD names who |
| the seats' owner | no roster: a hand is nobody's, a deck waits for players |

**Ambients.** Some things a world has once, however many things it holds:
its sky, its water. An extension offers them with `ambient() → { [name]:
value | null }`; a stage stacks its extensions' offers per name in running
order (the later value whole, `null` clearing an earlier one, nothing
keeping it), and copies each into frozen plain JSON, so what crosses is data
by construction: a function, a cycle, a handle or a Map is refused, and a
reader can neither call into the provider nor see it change underfoot. A
property that is undefined is left out and an array element that is
undefined (or a hole) is null, as JSON writes them. A refused value stacks
as `null`: it clears what an earlier extension offered under that name, so
a broken override leaves no value rather than quietly falling back to
someone else's. **A world's ambients are its outermost doc's**: one read
path (`view.ambient`) serves every stage's `api.ambient(name)` and the
viewport's atmosphere alike, and nothing a linked doc offers reaches its
host or a sibling. A linked world brings its things, not its weather. Each
reader evaluates the value with its own code, in its own frame and time; the
stage never reads inside one. `value` is the same wherever the caller sits;
`mine`, `frame` and `clock` say where it sits (I4 names them among the
reads that depend on placement). Names are a package's to document: an
unprefixed name is a convention below, and a package's own would be
prefixed.

**Atmosphere** (the ambient `atmosphere`). How the world around the objects
looks: a sky, fog, a sun. The viewport shows the outermost doc's.

```js
ambient() → { atmosphere: null | {
  sky?: { top, horizon, bottom },          // sRGB hex ("#rrggbb"); a missing one takes a neighbour's
  fog?: { color?, near, far },             // metres from the eye; color defaults to the sky's horizon
  sun?: { direction: [x, y, z],            // toward the sun (need not be unit)
          color?, intensity?,              // default white, the key light's 1.5
          shadows?: boolean },             // default false
  exposure?: number,                       // scales every light; default 1
  clouds?: { cover, contrast?,             // a cloud deck over the sky: cover 0..1 (1 an overcast),
             scale?, base? },              // its luminance ±contrast (≤ 0.5, default 0.1), cells `scale` m
                                           // across (600) on a deck `base` m up (800)
} }
```

- Stacked as every ambient is: a later extension's atmosphere wins whole
  (one atmosphere, never a sky from one and a sun from another). The
  viewport hears only a change. Something that changes on its own (a day
  passing) asks for a flush with `api.schedule`.
- **None at all is the stage's own look, exactly**: the theme's background,
  no fog, the white key light high to one side, no shadows. The editor
  never gives one.
- The **sky** is a gradient behind everything, horizon to top above and
  horizon to bottom below, with a soft disc where the sun is. It writes no
  depth and is never picked, boxed or framed. Without a sky, fog's colour
  is the background.
- **Clouds** (over a sky only) texture it: the view direction carried up to
  a deck `base` metres overhead, two octaves of value noise over it in
  cells `scale` across. An overcast (cover 1) moves the whole sky's
  luminance by the noise, ±`contrast`; scattered cloud (cover under 1) only
  where the noise is in its top `cover`, whiter, brighter overhead and
  darker toward the horizon. Faded to nothing at the horizon (the fog meets
  the bare gradient there) and nothing below it. Static: a sky that moved
  would redraw every frame. Anything else that draws the sky (the water's
  reflection) samples the same function (`cloudAt` is it in JS).
- **Fog** fades the objects and world groups toward its colour, from `near`
  to `far`. The on-top pass has none.
- The **sun** replaces the key light, and dims the headlight to a third
  (outdoors there's no lamp on the camera, and a full one fills the shadows
  in). A sky tints the sky/ground light with its top and bottom. With
  `shadows`, every object casts and takes them (a mesh whose node extras
  say `receiveShadow: false` only casts: a one-sided sheet can't be biased
  right from both sides), from one shadow map fitted to what's being looked
  at: the objects within 50 m of the orbit's target (or the held camera),
  nearest first, as many as fit in 16 m of radius (a box wider than that on
  its own is a backdrop: it takes shadows in the frame but doesn't size it). The frame's centre sits on whole shadow texels and its radius on a
  ladder of quarter octaves, so its shadows don't crawl as things move; its
  biases are a texel or so in metres. The map is redrawn only when something
  moves or the frame does.

**Water** (the object trait `water`, the ambient `water`, the contributions
`water` and `water.waves`; provided by the `water` package). Water is an
object: open (no size) or a box (a size). The ambient is the world's open
water, the outermost doc's; bounded water is its own doc's, read only by
that doc's parts wherever it is placed, and never offered. An open body may
carry a clip, the box it keeps where the world offers no open water. Its
values, its reader and who draws what are the package's to document:
[water/WATER.md](../water/WATER.md), "Water bodies" and "Clipped open
water".

**Wind** (the ambient `wind`; offered by sailing's weather). How the world's
air moves, read by sailing's physics and the water package's surface. Its
value and compass convention are sailing's to document:
[sailing/DESIGN.md](../sailing/DESIGN.md), "Conventions".

---

## Inside the stage (for whoever builds it)

| Module | Holds |
|---|---|
| `stage/atom.js` | the local value |
| `stage/activation.js` | the running set and scopes: traits only (pure) |
| `stage/chain.js` | the chain order (pure) |
| `stage/dock.js` | the drawer: its model (pure) and its tabs and panes |
| `stage/audience.js` | merging policies' answers: `shown`, `audience` (pure) |
| `stage/veil.js` | the veil's drawing, from bounds alone (pure but for the GLB encoding) |
| `stage/view.js` | the view: the mount, the viewport, the router, the body stack and held tool, the selection and hover as paths, notices, prefs, the camera's saving, the session, the stages and the links it opens (expansion, child stages), the input chain across stages, the input path, collect across stages, the focus path's clocks |
| `stage/paths.js` | the key grammar (a stage's object in the viewport, a stage's extension at the router) and a stage's element of a path (pure) |
| `stage/scope.js` | one stage's view of the viewport: its keys and its frame, the one choke point every spatial call goes through; similarities and their conversions (pure parts exported) |
| `stage/links.js` | what a link is, and expansion (pure) |
| `stage/readonly.js` | the read-only handle and repo a pin, a mirror or a stage on a handle that refuses writes is given, and the repo that notes every doc a stage reaches (for `fixPoint`) |
| `selection.js` | where a selection may be: `selectionStep`, the one way the focus and selection change (H10), and `focusSteps` (pure) |
| `extract.js` | Extract and Bundle: the new doc, the host's one change and its compare-and-set |
| `transfer.js` | the one copy rule (Copy, Paste, a row dropped from another scene): what goes, references (`copyRefs`, `refEdits`), runtime state left behind |
| `stage/packages.js`, `packages.js` | the packages list kept true and the missing ones loaded; the rules, pure |
| `stage/own.js` | the mark that gives the stage's own parts `api.edit`, `edits`, `undo` and `redo` |
| `stage/ride.js` | riding: the camera carried by a moving object (pure) |
| `stage/viewport.js` | the renderer |
| `stage/router.js` | DOM to events, sessions, the body stack, the held tool, popovers, lock, the ladder, keys, menu, cursor |
| `stage/pointer.js` | the pointer lock model: locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused ∧ ¬touch (pure) |
| `stage/ladder.js` | the Escape ladder: which layer one Escape pops, and its hint (pure) |
| `stage/bodies.js` | the stage's two bodies, Look and Edit; `editing(local)`, the one question the editor's chrome asks; `inBody`, the `edit: true` rule; the stack's model (`enterStep`, `leaveStep`) and where a doc starts people (`startBase`) (pure) |
| `keymap.js` | the one key resolver: what reserves a key, the key map's invocation, and the hint every surface shows (pure) |
| `stage/presence.js` | the presence protocol, sends, remote pose holds and their timed samples, and the one order holds go in (`ranksAhead`) |
| `stage/holds.js` | this view's pose holds in that order: which extension's stands, and dropping ours when a peer's ranks ahead |
| `stage/time.js` | the one source of time: the browser's (`realTime`) or one that moves only when stepped (`manualTime`) ("Time") |
| `stage/clock.js` | the doc's world time: who computes it, processes, checkpoints and the `saved` stamp, following, pause and resume (pure parts exported) |
| `stage/smooth.js` | playing back a peer's pose stream: the playout delay, the clock offset, the sample buffer, lerp and slerp (pure) |
| `stage/host.js` | starting and stopping extensions (the one linger rule), `collect`, drops; it asks the stage for each extension's api |
| `undo.js` | edits: a step's leaves from its own patches, its inverse (whole, or nothing if anything it wrote was written since), the per-doc stacks, and `createEdits`, the recorder the stage runs (pure but for the recorder) |
| `stage/stage.js` | the mount and the doc loop (derive, content loading, lenses and veils, the audience, atmosphere, status, prefs, arriving (view.start), the edit recorder, templates, parts and the scene's files, camera saving), the api each extension gets and what it owns (`makeApi`), the base (Look or Edit) and Edit's Select, the bodies entered, the held tool, attention and the command context, the clock's wiring (its claim, presence and eligibility), remote holds' playback, claims, the default layout (port and edges); it answers the embedded build controls' `scene:rebuild` and `scene:render-context` events (`src/controls-tool.js`) and fires `scene:render-context-changed` at them when an object's `at` changes |
| `ops.js` | pure doc planners |

**Viewport** (`new Viewport({ port, themeRoot, time })`: its frames come from `time`, `stage/time.js`). It
draws and picks, and nothing else: the halo, grid, axes, bounds, selection
boxes, handles, dimensions, measure, carry and every input listener are
parts or the router's. One per view, shared by its stages, each through its
`scope.js`. It has:

- **Objects:** `ensureObject`, `setParent`, `removeObject`, `setGLB`,
  `setHint`, `applyDisplay`, `setGroups`, `setMaterialRules`, `isShown`,
  `objectBox`, `groupBox`, `sceneBox`, `hasContent`, `objects`, `stats`,
  `perf`.
- **Content:** `contentOf(id)`.
- **Theme:** `theme`, `onTheme(fn)`.
- **Camera:** `getCamera`, `setCamera`, `frame(box)`, `hold()`,
  `ride(id, opts)` (a base ride), `bodyRide(spec | null)` (the top body's,
  which wins), `limit(spec)`, `watchCamera`, `onCameraEnd(fn)`.
- **Picking:** `pick(x, y, opts)`, `ray`, `centerRay`,
  `raycast(origin, dir, opts)`, `project`, `nearestVertex`.
- **Widgets:** `worldLayer(owner, { onTop })` and `pickWidget(x, y)`.
- **Labels:** `labels.sync(owner, items)`.
- **Poses:** `setPose(id, transform | null)`, `worldOf(id)`.
- **Atmosphere:** `setAtmosphere(atmosphere | null)`, the world's ambient as the view reads it (`view.ambient("atmosphere")`, told on a change: sky, fog, sun; the
  pure parts are `cleanAtmosphere`, `lighting`, `shadowFocus`,
  `ladderRadius`, `lightBasis` and `shadowFrame`).
- **Depth:** near sits halfway to the nearest geometry (`nearestClear`: each
  object's box, and for one the camera is inside, its triangles by BVH), so
  a camera aboard a ship among an anchorage's objects still gets centimetres,
  not a fraction of a millimetre; `depthRange` is the pure part. World
  layers aren't measured: an extension that draws there near the camera
  (a sea's surface) says so with `api.extent(box)`, and a camera inside an
  extent gets dist / 200.
- **Drawing:** `setExtent(owner, box | null)`, `addLoop(fn, { first? })`,
  `afterRender(fn)`, `invalidate()`, `dispose()`.

**Router** (`createRouter({ port, canvas, keyRoot, pick, pickWidget, ray, centerRay, chainFor, inputOf, base, cameraHeld, onHover, onCursor, onState, pointerWanted, selection, deselect, focusDepth, leaveFocus })`; `focusDepth` is how many links the focus is inside, and `leaveFocus` leaves one: the ladder's last rung):
- builds events with lazy `hit` and `widget`;
- runs the chain through `chainFor(ev)`, the held tool before it and the
  top body after it;
- owns sessions, the body stack, the held tool, popovers, pointer lock
  (`pointer.js`), the Escape ladder (`ladder.js`), key tracking, `menu`
  synthesis and the cursor;
- returns `{ pushBody, setBase, body, bodies, leave, hold, putDown, held,
  popover, escape, refresh, state, stopOwner(id), dispose }`; `setBase(body)`
  leaves every body over the base, then replaces it (the stage's Look or
  Edit).

**Presence** (`createPresence({ handle, viewer, session })`; the page bus,
`pageBus(handle, receive)`, delivers what it broadcasts to every other
presence on the same handle in the page):
- **messages** (on `handle.broadcast`):
  - `scene:presence` carries `{ session, viewer, seq, at, keys, body?, held? }`
    or `{ session, bye: true }`: `body` and `held` the view's (its body and
    held tool, `presence.announce`), said on every channel it acts on;
  - `scene:send` carries `{ session, viewer, ext, kind, n, data }`, `n`
    counting this session's sends, so one delivered twice is told once;
  - `scene:pose` carries `{ session, viewer, id, parent, transform, since, seq, at, every }`
    while held and `{ session, viewer, id, parent, transform: null, seq, landed? }`
    on release, and `yields: true` on a hold that gives way to a person's;
    `seq` counting this session's poses, so a late one can't undo a release;
    `at` being the sender's clock when it was held and `every` its pose interval
    (ms), which a peer plays the stream back by (`smooth.js`); `since` being
    the hold's Lamport stamp: one past every stamp its holder had seen. Of
    two holds on one object a person's beats a yielding one, then the lower
    stamp wins, then the lower session id, so every view agrees, and a hold
    begun after hearing of another of its kind always ranks after it. No clock is involved in ranking (`at` only times
    playback); it's the same kind of rule Automerge uses to settle
    concurrent writes;
- **behaviour:** each presence message is this view's whole state. There is
  a heartbeat every 5 s, a TTL of 15 s and a bye on dispose, and on
  `pagehide` (Patchwork doesn't run the cleanup when a tab closes); a page
  back from the back-forward cache returns as a new session. Presence goes
  out at the highest rate any extension asked for (default 4 Hz), and poses
  at most once per object per 50 ms, or per presence interval if that's
  shorter. A pose is stamped (`at`) with when it was held, not when it went
  (a trailing send carries a pose from a frame ago; a keepalive is stamped
  when it goes). A peer keeps a hold's last 8 poses as samples on the
  sender's clock, with an offset from ours per sender that follows the
  fastest delivery, and the sender's interval as its last pose said;
- **exposes:** `set(ext, key, value)`, `clear(ext)`, `get()`, `watch`,
  `rate(ext, hz)`, `send`, `onReceive`, `hold(ext, id, parent, transform, yields?)`,
  `release(ext, id, landedTransform?)`, `remoteHolds()` (each with
  `samples`, `every`, `offset` and `yields`), `shownAt(session, t?)`, `heldBy(id, { yields? })`,
  `watchHolds`, `settle(id)`, `goodbye()`, `hello()`, `dispose`.
