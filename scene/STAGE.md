# The stage and its extensions: the contract

This is the working contract between the scene's core (the **stage**) and
everything that adds to it (**extensions**). [DESIGN.md](DESIGN.md) says why;
this says exactly what. It is plain data and functions throughout. No
extension imports another, and the stage knows no extension by name.

Revised after a four-lens review (simplicity, composition, feasibility,
multiplayer); [the report](REPORT.md) records what changed and why.

## Words

| Word | Means |
|---|---|
| **Stage** | The core: the doc, loading and building object content, rendering, picking, the camera rig, drawing layers, the input router, presence, lenses. It has no UI and no opinion about what a click means. |
| **Extension** | A `scene:extension` plugin. Everything a person sees or does beyond a rendered scene and an orbiting camera comes from one. |
| **Activity** | What a viewer is doing in a scene: `"edit"`, `"play"` (an open set: an extension may declare any other). One per view, never in the doc. Extensions say which they take part in. |
| **Template** | A `scene:template` plugin: a way to start an empty scene (an arena level), offered on its start screen. |
| **Part** | A `scene:part` plugin: something to put into a scene (a mast, a buoy, a target), offered in the editor's parts bin. |
| **Surface** | An extension that presents others' contributions (toolbar, sidebar, menu, key map), read with `api.collect(name)`. |
| **Contribution** | A field on an extension's instance that some other extension may collect. The stage reads only the ones listed under "instance". |
| **Invocation** | A command call as a value: `{ ext, command, target, value? }`. |

## Three places for state

| | Shared? | Lasts? | Read | Write |
|---|---|---|---|---|
| **Doc** | yes | yes | `api.doc()`, `api.scene()`, `api.claimedBy(id, kind)` | `api.change(fn)`, `api.claim(id, kind)` |
| **Presence** | yes | no | `api.presence.get()`, `.watch(fn)` | `api.presence.set(key, value)`, `api.send(type, data)` |
| **Local** | no (this view) | no | `api.local.get()` | `api.local.swap(fn)` |

These rules follow from that:

- **The doc holds what is true for everyone.** Per-viewer things never go in
  the doc: the camera, display toggles and the current tool.
- **The doc may suggest a default.** It does so through `doc.view.*`, and a
  viewer's local choice overrides it. Read a preference with
  `api.pref(key, fallback)`, which returns
  `local.prefs[key] ?? doc.view[key] ?? fallback`.
- **Ids are opaque.** Any id in doc data may be missing at any time, because
  concurrent edits merge. Readers ignore references to missing objects.
  Writers set fields; they never replace an object's whole map (or its
  transform: `ops.setTransform` writes only the numbers that changed).

`api.local` is one value: a frozen plain object shared by all extensions in
this view and by the stage.

- `swap(fn)` replaces it with `fn(old)`.
- `watch(fn, select?)` calls `fn(next, prev)` after a swap, but only when
  `select(next) !== select(prev)` if `select` is given.

| Key | Written by | Means |
|---|---|---|
| `hovered` | stage | the object id under the pointer, or null |
| `armed` | stage | the extension id on top of the arm stack, or null |
| `immersive` | stage | true while an `immersive` arm is on (first-person play): decorations (grid, axes, bounds) stand aside |
| `running` | stage | `[{ id, scope }]`, in chain order |
| `status` | stage | `{ [id]: { state, reason?, text, title } }` load and build state. `text` and `title` are for people; code branches on `state` and, for `"stale"`, `reason`: `"deps"`, `"contested"`, `"pinned"` or `"out-of-date"` |
| `theme` | stage | the colour tokens (`{ accent: [r,g,b], … }`) |
| `notices` | stage, via `notify` | `[{ id, text, kind, at }]` |
| `activity` | stage (on joining, and after a template), activity surfaces | what this viewer chose to do: `"edit"`, `"play"`, …; null until the stage has the doc. Not persisted. See "Activities" |
| `activities` | stage | `{ current, available }`: the activity that runs and the ones this scene offers. **Read the activity here**: `current` is `activity` when it's available, else `"edit"` |
| `prefs` | any | this viewer's overrides of `doc.view` keys (persisted per scene) |
| `selected` | any (selection, the outline, add, a game, dimensions) | the selection: one target (an object or group id, or a ref such as `"dimension:<id>"`; see "Targets and refs"), or null |
| `tool` | tool surfaces | what a plain drag does: `"move"`, `"rotate"`, `"hand"`, `"select"` (no gizmo), `"<ext>:<name>"`. Read it with `effectiveTool(local, doc)` (`src/current-tool.js`): `local.tool ?? doc.view.tool ?? "move"` |

