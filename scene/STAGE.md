# The stage and its extensions: the contract

This is the working contract between the scene's core (the **stage**) and
everything that adds to it (**extensions**). [DESIGN.md](DESIGN.md) says why;
this says exactly what. It is plain data and functions throughout. No
extension imports another, and the stage knows no extension by name.

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

(There is no fourth, private place yet: what is one viewer's alone, lasting
and on all their devices. A keeper that needs one keeps it itself, as the
joint keeper keeps its player's secret with their account.)

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
| `packages` | stage | `{ ask, loading, failed, missing }`: the listed packages this viewer doesn't have, each `{ url, name }` (`failed` with `error`), and `missing`: whether any listed package isn't here (whatever was answered about it; true until that is known). See "Packages" and "Audience" |
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
  …                                   // any other plain data: the stage ignores it, others may read it from
                                      // the registry (a keeper's `keeper: "plain"`, the seats' `roster: true`: "Conventions")
  async load() { return { create(api) → instance, drop?(ctx, info) → boolean | Promise<boolean>, … } } }

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
  - **Every field but runtime state.** Not copied: `claims` (the stage's), and
    any trait key an extension marks as runtime in `describes` (below). Pose
    holds and presence were never in the doc.
  - **Files are shared, renders aren't.** A passthrough object keeps its
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
    `url` and other fields are copied as they are.
  - **What a trait needs.** When a copied trait's description `needs` a scene
    trait this scene lacks, a notice says so ("This ship needs a sea: add Sea
    to the scene."). Nothing adds a scene trait for you.
  - The first copied root is selected.

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
  "scene.seats": { name: "Seats", on: "scene",
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
- `needs`: scene trait keys an object with this trait doesn't work without
  (a ship's `["sailing.sea"]`). Copying it into a scene without one says so.
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
a fallback. `init` makes `assets` too, as do tabletop and the TTS importer, and
nothing else ever does: a scene without one is from before `assets` and is
republished, not patched. The same goes for the `packages` list (see
"Packages"): made by `init` and by those two, appended to by the stage,
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
| `view.activity`, unless `"edit"` | every `scene:extension` that offers it with a reason of its own |
| `view.tool` of the form `"<ext>:<name>"` | the `scene:extension` with that id |

With each extension come the ones it `requires`, at any depth. A part or a
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
- one written whole by another tool (tabletop's tables, the TTS importer)
  gets it from the registry's `scene` datatype, by the URL rule
  (`src/scene-package.js` in each);
- a publish script states it (`probes/scene-packages.mjs`: the scene
  package's `pushwork url`), and checks it;
- and the reconcile pass writes it on any scene that names nothing loadable
  there (no field, or a dev server's URL), when the scene package here can
  be shared. One that names something loadable is never replaced.

**Loading.** The listed packages none of whose plugins is registered here
(`missingPackages`) are this viewer's to load.
- **One prompt.** They're published as `local.packages` and shown by
  `scene.packages` as one card over the view: "This scene uses 2 packages
  you don't have.", each by its own name (its `package.json`'s, read from
  its folder; never asked of an `https:` host) and its URL, with **Load**
  and **Not now**.
- **Load** loads each as the module watcher would, on this thread:
  `importPackage` (`@inkandswitch/patchwork-filesystem`) at the folder's
  current heads, then `registerPlugins(plugins, url)`
  (`@inkandswitch/patchwork-plugins`) with the bare URL. The registry
  changing is what starts things: the host starts the extensions the doc
  calls for, the render manager builds the objects whose provider was
  missing, and the parts bin, the start screen and the inspector list what
  arrived.
- **Each on its own.** One that fails is shown on the card with why, with
  **Try again** and **Dismiss**, and doesn't hold up the others. A failure
  isn't retried unasked.
- **Not now** asks nothing more in this view. Opening the scene again asks
  again.
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
| `packages` | `{ load(urls?) → Promise, dismiss(urls?) }`: the viewer's answer to the packages prompt (see "Packages"). `load` is a yes: it loads what's asked about or failed (all, or those of `urls` among them) and remembers what loads. `dismiss` asks no more in this view |

**Content**

| | |
|---|---|
| `nameOf(id)` | what this viewer sees, lenses applied |
| `content(id)` | `{ loaded, box, extras, stats, root }` or null. `extras` holds the GLB's extras: `connectors` (normalised), `snapRadius`, `legend`, and the scene's own. `root` is the live three.js node, for reading geometry (dimensions' on-surface test). Never change it, with one exception: **dressing**. An extension may move, scale or hide `root` and the nodes in it for objects that carry one of its own traits, each view for itself (a buoy bobbing on the waves, a sail lowered), and puts them back when it stops. Dressing is only a look: `box`, `worldOf`, picking and the shadow map go by the object's pose, not the dressed nodes, and nothing is sent |
| `loadState(id)` | a copy of what the render manager or GLB queue last said about it (notes, phase, contested, providerId, builtAt, builtHeads, bounds, retryAt, fixed, at, versionMissing…), or null |
| `box(id, { hints })`, `groupBox(id)`, `sceneBox()` | world `{ min, max }`, or null |
| `worldOf(id)` | the displayed world matrix: held poses, and peers' played back, included; what is drawn this frame. `scene().world(id)` is the doc's |
| `focus(ids)` | load these first |
| `audience(id)` → `"all"` \| viewer[] \| `null` | who may see what this object is: every running extension's `audience` answer for it, merged. `null`: unknown, tell nobody. See "Audience" |
| `shown(id)` → `"all"` \| viewer[] \| `null` | who it is turned toward, before anything screens it (the union of the `show`s alone). `audience ⊆ shown` |
| `providersFor(url, doc)`, `addObject(url, opts)` → id | `opts`: `{ providerId?, name?, group?, parent?, before?, transform?, heads?, hint?, fields?, render? }`. `heads`, or heads in the URL (`automerge:<id>#<heads>`, a Patchwork link at a version), adds it fixed at that version of its source (the object's `at`). `fields`: more of the object, in the same change (a copy's traits, tags, colour…; never the fields addObject sets itself, nor `claims`). `render`: a render doc to start the new one from: its `params` when it's by the same provider, and its build too when it's of the same source (a copy's) |
| `rebuild(id)` | |
| `fixPoint(id)` | the `at` (`{ heads, deps? }`) that would fix a render-doc object at exactly what its render was last built from, or null (not built here yet, not loaded, passthrough). Fixing is a plain field write: `api.change(ops.setField(scene, id, "at", point))`; `undefined` follows the latest again |
| `drop(info)` | |
| `template(id)` → `Promise<boolean>` | run a `scene:template` (see "Templates"); true when it ran |
| `part(id, at)` → `Promise<string \| null>` | run a `scene:part` at `{ parent, transform }` (see "Parts"); selects and returns what it made |

**Picking and camera**

| | |
|---|---|
| `pick(x, y, { ground?, snapPx? })` | port-local px → hit (with vertex snap if asked) |
| `ray(x, y)`, `raycast(origin, dir, { far?, skip? })`, `project(p)` → `{ x, y, visible }` | a raycast hit is `{ id, point, normal, distance, back }`: `normal` faces the ray; `back` says the ray met the face from behind (from inside a closed solid) |
| `camera` | `{ object, get(), set({ position, target?, quaternion?, fov?, near?, far? }), frame(box), hold() → release, ride(id, { turn?, rise?, fallback?, at? }) → off, riding() → { id, fallback } \| null, limit(spec) → off, touched(), watch(fn), onEnd(fn) → off }`. `onEnd`: someone finished moving the camera (an orbit, a zoom), never while it's held |

How the camera parts behave:
- **Hold.** While anything holds the camera, orbit is off and not updated,
  nothing auto-fits near and far unless the holder sets them, and nothing is
  saved. The last release re-seats the orbit target in front of the camera.
- **Riding.** `ride(id, { turn = true, rise = true, fallback = false, at })`
  carries the orbit camera with an object, as a passenger: every frame,
  after the loops have moved what's drawn and before the orbit updates, the
  camera and its target move by how the object moved since the last frame
  (the shift of its point `at`, in its frame, else its origin; its turn
  about the vertical through that point, if `turn`; its rise and fall, if
  `rise`). Ride the point you look at (a seat rides the spot on the table
  its view is aimed at) and it holds still on screen. It follows from the
  frame it's asked in, so set the view from `worldOf` and ride at once.
  Roll and pitch are never followed: the orbit keeps world up. One
  ride applies at a time, the latest that isn't a `fallback`, else the
  latest fallback (a ship keeping herself in view gives way to a seat at a
  table aboard her). `riding()` says which applies now (a ship's HUD tells a
  seated player's view, riding a table, from a spectator's). While the camera is held nothing rides it, and a ride
  starts again from where the object is then, so first person wins and
  nothing jumps after. It doesn't stop an orbit in progress. Set the view
  first (from `worldOf`, say), then ride. `src/stage/ride.js` is the maths.
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
| `looks()` → `Map id → { sourceUrl?, name?, veil? }` | the stage (lenses combine in running order; later wins per field). `veil: true`: the stage draws its stand-in instead of the object's content. See "The veil" |
| `audience(scene)` → `(id) → { show?, only? } \| null` | the stage, for `api.audience` and `api.shown`: this extension's policy for who may see what an object is. See "Audience" |
| `atmosphere()` → `{ sky?, fog?, sun?, exposure? }` or null | the stage, every flush: sky, fog and sun (see "Atmosphere" below) |
| `input` | the stage |
| `receive(type, data, from)` | the stage |
| `beforeRemove(draft, ids)` | the stage |
| `commands` | surfaces and key maps |
| `panels` | sidebars: `[{ id, title, pinned?, mount(body, { head, section }) → { update(scene, local), dispose() } }]`. A body set `hidden` hides its section; a `pinned` panel never folds |
| `hud()` → `[{ text, state }]` | status surfaces |
| `landing(id, worldPoint, hitId)` → `{ faceUp? }` | the hand. It carries, snaps, flips and puts down in the frame of the object's doc parent as drawn (the world at the root), so a piece on a moving table stays on it; the point it asks about is still in the world, as drawn |
| `carryable(id)` → `false` to veto | the hand: false from any running extension and it neither picks `id` up nor flips it (anything else allows). Asked each time, so it may depend on what's happening (a ship under sail) |
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
- `title` is the tooltip. On a `disabled` command it's the reason ("Follow
  latest to shape"), and the inspector writes it out after the button.
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
  A held verb keeps its target until its key is up: while anything is held
  the prompt stays on that target wherever the look goes, showing the held
  verb (marked held, as it was when pressed, even once it no longer applies
  from where you are) and that target's other verbs, whose keys run on it;
  the held key's auto-repeat is the prompt's. Once the last key is up the
  prompt follows the look again.

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
- An extension that contributes `audience` declares **no `activities`**: a
  policy that stopped when a viewer switched activity would take its `only`
  with it. (A package whose verbs are play's and whose policy is everyone's
  registers two extensions: tabletop's `tabletop` and `tabletop.rule`.)

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

**Seats** (provided by the scene package's own `scene.seats`, a shared part:
`src/parts/seats.js`). The places people take at a scene: scene trait
`scene.seats`, `{ [seatId]: { name, player: <viewer> | null, camera?: { position, target, in? } } }`.
It runs wherever the scene has seats, in every activity; it is the seat
picker, the claim that says a seat's player is here (`scene.seat:<id>`), the
seat's view (riding the object its camera is `in`), a seat as a station on
the use prompt, and "sat down" told to the others. No other package reads
or writes the trait.

| | |
|---|---|
| `roster` (contributed by the seats' owner) | `{ seats(scene) → [{ id, name, viewer \| null }], viewers(scene) → viewer[], open(scene) → string[], nameOf(scene, viewer) → string \| null, who(viewer) → string }`. The first four are pure in the snapshot (the doc alone), so a policy may be built on them. `who` is what to call a viewer now (a contact's name once known, else their seat's) |
| `seatPlaces` (contributed by whoever gives a seat somewhere to be) | `(scene) → [{ seat, id, min, max }]`: a box in object `id`'s own frame (a hand tray). The seats' owner puts a name tag on each, and a look at one is a look at its seat |
| `firstPerson` (contributed by whatever walks) | `{ enter({ seat, eye, target, frame }) → boolean, leave() }`: the hand-off when someone sits down from, or stands up into, first person |
| `lay(d, seats)` (the module of the plugin with `roster: true`) | writes `{ [seatId]: { name, camera? } }` into a scene doc being set up, empty, only where the scene has none; setup code calls it instead of writing seats |

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
  `shadows`, every object casts and takes them (a mesh whose node extras
  say `receiveShadow: false` only casts: a one-sided sheet can't be biased
  right from both sides), from one shadow map fitted to what's being looked
  at: the objects within 50 m of the orbit's target (or the held camera),
  nearest first, as many as fit in 16 m of radius (a box wider than that on
  its own is a backdrop: it takes shadows in the frame but doesn't size it). The frame's centre sits on whole shadow texels and its radius on a
  ladder of quarter octaves, so its shadows don't crawl as things move; its
  biases are a texel or so in metres. The map is redrawn only when something
  moves or the frame does.

---

## Inside the stage (for whoever builds it)

| Module | Holds |
|---|---|
| `stage/atom.js` | the local value |
| `stage/activation.js` | the running set, scopes and activities (pure) |
| `stage/chain.js` | the chain order (pure) |
| `stage/audience.js` | merging policies' answers: `shown`, `audience` (pure) |
| `stage/veil.js` | the veil's drawing, from bounds alone (pure but for the GLB encoding) |
| `stage/viewport.js` | the renderer |
| `stage/router.js` | DOM to events, sessions, the arm stack, lock, keys, menu, cursor |
| `stage/presence.js` | the presence protocol, sends, remote pose holds and their timed samples |
| `stage/smooth.js` | playing back a peer's pose stream: the playout delay, the clock offset, the sample buffer, lerp and slerp (pure) |
| `stage/host.js` | starting and stopping extensions, this viewer's activity (joining, `local.activities`), the api each gets, ownership |
| `stage/stage.js` | the mount and the doc loop (derive, content loading, lenses and veils, the audience, atmosphere, status, prefs, the activity, templates, parts and the scene's files, camera saving), remote holds' playback, claims, the default layout (port and edges); it answers the embedded build controls' `scene:rebuild` and `scene:render-context` events (`src/controls-tool.js`) and fires `scene:render-context-changed` at them when an object's `at` changes |
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
  - `scene:send` carries `{ session, viewer, ext, kind, n, data }`, `n`
    counting this session's sends, so one delivered twice is told once;
  - `scene:pose` carries `{ session, viewer, id, parent, transform, since, seq, at, every }`
    while held and `{ session, viewer, id, parent, transform: null, seq, landed? }`
    on release; `seq` counting this session's poses, so a late one can't
    undo a release;
    `at` being the sender's clock when it was held and `every` its pose interval
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
