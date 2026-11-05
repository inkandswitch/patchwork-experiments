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
| **Kit** | A `scene:kit` plugin: a named list of extensions (and kits). Pure data. |
| **Surface** | An extension that presents others' contributions (toolbar, sidebar, menu, key map), read with `api.collect(name)`. |
| **Contribution** | A field on an extension's instance that some other extension may collect. The stage reads only the ones listed under "instance". |
| **Invocation** | A command call as a value: `{ ext, command, target, value? }`. |

## Three places for state

| | Shared? | Lasts? | Read | Write |
|---|---|---|---|---|
| **Doc** | yes | yes | `api.doc()`, `api.scene()` | `api.change(fn)` |
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
| `kits` | kit surfaces | `{ on: [], off: [] }` this viewer's change to the doc's suggested kits (persisted per scene) |
| `prefs` | any | this viewer's overrides of `doc.view` keys (persisted per scene) |
| `selected` | any (selection, the outline, add, a game, dimensions) | the selection: one target (an object or group id, or a ref such as `"dimension:<id>"`; see "Targets and refs"), or null |
| `tool` | tool surfaces | what a plain drag does: `"move"`, `"rotate"`, `"hand"`, `"select"` (no gizmo), `"<ext>:<name>"`. Read it with `effectiveTool(local, doc)` (`src/current-tool.js`): `local.tool ?? doc.view.tool ?? doc.view.defaultMode ?? doc.view.defaultGizmo ?? "move"`, old values (`"translate"`) mapped |

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
  traits?:   string[],                // active when the scene or any object has one of these trait keys
  legacy?:   { scene?: string[], objects?: string[] },  // or one of these old fields
  drops?:    string[],                // may lay out a dropped doc of this datatype ("*": any)
  always?:   boolean,
  requires?: string[],                // ids that run whenever this does
  async load() { return { create(api) → instance, drop?(ctx, info) → boolean | Promise<boolean> } } }