Private local state lives in the extension's closure, or under a key prefixed
`<id>.`. Another extension doesn't write it: it runs one of the owner's
commands instead (measure saves through `scene.dimensions`' `add`).

Presence keys are the extension's own too, with one shared convention: the
selection extension (`scene.select`) publishes `selected` (any target) and
`hovered`, and surfaces (the outline) read them to mark peers' rows (objects
only). Peer colours come from `src/peers.js`, so a peer's box and row match.

## Activation

```js
{ type: "scene:extension", id, name,
  traits?:     string[],              // active when the scene or any object has one of these trait keys
  activities?: string[],              // the activities it takes part in; absent = every one
  drops?:      string[],              // may lay out a dropped doc of this datatype ("*": any)
  always?:     boolean,
  general?:    false,                 // no traits, yet not general: it runs only when something requires it
  requires?:   string[],              // ids that run whenever this does
  describes?:  { [traitKey]: description },  // what its traits are, for authoring them (below)
  async load() { return { create(api) → instance, drop?(ctx, info) → boolean | Promise<boolean> } } }

{ type: "scene:template", id, name, icon?, description?,
  async load() { return { create(ctx) → Promise } } }

{ type: "scene:part", id, name, icon?, category?, description?,
  tags?:   string[],                  // the connector tags it fits (as an object's tags, for the hand)
  traits?: string[],                  // the traits it brings, shown in the bin as what it does
  async load() { return { create(ctx, at) → Promise<string | null> } } }
```

**The running set** is a pure function of three things: the registry's
metadata, the doc, and this viewer's activity. It is computed by
`activeSet` in `src/stage/activation.js`. The stage recomputes it after every
doc change and every switch of activity, starts what's new and stops what's
gone.

An extension runs when both of these hold:
- **it takes part in the current activity**: its `activities` include it,
  or it declares none;
- **it has a reason of its own**, which also gives its scope:

| Scope | Reason | Offered input at |
|---|---|---|
| `scene` | a scene trait | step 5, every event |
| `objects` | only object traits | step 4, and only when the event's hit chain reaches one of its objects (one with its trait) |
| `general` | it declares no traits at all (a general-purpose part: the editor's toolbar, the key map, notices), or `always` | step 6 |

An extension that declares traits the doc doesn't have has no reason, and
doesn't run. Nor does one that says `general: false`: a shared part that
serves whatever needs it, and exists only when something running requires
it (the use prompt, which a game brings into play). If several reasons apply, the earliest step wins.

`requires` pulls the required extensions in whenever the requirer runs,
whatever *their* activities (a table in play brings the hand and the key
map, which are editing parts too). It never lends scope: a required
extension's own reasons decide it, and with none it's `general`.

**Order:**
- `scene` extensions, in registry order;
- then `objects` extensions, in registry order;
- then `general` extensions, in registry order;
- each extension's `requires` follow it.

Registry order is the order plugins were registered in, so a package's
general extensions run in the order its `plugins` list gives them (the
scene's `src/index.js` lists the editor's parts in the order input should
reach them). This order (`local.running`) is the only order anything
combines in: input, lenses, `collect`, landing rules. The order extensions
happened to start in never counts.

**Activities.** What a viewer is doing is one value per view, never
persisted and never in the doc:
- **Available**: `"edit"`, then every activity declared by an extension with
  a reason of its own (a doc reason, or `general`/`always`), in registry
  order. So a plain model offers only `"edit"`, and a scene with an arena's
  traits offers `"edit"` and `"play"`.
- **Joining** starts a viewer where the doc says: the first time the stage
  has the doc, `local.activity` becomes `doc.view.activity ?? "edit"`. A later
  change to `view.activity` (the inspector's "Starts in") moves nobody who's
  already here.
- **Current**: `local.activity` when it's available, else `"edit"`
  (`currentActivity`; `availableActivities` gives the list). A choice that
  isn't on offer yet (the arena's plugins haven't registered, a peer's undo
  took its traits) is kept, and comes back into force when it is.
- **One place to read it**: the stage publishes both as `local.activities` =
  `{ current, available }`. Parts read the current activity there, never by
  working it out from `local.activity`.
- **Switching** is a write of `local.activity` (the switcher, `scene.activity`,
  shows a segmented control when more than one is available). What the new
  activity doesn't call for stops at once.

**Drops** are not activation. To lay out a dropped document, the add
extension calls `api.drop(info)`. That loads each module whose `drops` match
and calls its `drop(ctx, info)` until one returns true, where:
- `ctx` is a temporary api, **the drop context**: `id` (the plugin's),
  `repo`, `handle`, `url`, `viewer`, `doc`, `scene`, `change`, `newId`,
  `addObject`, `file` (see "Parts"), `content` (read-only, as `api.content`:
  a part reads what it's dropped on), `registry`, `local`, `notify`.
  Templates and parts get the same one;
- `info` is `{ url, doc, handle, group, at: { point, hitId } | null }`.

A drop writes traits into the doc, and those traits are what activate the
extension.

**Templates** start an empty scene. An empty scene's start screen (the add
extension's) lists every registered `scene:template` from the registry's
metadata (`name`, `icon`, `description`; nothing is loaded to offer one),
and Blank. Choosing one calls `api.template(id)`, which loads it and runs
`create(ctx)` with the same `ctx` a drop gets. The template writes whatever
it needs into the doc: objects, traits, and `view.activity`. Then this
viewer starts where the doc now says, as joining does, so an arena
template that writes `"play"` lands its maker in the game.

**Parts** are what you put into a scene once it's started: a mast on a hull,
a buoy in the sea, a target in a level. A template is a way to start a
scene; a part is a piece of one. Any package may contribute them, and the
stage knows none of them.

- **The plugin** is metadata the bin reads without loading anything: `name`,
  `icon` (a lucide name), `category` (the bin's heading), `description`,
  `tags` (the connector tags it fits: a connector that lists tags takes only
  parts with one of them, as it does the hand's pieces) and `traits` (what
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
- **The bin** (`scene.parts`, editing only) is a sidebar panel listing every
  registered part by category, with a search once there are eight or more.
  With none registered there is no panel. Drag one into the view and it
  lands where the pointer hits; a click puts it where the view is looking
  (the middle of the view, on whatever is there). Either way:
  - on an object (locked or not), it goes under that object (`parent`),
    placed at the point in that object's frame; whether it rides along is
    the part's to say (`at.world`);
  - it snaps by the hand's rule (`snapCandidates`, `nearestSnap`): to the
    nearest of that object's connectors that takes it (one that lists tags
    takes only a part with one of them) within the object's `snapRadius`,
    in plan. Alt, or the Snap pref off, places it freely. A part writes its
    `tags` on the object it makes, so the hand sees the same fit;
  - it stands upright in the world, facing a snapped connector's way, else
    its parent's (the parent's +Z, seen from above), else the viewer (its +Z
    toward the eye);
  - while dragging, a ring shows where it will land: accent when snapped,
    muted when not, labelled with what it goes on.

  The drag is the browser's own, carrying `application/x-scene-part` =
  `{ part }`, so a part can be dragged into another scene open beside this
  one. The maths is `src/parts/parts-place.js`.

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
  "tabletop.seats": { name: "Seats", on: "scene",
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

**Stopping:**
- An extension that leaves the running set because this viewer switched
  activity stops at once.
- One that leaves because of a doc change keeps running for 2 s, and for as
  long as it, or an extension it `requires`, has an arm, an open session or
  a pose hold (the hand carrying the table's card), so a peer's undo doesn't
  tear down someone's game.

When an extension stops:
1. cancel its open session;
2. pop its arms (unlock, release camera holds);
3. release its pose holds as put-backs, and let go of its claims (no `onLost`);
4. clear its presence keys;
5. stop its loops, `afterRender` hooks and scheduled work;
6. remove its world groups, disposing their geometry and materials;
7. remove its labels, overlays, edges, styles, cursor and extent;
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
TTS importer), so an extension's `if (!d.traits) d.traits = {}` is only ever
a fallback. `init` makes `assets` too, as do tabletop and the TTS importer;
a scene made before `assets` existed gets it from its first `ctx.file`. Two
peers doing that at once each make a map, the merge keeps one, and the other
peer's key is lost: that kind gets one more file doc on its next drop, and
nothing already in the scene changes.

## The input chain

The stage turns DOM input on the canvas into **events**, which are values. It
routes only events whose target is the canvas; anything else (edges,
overlays, labels) is left to the DOM. It offers each event down a chain:

1. **the armed extension** (top of the arm stack);
2. **the open session**, for keys (`session.key`);
3. **the widget's owner**, for the widget under the pointer;
4. **`objects` scope**: extensions holding an object in the hit chain. The
   hit chain is the hit object, then what it's attached to (nearest first),
   then its groups (nearest first). The event gets `holder`, the nearest such
   object;
5. **`scene` scope**, in running order;
6. **`general` scope**, in running order;
7. **the stage default**. An unclaimed press orbits (left button) or pans
   (right button); the wheel zooms. The default is skipped while the camera
   is held.

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
  hit,                        // lazy: { id, point, normal, distance } | null, the nearest shown object (no vertex snap)
  widget,                     // lazy: { owner, onTop, distance, ...data } | null
  holder,                     // step 4 only
  button, buttons, pointerId, pointerType,
  shift, alt, ctrl, meta,
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
  widgetAt(ev) → { onTop?, distance?, ...data } | null,  // "I have a widget here", for widgets the stage can't pick (the gizmo)
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

Either way the owner of the widget under the pointer gets step 3.
- An `onTop` widget beats any object.
- Other widgets compare by distance with the object hit.
- Subtrees whose `userData.noPick` is set are never picked.

**Clicks.** A press released under 4 px goes to its session's `tap`. If there
is no `tap`, or it returns false, the session is cancelled and a `click` goes
down the chain. While a session is open, presses from other pointers are
swallowed.

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
  `src/embed.js`).
- A field being typed in keeps its keys; Escape blurs it.
- A `keyup` goes to whoever claimed its `keydown`.
- On blur, a hidden page or lost pointer lock, the stage sends a `keyup` for
  every key still down.
- A keyboard verb is a command's `key`. The extension that turns key events
  into invocations (the key map) is the one extension expected to implement
  `input.key` for unclaimed keys; everything else claims keys only through
  arming or sessions.

**Arming** is a stack:

```js
const disarm = api.arm(handlers, { lock?: boolean, replace?: boolean, immersive?: boolean })
// handlers: the input functions above, plus move(ev) (every pointer move, dx/dy when locked),
//           leave() (the pointer left the canvas), suspended?(), resumed?(), disarmed?(),
//           lockLost?({ refused })
// returns disarm(); also api.relock() → Promise (call it from a press to take the lock again)
```

- Arming pushes onto the stack. The previous top is `suspended` until this
  arm is popped, then `resumed`.
- With `replace`, the extension's own earlier arm is popped first.
- An unclaimed event falls through to the rest of the chain.
- Losing pointer lock (Esc) calls `lockLost({ refused: false })` and does
  not disarm. A lock the browser never granted (a sandboxed frame, a
  headless browser), from `arm` or `relock`, calls `lockLost({ refused: true })`,
  once per request, however the browser says no.
- `immersive` (first-person play) sets `local.immersive` while the arm is on.

## `api`

Each extension gets its own `api`. Everything acquired through it belongs to
that extension.

**Doc and identity**

| | |
|---|---|
| `id`, `repo`, `handle`, `url`, `viewer`, `session`, `signal`, `Counter` | `Counter` is the stage's automerge Counter. `session`: this view's presence session, what its claims and holds name (two tabs of one viewer are two sessions; it changes on coming back from the back-forward cache) |
| `doc()`, `change(fn)`, `newId(prefix)` | |
| `scene()` | the snapshot: `{ d, objects, ids, parents, groups, members, traits, world(id) → 4×4 as stored, toLocal(id, p) }`. `members`: group id → the objects in it, at any depth |
| `ops` | pure planners (`src/ops.js`). Each takes the snapshot and returns a change function or null: `api.change(ops.ungroup(api.doc(), id))` |
| `remove(ids)` | remove in one change, after each extension's `beforeRemove(draft, ids)` tidy-up. Best effort only: concurrent edits can still leave dangling ids |
| `claim(id, kind, { onLost? })` → release \| null | take a claim of `kind` on an object (`id` null: the scene); null when another view, or another extension here, holds a live one. See "Claims" |
| `claimedBy(id, kind)` → `{ viewer, session, mine }` \| null | who holds it, if they're still here. `mine`: this view (any of its extensions) |
| `registry(type)` | |
| `port`, `root` | the element the canvas fills, and the stage's root (for DOM listeners: drops, pastes; focus) |

**Local, prefs, presence**

| | |
|---|---|
| `local` | `{ get, swap, watch(fn, select?) }` |
| `pref(key, fallback)`, `setPref(key, value)` | read through local and then the doc, as above. Set writes local only |
| `presence` | `{ set(key, value), get() → { [session]: { viewer, at, keys: { [ext]: { … } } } }, watch(fn), rate(hz), shownAt(session) }`. Keys are namespaced by the extension and cleared when it stops. `rate(hz)` raises how often this view's presence goes out, and its held poses with it (a simulation streaming a hull asks for 30 or 60). `shownAt(session)` is the moment, on that peer's clock (ms, its `Date.now`), whose held poses this view is drawing now, or null before any pose of its has arrived: something else that peer streams with its own timestamps (a sea's clock) is shown at the same moment as its holds by asking this, never by guessing the playout delay |
| `send(type, data)` | a one-off message to the same extension on every other peer, delivered at most once and never replayed. Received through `instance.receive(type, data, { session, viewer })` |
| `notify(text, kind?)` | |

**Content**

| | |
|---|---|
| `nameOf(id)` | what this viewer sees, lenses applied |
| `content(id)` | `{ loaded, box, extras, stats, root }` or null. `extras` holds the GLB's extras: `connectors` (normalised), `snapRadius`, `legend`, and the scene's own. `root` is the live three.js node, for reading geometry (dimensions' on-surface test). Never change it, with one exception: **dressing**. An extension may move, scale or hide `root` and the nodes in it for objects that carry one of its own traits, each view for itself (a buoy bobbing on the waves, a sail lowered), and puts them back when it stops. Dressing is only a look: `box`, `worldOf`, picking and the shadow map go by the object's pose, not the dressed nodes, and nothing is sent |
| `loadState(id)` | a copy of what the render manager or GLB queue last said about it (notes, phase, contested, providerId, builtAt, builtHeads, bounds, retryAt, fixed, at, versionMissing…), or null |
| `box(id, { hints })`, `groupBox(id)`, `sceneBox()` | world `{ min, max }`, or null |
| `worldOf(id)` | the displayed world matrix: held poses, and peers' played back, included; what is drawn this frame. `scene().world(id)` is the doc's |
| `focus(ids)` | load these first |
| `providersFor(url, doc)`, `addObject(url, opts)` → id | `opts`: `{ providerId?, name?, group?, parent?, before?, transform?, heads?, hint? }`. `heads`, or heads in the URL (`automerge:<id>#<heads>`, a Patchwork link at a version), adds it fixed at that version of its source (the object's `at`) |
| `rebuild(id)` | |
| `fixPoint(id)` | the `at` (`{ heads, deps? }`) that would fix a render-doc object at exactly what its render was last built from, or null (not built here yet, not loaded, passthrough). Fixing is a plain field write: `api.change(ops.setField(scene, id, "at", point))`; `undefined` follows the latest again |
| `drop(info)` | |
| `template(id)` → `Promise<boolean>` | run a `scene:template` (see "Templates"); true when it ran |
| `part(id, at)` → `Promise<string \| null>` | run a `scene:part` at `{ parent, transform }` (see "Parts"); selects and returns what it made |

**Picking and camera**

| | |
|---|---|
| `pick(x, y, { ground?, snapPx? })` | port-local px → hit (with vertex snap if asked) |
| `ray(x, y)`, `raycast(origin, dir, { far?, skip? })`, `project(p)` → `{ x, y, visible }` | |
| `camera` | `{ object, get(), set({ position, target?, quaternion?, fov?, near?, far? }), frame(box), hold() → release, limit(spec) → off, touched(), watch(fn), onEnd(fn) → off }`. `onEnd`: someone finished moving the camera (an orbit, a zoom), never while it's held |

How the camera parts behave:
- **Hold.** While anything holds the camera, orbit is off and not updated,
  nothing auto-fits near and far unless the holder sets them, and nothing is
  saved. The last release re-seats the orbit target in front of the camera.
- **Limits.** `limit({ minPolar, maxPolar, minDistance, maxDistance })`
  limits intersect.
- **Saving.** The camera is this viewer's. It is kept in `localStorage`
  (`scene-camera:<url>`). On open it comes from there, else
  `doc.view.home`, else a framing.

**Drawing**

| | |
|---|---|
| `THREE` | the stage's three.js |
| `world({ onTop? })` | a `Group` owned by the extension. Its meshes are widgets the owner gets first refusal of. `onTop` groups are drawn in a second pass over everything (depth-tested among themselves, lit) |
| `labels()` | `{ set(items) }`, where `item = { key, text, position? \| ends?: [p, p] \| screen?: { x, y }, className?, data?, rank?, onPointerDown? }`. Every extension's labels are decluttered together: one gives way to an overlapping label of higher (or equal, earlier) `rank` (default 1), and rank 2 and up never hide. The editor's: dimensions 3, axes 2, bounds 1, grid 0 |
| `overlay()`, `edge("top" \| "right" \| "bottom" \| "left")` | DOM owned by the extension. An overlay sits over the canvas and lets the pointer through, except that its direct children catch it by default (a rule with no specificity, so any extension rule wins): a full-size child (a HUD) sets `pointer-events: none`. An edge sits beside it, and the canvas shrinks to fit |
| `style(css)`, `listen(target, type, fn, opts)`, `cursor(name)` | |
| `pose` | `{ hold(id, transform), release(id, { landed? }) }` |
| `heldBy(id)` | the peer session holding this object, or null. While this view holds it too, only a peer that took hold first counts, so of two that grabbed it at once exactly one is told to let go (the hand and the gizmo put theirs back) |
| `extent(box \| null)`, `invalidate()`, `loop(fn(dt, now))`, `afterRender(fn(renderer, size))`, `schedule(fn)` | |

How poses and loops behave:
- **Holding a pose.** `pose.hold(id, transform)` shows an object at that
  local transform while it's held, under its doc parent. Peers see it: at
  most one pose per object goes out every 50 ms, or faster when this view's
  presence rate is higher (`presence.rate(60)` streams at 60 Hz).
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
(`"station"`, `"sim"`, `"held"`); kinds are independent.

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
  right now. The ship's simulator claims `"sim"` and streams the hull with
  `pose.hold`.

## `instance`

| | Read by |
|---|---|
| `update(scene, local, prev)` | the stage, once per UI flush when the doc or local state changed; `prev` = `{ scene, local }`. Also when what's shown changed without either (content arrived, a pose was held or let go, a lens changed): then `scene === prev.scene` and `local === prev.local`. If what's shown changed in the same flush as the doc or local state (a rebuilt GLB lands as its status goes back to idle), that second call comes too, right after the first. A pose alone moves boxes, so something that follows content should look at what has loaded (`content(id).loaded`, `local.status`), not the box |
| `looks()` → `Map id → { sourceUrl?, name? }` | the stage (lenses combine in running order; later wins per field) |
| `atmosphere()` → `{ sky?, fog?, sun?, exposure? }` or null | the stage, every flush: sky, fog and sun (see "Atmosphere" below) |
| `input` | the stage |
| `receive(type, data, from)` | the stage |
| `beforeRemove(draft, ids)` | the stage |
| `commands` | surfaces and key maps |
| `panels` | sidebars: `[{ id, title, pinned?, mount(body, { head, section }) → { update(scene, local), dispose() } }]`. A body set `hidden` hides its section; a `pinned` panel never folds |
| `hud()` → `[{ text, state }]` | status surfaces |
| `landing(id, worldPoint, hitId)` → `{ faceUp? }` | the hand |
| `carry(id, ev, opts)` → session | anything that wants to carry (the hand provides it) |
| `dispose()` | the stage |

A **command**:

```js
{ id, name,
  key?: string | string[],   // KeyboardEvent.key values (letters in either case)
  show?: string[],           // the surfaces that show it ("toolbar", "menu", "inspector", "use"); [] none; absent all
  hold?: boolean,            // the use prompt shows it as "hold F" (the session is what holds)
  state(target, { scene, local, from?, hit? }) → null | { title?, label?, checked?, value?, choices?: [{ value, label }], disabled? },
  run(target, value?) → void | session }
```

- `state` returning null (or false) means the command doesn't apply to that
  target. Keys work whatever `show` says.
- `label` is the verb's name for this target, over `name` ("Lower sail" where
  `name` says "Raise sail"; "Someone's at the helm"). Every surface that shows
  a command's name shows it.
- A command without `state` applies only to the null target, the scene.
- A **target** is an object or group id, a ref, or null (the scene). See
  "Targets and refs" below.
- Surfaces call `api.run({ ext, command, target, value })`.
- Toolbars show commands for the null target.
- An inspector shows those for the selection, and a menu those for what was
  right-clicked.
- A key map tries the selection, then the scene, then the hovered object
  (so Delete removes what you chose, never what you merely passed over),
  whatever kind of target the selection is.
- **The use prompt** (`scene.use`, in play, when a game requires it) shows
  the verbs for what this viewer is looking at: the middle of the view while
  an arm holds pointer lock, else the hovered object. Its target is that
  object, or the nearest thing it's attached to (`scene().parents`) that has
  a keyed command shown on `"use"`; it shows at most three, and a shown
  verb's key runs it on that target. A game lists `"scene.use"` before
  `"scene.keys"` in `requires`, so the prompt hears its keys first.
- **Reach.** The use prompt calls `state` with two more fields: `from`, the
  eye (world `[x, y, z]`), and `hit`, `{ id, point, distance }`, what the
  look landed on (perhaps a part below the target). The key map and the menu
  don't pass them, so a verb that needs `from` is used only from the prompt.
- **Held verbs.** `run` may return a session, `{ end(), cancel(), update?(dt) }`.
  The use prompt keeps it open while the key is down: `update(dt)` each
  frame, `end()` when the key is let go, `cancel()` when the window or the
  view loses focus, the target leaves the doc, or the prompt stops.
  `api.run` discards what `run` returns, so elsewhere a held verb is a press.

**Targets and refs.** A target is a string, or null for the scene:
- an **object or group id** names that object;
- a **ref**, `"<kind>:<id>"`, names something an extension makes selectable
  that isn't a scene object: a dimension is `"dimension:<id>"`. Object ids
  have no colon, and an id that names an object always means the object.

`local.selected` is one target, so there is only ever one selection and
nothing to reconcile: selecting a dimension replaces the selected object,
and selecting an object (or clicking on nothing) replaces the dimension.
- The extension that owns a kind makes its refs, answers for them in its
  commands' `state` (`scene.dimensions`' Delete and Escape apply to a
  `"dimension:…"` target), and lets go of a selected ref whose thing is gone.
- Everything that only cares about objects checks `scene.objects[target]`
  and treats any other target as nothing selected: the gizmo, handles,
  bounds, the outline's marks, the inspector, the selection box. Commands on
  objects (Remove) don't apply to refs.
- `scene.select` prunes a selected object that's gone, and leaves refs to
  their owners.

`api.collect(name)` returns `[{ id, value }]` from running extensions that
have that field, in running order. The stage never reads the value.

**Atmosphere.** How the world around the objects looks: a sky, fog, a sun.

```js
atmosphere() → null | {
  sky?: { top, horizon, bottom },          // sRGB hex ("#rrggbb"); a missing one takes a neighbour's
  fog?: { color?, near, far },             // metres from the eye; color defaults to the sky's horizon
  sun?: { direction: [x, y, z],            // toward the sun (need not be unit)
          color?, intensity?,              // default white, the key light's 1.5
          shadows?: boolean },             // default false
  exposure?: number,                       // scales every light; default 1
}
```

- The stage asks every running extension at every flush and stacks the
  answers in running order, as it does lenses: a later extension's field
  wins whole (one sky, never a top from one and a horizon from another), a
  field left undefined is kept, and `null` clears an earlier one's. The
  viewport hears only a change (by key). Something that changes on its own
  (a day passing) asks for a flush with `api.schedule`.
- **None at all is the stage's own look, exactly**: the theme's background,
  no fog, the white key light high to one side, no shadows. The editor
  never gives one.
- The **sky** is a gradient behind everything, horizon to top above and
  horizon to bottom below, with a soft disc where the sun is. It writes no
  depth and is never picked, boxed or framed. Without a sky, fog's colour
  is the background.
- **Fog** fades the objects and world groups toward its colour, from `near`
  to `far`. The on-top pass has none.
- The **sun** replaces the key light, and dims the headlight to a third
  (outdoors there's no lamp on the camera, and a full one fills the shadows
  in). A sky tints the sky/ground light with its top and bottom. With
  `shadows`, every object casts and takes them, from one shadow map fitted
  to the objects' box and redrawn only when something moves.

---

## Inside the stage (for whoever builds it)

| Module | Holds |
|---|---|
| `stage/atom.js` | the local value |
| `stage/activation.js` | the running set, scopes and activities (pure) |
| `stage/chain.js` | the chain order (pure) |
| `stage/viewport.js` | the renderer |
| `stage/router.js` | DOM to events, sessions, the arm stack, lock, keys, menu, cursor |
| `stage/presence.js` | the presence protocol, sends, remote pose holds and their timed samples |
| `stage/smooth.js` | playing back a peer's pose stream: the playout delay, the clock offset, the sample buffer, lerp and slerp (pure) |
| `stage/host.js` | starting and stopping extensions, this viewer's activity (joining, `local.activities`), the api each gets, ownership |
| `stage/stage.js` | the mount and the doc loop (derive, content loading, lenses, atmosphere, status, prefs, the activity, templates, parts and the scene's files, camera saving), remote holds' playback, claims, the default layout (port and edges); it answers the embedded build controls' `scene:rebuild` and `scene:render-context` events (`src/controls-tool.js`) and fires `scene:render-context-changed` at them when an object's `at` changes |
| `ops.js` | pure doc planners |

**Viewport** (`new Viewport({ port, themeRoot })`). This is the old
`viewport.js` with the gizmo, triad, grid, axes, bounds, selection boxes,
handles, dimensions, measure, carry, caption and every `wire*` input listener
taken out. It keeps the following:

- **Objects:** `ensureObject`, `setParent`, `removeObject`, `setGLB`,
  `setHint`, `applyDisplay`, `setGroups`, `setMaterialRules`, `isShown`,
  `objectBox`, `groupBox`, `sceneBox`, `hasContent`, `objects`, `stats`,
  `perf`.
- **Content:** `contentOf(id)`.
- **Theme:** `theme`, `onTheme(fn)`.
- **Camera:** `getCamera`, `setCamera`, `frame(box)`, `hold()`,
  `limit(spec)`, `watchCamera`, `onCameraEnd(fn)`.
- **Picking:** `pick(x, y, opts)`, `ray`, `centerRay`,
  `raycast(origin, dir, opts)`, `project`, `nearestVertex`.
- **Widgets:** `worldLayer(owner, { onTop })` and `pickWidget(x, y)`.
- **Labels:** `labels.sync(owner, items)`.
- **Poses:** `setPose(id, transform | null)`, `worldOf(id)`.
- **Atmosphere:** `setAtmosphere(merged | null)` (sky, fog, sun; the
  pure parts are `cleanAtmosphere`, `lighting` and `sunFrame`).
- **Drawing:** `setExtent(owner, box | null)`, `addLoop(fn, { first? })`,
  `afterRender(fn)`, `invalidate()`, `dispose()`.

**Router** (`createRouter({ port, canvas, keyRoot, viewport, chainFor, inputOf, onHover, cameraHeld })`):
- builds events with lazy `hit` and `widget`;
- runs the chain through `chainFor(ev)`;
- owns sessions, the arm stack, pointer lock, key tracking, `menu`
  synthesis and the cursor;
- returns `{ arm, relock, armedOwner, stopOwner(id), dispose }`.

**Presence** (`createPresence({ handle, viewer })`):
- **messages** (on `handle.broadcast`):
  - `scene:presence` carries `{ session, viewer, seq, at, keys }` or
    `{ session, bye: true }`;
  - `scene:send` carries `{ session, viewer, ext, type, data }`;
  - `scene:pose` carries `{ session, id, parent, transform | null, since, landed?, at, every }`,
    `at` being the sender's clock when it went and `every` its pose interval
    (ms), which a peer plays the stream back by (`smooth.js`); `since` being
    the hold's Lamport stamp: one past every stamp its holder had seen. Of
    two holds on one object the lower stamp wins, then the lower session
    id, so every view agrees, and a hold begun after hearing of another
    always ranks after it. No clock is involved in ranking (`at` only times
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
  `rate(ext, hz)`, `send`, `onReceive`, `hold(ext, id, parent, transform)`,
  `release(ext, id, landedTransform?)`, `remoteHolds()` (each with
  `samples`, `every`, `offset` for playback), `shownAt(session, t?)`, `heldBy(id)`,
  `watchHolds`, `settle(id)`, `goodbye()`, `hello()`, `dispose`.