{ type: "scene:kit", id, name, icon?, extensions: string[], kits?: string[] }
```

**The running set** is a pure function of three things: the registry's
metadata, the doc, and this viewer's kits. It is computed by
`activeSet` in `src/stage/activation.js`. The stage recomputes it after every
doc or kit change, starts what's new and stops what's gone.

**Kits:**
- *Suggested kits* are `doc.view.kits ?? ["model"]`.
- *This viewer's kits* are `(suggested ∪ local.kits.on) \ local.kits.off`,
  so a later change to the suggestion still reaches everyone.
- Both are `src/kits.js` (pure), for the stage and any kit surface. Another
  tab of the same viewer changing them (or prefs) is picked up from
  `localStorage`'s `storage` event.

Each running extension has a **scope**, from its own reasons:

| Scope | Reason | Offered input at |
|---|---|---|
| `scene` | a scene trait, or a `legacy.scene` field | step 5, every event |
| `objects` | only object traits or `legacy.objects` | step 4, and only when the event's hit chain reaches one of its objects (one with its trait, or one of its `legacy.objects` fields) |
| `viewer` | a kit, `always`, or only `requires` | step 6 |

If several reasons apply, the earliest step wins. `requires` makes an
extension run but never lends it scope.

**Order:**
- `scene` extensions, in registry order;
- then `objects` extensions, in registry order;
- then `viewer` extensions, in the order of the flattened kit list, then
  `always` ones in registry order;
- each extension's `requires` follow it.

This order (`local.running`) is the only order anything combines in: input,
lenses, `collect`, landing rules. The order extensions happened to start in
never counts.

**Drops** are not activation. To lay out a dropped document, the add
extension calls `api.drop(info)`. That loads each module whose `drops` match
and calls its `drop(ctx, info)` until one returns true, where:
- `ctx` is a temporary api: doc, change, repo, `addObject`, `newId`,
  registry, local;
- `info` is `{ url, doc, handle, group, at: { point, hitId } | null }`.

A drop writes traits into the doc, and those traits are what activate the
extension.

**Stopping:**
- An extension that leaves the running set because of a kit change stops at
  once.
- One that leaves because of a doc change keeps running for 2 s, and for as
  long as it, or an extension it `requires`, has an arm, an open session or
  a pose hold (the hand carrying the table's card), so a peer's undo doesn't
  tear down someone's game.

When an extension stops:
1. cancel its open session;
2. pop its arms (unlock, release camera holds);
3. release its pose holds as put-backs;
4. clear its presence keys;
5. stop its loops, `afterRender` hooks and scheduled work;
6. remove its world groups, disposing their geometry and materials;
7. remove its labels, overlays, edges, styles, cursor and extent;
8. call `dispose()`.

`api.signal` aborts at the start of this. After that, every call through its
api that acquires something is a no-op.

**Migrations.** Only extensions with `scene` or `objects` scope may migrate.
A viewer-only extension's `migrate` is ignored. The stage runs core
migrations first, then the extensions' in running order, each extension at
most three times a session.

Rules for a migration:
- It must be idempotent.
- It must not create a map or list at a key that another peer might also
  create. The scene datatype's `init` and the core migration pre-create
  `traits`, `view` and `dimensions` (the core migration runs on any scene doc
  missing one), so an extension's `if (!d.traits) d.traits = {}` is only ever
  a fallback.

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
6. **`viewer` scope**, in running order;
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
| `id`, `repo`, `handle`, `url`, `viewer`, `signal`, `Counter` | `Counter` is the stage's automerge Counter |
| `doc()`, `change(fn)`, `newId(prefix)` | |
| `scene()` | the snapshot: `{ d, objects, ids, parents, groups, members, traits, world(id) → 4×4 as stored, toLocal(id, p) }`. `members`: group id → the objects in it, at any depth |
| `ops` | pure planners (`src/ops.js`). Each takes the snapshot and returns a change function or null: `api.change(ops.ungroup(api.doc(), id))` |
| `remove(ids)` | remove in one change, after each extension's `beforeRemove(draft, ids)` tidy-up. Best effort only: concurrent edits can still leave dangling ids |
| `registry(type)` | |
| `port`, `root` | the element the canvas fills, and the stage's root (for DOM listeners: drops, pastes; focus) |

**Local, prefs, presence**

| | |
|---|---|
| `local` | `{ get, swap, watch(fn, select?) }` |
| `pref(key, fallback)`, `setPref(key, value)` | read through local and then the doc, as above. Set writes local only |
| `presence` | `{ set(key, value), get() → { [session]: { viewer, at, keys: { [ext]: { … } } } }, watch(fn), rate(hz) }`. Keys are namespaced by the extension and cleared when it stops |
| `send(type, data)` | a one-off message to the same extension on every other peer, delivered at most once and never replayed. Received through `instance.receive(type, data, { session, viewer })` |
| `notify(text, kind?)` | |

**Content**

| | |
|---|---|
| `nameOf(id)` | what this viewer sees, lenses applied |
| `content(id)` | `{ loaded, box, extras, stats, root }` or null. `extras` holds the GLB's extras: `connectors` (normalised), `snapRadius`, `legend`, and the scene's own. `root` is the live three.js node, for reading geometry (dimensions' on-surface test); never change it |
| `loadState(id)` | a copy of what the render manager or GLB queue last said about it (notes, phase, contested, providerId, builtAt, builtHeads, bounds, retryAt, fixed, at, versionMissing…), or null |
| `box(id, { hints })`, `groupBox(id)`, `sceneBox()` | world `{ min, max }`, or null |
| `worldOf(id)` | the displayed world matrix (held poses included) |
| `focus(ids)` | load these first |
| `providersFor(url, doc)`, `addObject(url, opts)` → id | `opts`: `{ providerId?, name?, group?, parent?, before?, transform?, heads? }`. `heads`, or heads in the URL (`automerge:<id>#<heads>`, a Patchwork link at a version), adds it fixed at that version of its source (the object's `at`) |
| `rebuild(id)` | |
| `fixPoint(id)` | the `at` (`{ heads, deps? }`) that would fix a render-doc object at exactly what its render was last built from, or null (not built here yet, not loaded, passthrough). Fixing is a plain field write: `api.change(ops.setField(scene, id, "at", point))`; `undefined` follows the latest again |
| `drop(info)` | |

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
  `doc.view.home`, else `doc.camera` (older docs), else a framing.

**Drawing**

| | |
|---|---|
| `THREE` | the stage's three.js |
| `world({ onTop? })` | a `Group` owned by the extension. Its meshes are widgets the owner gets first refusal of. `onTop` groups are drawn in a second pass over everything (depth-tested among themselves, lit) |
| `labels()` | `{ set(items) }`, where `item = { key, text, position? \| ends?: [p, p] \| screen?: { x, y }, className?, data?, rank?, onPointerDown? }`. Every extension's labels are decluttered together: one gives way to an overlapping label of higher (or equal, earlier) `rank` (default 1), and rank 2 and up never hide. The model's: dimensions 3, axes 2, bounds 1, grid 0 |
| `overlay()`, `edge("top" \| "right" \| "bottom" \| "left")` | DOM owned by the extension. An overlay sits over the canvas and lets the pointer through, except that its direct children catch it by default (a rule with no specificity, so any extension rule wins): a full-size child (a HUD) sets `pointer-events: none`. An edge sits beside it, and the canvas shrinks to fit |
| `style(css)`, `listen(target, type, fn, opts)`, `cursor(name)` | |
| `pose` | `{ hold(id, transform), release(id, { landed? }) }` |
| `heldBy(id)` | the peer session holding this object, or null. While this view holds it too, only a peer that took hold first counts, so of two that grabbed it at once exactly one is told to let go (the hand and the gizmo put theirs back) |
| `extent(box \| null)`, `invalidate()`, `loop(fn(dt, now))`, `afterRender(fn(renderer, size))`, `schedule(fn)` | |

How poses and loops behave:
- **Holding a pose.** `pose.hold(id, transform)` shows an object at that
  local transform while it's held, under its doc parent. Peers see it, with
  50 ms throttling.
- **Releasing.** Call `release(id, { landed: true })` right after writing the
  put-down to the doc. Peers keep the pose until their doc shows the same
  transform, or 3 s pass. A plain release puts the object back at once.
- **Loops.** While any loop runs, the stage renders every frame, and `dt` is
  clamped to 0.1 s.

## `instance`

| | Read by |
|---|---|
| `update(scene, local, prev)` | the stage, once per UI flush when the doc or local state changed; `prev` = `{ scene, local }`. Also when what's shown changed without either (content arrived, a pose was held or let go, a lens changed): then `scene === prev.scene` and `local === prev.local`. If what's shown changed in the same flush as the doc or local state (a rebuilt GLB lands as its status goes back to idle), that second call comes too, right after the first. A pose alone moves boxes, so something that follows content should look at what has loaded (`content(id).loaded`, `local.status`), not the box |
| `looks()` → `Map id → { sourceUrl?, name? }` | the stage (lenses combine in running order; later wins per field) |
| `atmosphere()` → `{ sky?, fog?, sun?, exposure? }` or null | the stage, every flush: sky, fog and sun (see "Atmosphere" below) |
| `input` | the stage |
| `receive(type, data, from)` | the stage |
| `beforeRemove(draft, ids)` | the stage |
| `needsMigration(doc)`, `migrate(draft)` | the stage |
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
  show?: string[],           // the surfaces that show it ("toolbar", "menu", "inspector"); [] none; absent all
  state(target, { scene, local }) → null | { title?, checked?, value?, choices?: [{ value, label }], disabled? },
  run(target, value?) }
```

- `state` returning null (or false) means the command doesn't apply to that
  target. Keys work whatever `show` says.
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
  no fog, the white key light high to one side, no shadows. The model's CAD
  view never gives one.
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
| `stage/activation.js` | the running set and scopes (pure) |
| `stage/chain.js` | the chain order (pure) |
| `stage/viewport.js` | the renderer |
| `stage/router.js` | DOM to events, sessions, the arm stack, lock, keys, menu, cursor |
| `stage/presence.js` | the presence protocol, sends, remote pose holds |
| `stage/host.js` | starting and stopping extensions, the api each gets, ownership |
| `stage/stage.js` | the mount and the doc loop (derive, migrations, content loading, lenses, atmosphere, status, prefs, kits, camera saving), the default layout (port and edges); it answers the embedded build controls' `scene:rebuild` and `scene:render-context` events (`src/controls-tool.js`) and fires `scene:render-context-changed` at them when an object's `at` changes |
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
- **Drawing:** `setExtent(owner, box | null)`, `addLoop(fn)`,
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
  - `scene:pose` carries `{ session, id, parent, transform | null, since, landed? }`,
    `since` being the hold's Lamport stamp: one past every stamp its holder
    had seen. Of two holds on one object the lower stamp wins, then the lower
    session id, so every view agrees, and a hold begun after hearing of
    another always ranks after it. No clock is involved; it's the same kind
    of rule Automerge uses to settle concurrent writes;
- **behaviour:** each presence message is this view's whole state. There is
  a heartbeat every 5 s, a TTL of 15 s and a bye on dispose, and on
  `pagehide` (Patchwork doesn't run the cleanup when a tab closes); a page
  back from the back-forward cache returns as a new session. Presence goes
  out at the highest rate any extension asked for (default 4 Hz), and poses
  are throttled to 50 ms per object;
- **exposes:** `set(ext, key, value)`, `clear(ext)`, `get()`, `watch`,
  `rate(ext, hz)`, `send`, `onReceive`, `hold(ext, id, parent, transform)`,
  `release(ext, id, landedTransform?)`, `remoteHolds()`, `heldBy(id)`,
  `watchHolds`, `settle(id)`, `goodbye()`, `hello()`, `dispose`.
