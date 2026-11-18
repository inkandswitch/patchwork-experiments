# The stage and its extensions: the contract

What the scene's core (the **stage**) promises everything that adds to it
(**extensions** and **view plugins**), and what it asks of them. Plain data and functions; no
extension imports another, and the stage knows no extension by name.
[README.md](README.md) is for people using the tool, [DESIGN.md](DESIGN.md) is
the idea, [HISTORY.md](HISTORY.md) is how and why it got this way, and
[PLANS.md](PLANS.md) is deferred work.

## Words

| Word | Means |
|---|---|
| **Stage** | The core, one per open doc: the doc, content, its channel, holds, lenses, the audience, its extensions and their apis. No UI. |
| **View** | One per mounted tool, shared by its stages: the DOM, viewport, input router, body stack, hand stack, drawer, selection and hover (as paths), notices, prefs, one presence session, its view plugins. |
| **View plugin** | A `scene:view`: runs once per view, whatever the focus; works on the focus stage through `api.focus()`. |
| **Link** | An object whose source is a scene doc (`providerId: "scene.link"`). The view opens a stage for that doc in the link's frame. Live without `at`; pinned with it. |
| **Pin** | A stage that is drawn and never acts: a doc at fixed heads. Read-only. |
| **Closed link** | A link the view opens no stage for, drawn as its hint. |
| **Focus** | The path of links the viewer has entered (`[]` until **Enter**; **Leave** goes out one). The view's alone. |
| **Body** | Where a viewer is and how they move and look. One stack per view, Look (the stage's orbit camera) at the bottom. |
| **Hand** | What a viewer holds: the held tool, a popover, the editor (`scene.edit`'s). One stack per view, offered every event first. |
| **Selection**, **attention** | One target per view, a path. Attention is the selection, else the look. |
| **Service** | What a running instance `provides` by name, for others to `use`. Claims, world time and telling are native ones. |
| **Edit** (a write) | The editor's write (`src/parts/editor.js`): undoable, this viewer's, in the focus doc. |

## Views, stages and links

A view shows one stage per open doc occurrence: the outermost doc's, and one per
open link, in the link's frame. Everything an api touches is its stage's doc:
`null` is its root, every id its own (I1, I2).

```js
// a link
{ name, sourceUrl: <scene doc url>, providerId: "scene.link", renderUrl: null,
  parent?, group?, transform, visible, color, opacity, wireframe, locked?,
  hint: { bounds },        // the room the host gives it, in the link's frame
  at?: { heads, deps? },   // absent: live; set: pinned
  traits?, tags? }         // the host's facts about the link
```

A `scene:source` declares `content: "file"`, `"built"` or `"scene"` (a child
stage). Dropping a scene doc makes a live link.

**Expansion** (`stage/links.js`, pure; I3). A live doc **acts** at one
occurrence per view (shallowest, then smallest link id); every other live
occurrence of it is closed, `"repeat"`. A link with `at` is **pinned**. Closed
reasons are exactly `"cycle"`, `"repeat"`, `"unavailable"` and `"unpinned"`. At
most `LINK_BUDGET` stages open. `api.link(id)` → `{ role, open, reason? }`,
`role` being `"acting"`, `"pinned"` or `"closed"`.

**Acting and drawn.** A pin is drawn: its extensions run and draw into
the world, nothing more. No segment, body, tool, command, widget, chrome,
camera, selection, notice or process (`drawnApi`). There is no `api.role`, only
`api.writable()`.

**Read-only.** A stage that doesn't act, or whose handle refuses writes, gets a
read-only doc and repo (`stage/readonly.js`): every write is refused, and so is
every handle its repo gives out (I6). Who may write is the handle's; "can" is
the thing's (`locked`, `scene.carry`). No grants.

**Fixing a link.** `api.fixPoint(linkId)` → `{ heads, deps }`: the doc's heads
and those of every doc the pin's docs name by URL. A doc nothing names (a
player's secret) is never recorded. Follow latest removes `at`.

**The focus.** Enter moves it into a link whose doc acts there; pins and closed
links can't be entered. Leave is Escape's or the trail's. If the entered
link stops acting, the focus leaves to the deepest acting stage. The focus
scopes the selection (H10) and is where the view plugins work, so the editor
edits the focus doc. It cuts no segment. Focus and selection change only
through `selectionStep` (`src/selection.js`). No stage sees the focus.

**Presence where it is** (I12). A doc's people are drawn where the doc is, by
parts of every doc (`traits: ["*"]`): `walk.people` and `scene.others`.

**Frames** (I7). Everything spatial in an api is in its stage's root frame,
through `stage/scope.js`: positions, boxes, picks, rays, camera, labels, layers,
and every event's `ray`, `hit` and widget. A frame is a similarity. A hit not of
this doc is `{ id: null, point, normal, distance }`; a hit inside one of its
links is the link. Nothing holds the camera.

**Aboard.** World = parent's world · local; groups give scope, not motion. A
carry never changes an object's doc or parent. Parts, drops, templates and paste
write the stage's own doc: to add to a linked doc, enter it.

**Channels** (I5). Presence, sends and holds are each doc's, in its ids, under
the view's one session. The page bus carries broadcasts between views of one
doc in a page. A read-only stage listens and says nothing.

**The outermost doc** gives the view its ambients, `view.start` and the camera's
home.

## Three places for state

| | Shared | Lasts | Read | Write |
|---|---|---|---|---|
| **Doc** | yes | yes | `doc()`, `scene()` | `change(fn)` |
| **Channel** | yes | no | `channel.peers()`, `.get()`, `.watch` | `channel.set`, `.send` |
| **Local** | no | no | `local.get()`, `view.get()` | `local.swap`, `view.select`, `view.enter`, `setPref`, `notify` |

The doc holds what is true for everyone, never the camera or selection. It may
suggest defaults: `api.pref(key, fallback)` is `view.prefs[key] ?? doc.view[key]
?? fallback`. Ids may be missing at any time; readers ignore missing references,
and writers set fields, never whole objects.

**`api.local`** (`get`, `swap(fn)`, `watch(fn, select?)`) is the stage's frozen
value. The stage writes `running` (`[{ id, scope }]`), `status` (`{ [id]: {
state, reason?, text, title } }`) and `packages` (`{ ask, loading, failed, missing
}`); the editor, `edits` (its undo stacks). An extension's own keys are
prefixed `<id>.`; others run its commands instead of writing them.

**`api.view`** (`get`, `watch`) is the viewer's value as this stage sees it:
`selected` and `hovered` (its element, or null); `body` (`{ id, label, ext,
depth, lock, reach, keys, serial }`, depth 0 Look); `hands` (`[{ ext, kind,
name, pointer, serial }]`, top last); `held` (the tool among them, with
`command` and `keys`); `gesture`; `pointer` (`{ locked, lock, wanted, released,
refused, touch }`); `escape` (`{ layer, hint }`); `theme`; `notices`; `drawer`
(`{ tabs, shown, docs }`); `prefs`. Presence keys are the extension's own
(`scene.select`'s `selected` and `hovered`; walk's `avatar`).

## Activation

```js
{ type: "scene:extension", id, name,
  traits?:    string[],    // runs when the scene or an object has one ("*": every doc)
  drops?:     string[],    // may lay out a dropped doc of this datatype ("*": any): "Drops"
  describes?: { [traitKey]: description },
  provides?:  string[],    // the services its instance provides; uses?: those it uses at create
  …                        // other plain data, for other extensions to read
  async load() { return { create(api) → instance, drop?(ctx, info) → boolean | Promise<boolean> } } }
{ type: "scene:template", id, name, icon?, description?, params?: ParamSpec[],
  async load() { return { create(ctx, params) → Promise } } }
{ type: "scene:part", id, name, icon?, category?, description?, tags?, traits?,
  async load() { return { create(ctx, at) → Promise<string | null> } } }
```

**The running set** is a pure function of metadata and the doc (`activeSet`,
`src/stage/activation.js`; H1), recomputed on every doc or registry change;
nothing else changes it. An extension runs for a trait (one with none never
runs: what is the view's is a view plugin): scope `scene` (a scene trait, or
`"*"`: every doc), offered input at its nearest holder, or `objects` (only
object traits), offered input only when the hit chain reaches one of them.

A drop-only extension declares the marker trait its layout writes; a trait a
body reads (`walk.spawn`) has a part declaring it. **Where a trait sits** is its
scope: an object's covers it and what is attached or filed under it; a scene
trait covers the doc. What belongs to a thing lives on that object. One instance
per extension per stage. **Order**: providers (by metadata; one that `uses`
another's service after it), then the rest; each `scene`, then `objects`, in
registry order (`local.running`), the only order anything combines in. Each is
created once everything before it has started or failed, so a create's `use`
finds every service that runs, whatever the registry order.

**Stopping** (H2). An extension leaving the running set lingers `LINGER_MS`
(2 s), and while it holds a body, tool, session or pose. One loading or
unregistered stops at once. `api.signal` aborts first, and what services gave it
goes with it (a kept process saved, claims without `onLost`); then everything it
acquired (panes without `onClose`), then `dispose()`.

**No migrations.** The stage reads only the current doc shape.

### Shared maps

Nothing writes a map or list at a key another peer might also create. Every
scene doc is made with `traits`, `view`, `dimensions`, `assets`, `packages` and
`clock` (`{ running: true, t: 0 }`), by the datatype's `init` and by every tool
that writes a scene doc whole. `view.start` is written whole only by what lays a
scene out. The one exception is an object's `claims` map, made by its first
claim; a claim lost to that merge is written again by its holder.

### Drops

The editor's, as templates and parts are (`src/parts/editor.js`): a doc added by
drop or paste goes to each module whose `drops` take its datatype, `drop(ctx,
info)` until one says true; the traits it writes start its extension. **The drop
context** `ctx` is `{ id, repo, handle, url, viewer, doc, scene, change, newId,
addObject, file, content, worldOf, registry, local, select, notify }`, made from
the focus, its writes one undo step. `info` is `{ url, doc, handle, group, at }`.

### Templates

The empty scene's start screen lists every template from metadata, with a form
for its `params` (`src/param-form.js`); `create(ctx, params)` gets exactly those
(`paramsBySpec`). It writes objects, traits and `view.start`, and its maker then
arrives as the doc says (`api.view.arrive()`).

### Arriving

`view.start = { body, place, home, edit }` is read once, on open or after a
template, and said as `view.arrived` (`{ start, n }`). `home` is the camera for
a viewer with none saved; `edit: true` (the outermost's; a new scene's) has
`scene.edit` pick up the editor, else put it down. A `body` (none is Look) is
entered over Look at `place` once offered and loaded, or `ARRIVE_WAIT_MS` after
the offer. A place that is a link arrives **through** it, as that doc starts
people (`startArrival`); through a pin or a closed link nobody arrives.

### Parts

The bin (`scene.parts`) lists parts from metadata; `create(ctx, at)` gets `at` =
`{ parent, transform, world }` and may adjust it or make several objects; what it
returns is selected. `ctx.file(key, make)` → `{ url, hint }` is the scene's file
doc for a versioned key (`"sailing/mast@1"`), made once and kept in `doc.assets`.
A dropped part goes under the object hit, snapped to a connector that takes its
`tags` (Alt: free), upright (`src/parts/parts-place.js`).

### Copying objects

One copy rule (`src/transfer.js`; `scene.transfer`, the editor's) serves paste,
drops from another scene, extract and bundle. The payload is `application/x-scene-object` = `{ scene, id, ids, lift?, copy? }`. In its own scene paste duplicates; in another it copies the objects and
everything under them with new ids, landing by the parts bin's rule. `claims`,
`saved`, `runtime` keys and `copy: "drop"` fields stay behind. Files are shared;
renders are copied with their build. An `object` reference to a copy follows it,
else is kept in the same scene and cleared in another, with a notice
(`copyRefs`, `refEdits`).

### Extract and bundle

The copy rule in two directions (`src/extract.js`), each one host change and one
undo step, the editor's. **Extract** takes S (tops sharing one parent p), writes doc T whole (ids and
transforms kept), then replaces S with a link to T at p, clearing references
into S; if S changed meanwhile, nothing is written. **Bundle** copies what a
link shows into the host in its place and removes the link; the linked doc is
never written. **K**, the root traits that go along, is the command's `options`;
Bundle refuses a trait the host has.

### Describing traits

`describes` says what an extension's traits are, so the inspector can write
them; offering a trait starts nothing; the first describer wins.

```js
describes: { "<trait>": { name, on?: "object" | "scene" | both, blurb?,
  fields?: ParamSpec[],          // plus kinds object, entry (of: traitKey), url, json
  entries?: { label, noun, prefix, fields, init },   // value is a map of entries
  runtime?: true | string[],     // play state: copies leave it behind
  init? } }                      // a field may also say runtime: true or copy: "drop"
```

Any extension writing play state into a trait must mark it `runtime`. Writes are
field by field; undescribed keys are never touched; readers take a missing field
as its default.

## View plugins

`{ type: "scene:view", id, name, async load() → { create(api) → instance } }`
runs once per view, for its whole life; only the registry starts or stops one
(`src/stage/host.js`). The view offers what it contributes at the focus
stage: `input` at the chain's step 4 and `beforeRemove`, in that stage's frame;
`commands` and other named contributions after its extensions', run in its
context; `update` on its flush (told afresh after a focus move).

| Member | |
|---|---|
| as the stage `api`'s | `id`, `signal`, `repo`, `THREE`, `registry`, `port`, `root`, `pref`, `setPref`, `notify`, `packages`, `overlay`, `edge`, `dock`, `style`, `listen`, `cursor`, `popover`, `loop`, `afterRender`, `schedule`, `invalidate`, `body`, `now`, `after`, `frame`; `use` (the focus stage's services, then the view plugins'); `camera`, `pick`, `ray`, `project`: in the world; and the view's `viewer` and `session` (no channel of its own) |
| `view` | the viewer's value whole (`selected`, `hovered`, `focus` as paths; `packages`, `arrived`); `step(ev)` (`src/selection.js`), `dock(doc)` |
| `hand(spec)`, `putDown()`, `offerWidget(type, ev)` | see "Hands"; a hand hears events in the world, each hit with its `path` |
| `collect(name)`, `run(inv)`, `path(opts)` | every acting stage's offers, the input path's first, tagged `stage`; `run` in the stage named, else the focus; the input path's readers `{ stage, path, scene, collect, context, attention, look, pointed, run, runs, nameOf, writable, use }` (`pointer: true`, `focus: true`, or `at` a full path) |
| `focus()` | the focus stage's `api` for it; what it acquires through it goes when the focus leaves (a tool its command holds is put down), the plugin stops or the stage closes |

## Packages

The doc lists the packages its contents come from, and the stage loads the ones
a viewer lacks (`src/packages.js`, `src/stage/packages.js`, `scene.packages`).
`doc.packages` is `[{ url }]`, read through `listedPackages(doc)`. A URL is
`automerge:<id>` or a public `https:` URL (`packageUrl`); anything else is never
listed or loaded. The doc's needs (`neededPlugins`) are the `scene:source`s for
each `providerId` and the extensions for each trait; view plugins and `"*"`
extensions are not needs. After every doc or registry change, reconcile
(`reconcileList`) adds the package of each registered plugin answering a need,
and, once the registry is quiet and every need is answered here, prunes listed
packages registered here that answer nothing. A viewer without a plugin adds and
removes nothing. Every scene doc carries `@patchwork.suggestedImportUrl`, the
scene package.

**Loading.** One prompt covers every open doc: each missing package by name and
URL, with **Load** or **Not now**. A package loaded on a click is remembered
(`localStorage` `scene-packages:accepted`) for later scenes; nothing else
outlives the session. **Security**: nothing loads without a click on Load for
that URL or a remembered one, only listed URLs load, and the card always shows
the URL.

## The input chain

The stage turns DOM input on the canvas into **events** (values); anything else
is the DOM's. Each event goes, until one claims it: (1) **the hands**, top
first; (2) **the widget's owner**; (3) **the holders, nearest first**: the hit
object, what it's attached to, its groups, the scene (an extension's holder,
`ev.holder`, is its nearest member with one of its traits; across links a
segment per stage, innermost first); (4) **the view plugins**, in registry order;
(5) **the top body**; (6) **the default**: drag orbits or pans, the wheel zooms.
Steps 2–4 are `chainOrder` and `holdersFor` (`src/stage/chain.js`); each
extension is offered an event once, running order breaking ties.

**Carrying** is `scene.carry`'s, offered a press as a holder; a press that
doesn't move is a tap it gives back. **The halo** (`scene.halo`,
`scene.handles`) works in the parent's drawn frame, has no keys, and writes once
on release.

```js
event = { type: "press" | "click" | "menu" | "key" | "keyup" | "wheel" | "move",
  x, y, clientX, clientY, ndc, ray: { origin, dir },
  hit,      // lazy: { id, point, normal, distance } | null
  widget,   // lazy: { owner, onTop, distance, ...data } | null
  holder, button, buttons, pointerId, pointerType,
  shift, alt, ctrl, meta, key, code, repeat, dx, dy, deltaY,
  locked }  // under lock, x, y and ray are the centre's
input = { press(ev) → session | null, click, menu, key, keyup, wheel,   // → boolean
          widgetAt(ev) → { onTop?, distance?, ...data } | null, cursor(ev) → string | null }
session = { move(ev), end(ev), tap?(ev) → boolean, cancel(), key?(ev) → boolean, cursor? }
```

`menu` is a right-click or a 500 ms touch hold. `move` starts past 4 px; a
release under 4 px is a `tap`, else a `click` goes down the chain. A release
never heard cancels. **Widgets** are meshes in `world()` groups, or `widgetAt`;
`onTop` beats any object, others compare by distance; `userData.noPick` is never
picked. There is no double-click event: a `dblclick` on the canvas is no one's.
**Attention** is the selection, else the look: the pointer's hit, or the eye ray
under lock (`looksFromEye`).

### Keys

Keys are heard on the tool's root; those in an embedded document (marked
`data-stage-embed`, `src/embed.js`) are its own. **One key order**
(`src/keymap.js`): a focused field, the gesture's declared keys, the held
tool's, the top body's, then the key map (`scene.keys`, the only `input.key`)
over attention's path. Keys are declared `[{ code, label }]`, and a reserved key
is its reserver's. **A shown key works** (H3): every surface asks the
dispatching resolver. A `keyup` goes to its `keydown`'s claimer. On touch,
declared keys become pad controls (`src/touch-keys.js`); codes labelled alike
are one control, so distinct actions need distinct labels.

### Bodies

```js
bodies: [{ id, label, keys: [{ code, label }], lock, reach,   // metres or Infinity
           here?,                                               // false: needs a place
           enter(place) → { input, eye?() → { position, direction },
                            ride?: { id, at?, turn?, rise?, tilt? }, keys?, label?, leave() } | null }]
```

Look (`src/stage/bodies.js`, the orbit camera) is at the bottom; **walk**,
**seat** (`here: false`, tilting with its table) and sailing's **station** are
packages'; the first to offer an id has it. `api.body.enter(id, place)` pushes
what `enter` answers, in the calling stage; `enter("look")` leaves every body;
`leave()` pops the top. The top body hears every move and its keys; its eye and
reach are every command's `from` and `reach`. No body is the editor.

### Hands

What a viewer holds, a stack per view (`src/stage/router.js`): `{ kind, name,
input, keys?, pointer?, escape?() → boolean, put?() }`, hearing every move; one
that doesn't want an event answers false. **The held tool**: a command's `tool:
{ keys?, pointer? }` holds what `run` returns, `api.hold({ name, keys?, pointer?
}, input)` one without; it replaces the tool held, and only it declares keys.
**A popover** (`api.popover(close)`) wants the pointer. **The Edit hand**,
`scene.edit`'s (`api.hand`; the chip's Edit runs its `edit` command), wants the
pointer; its click selects at the focus (clears on nothing, nothing outside it),
offered first to a widget's owner under it (`api.offerWidget`); presses aren't
its; a tool can sit over it. **The editor's** chrome (halo, inspector, editor
toolbar, aids, Measure, every `edit: true` command) shows only while
`editing(view)` (H13); putting it down puts down such a tool and the selection.

**Escape** (`src/stage/ladder.js`; H4) pops one layer: the browser's lock, a
focused field, the gesture (cancelled), then the top hand's `escape()` (a
popover closes; Edit's clears the selection, else leaves the entered link), and
when that does nothing the hand is put down (`put()`); with no hand, the
selection clears, else the focus leaves. Never a body or the world's time. **The
pointer** (`src/stage/pointer.js`; H5): `locked ⇔ body.lock ∧ ¬wanted ∧
¬released ∧ ¬refused ∧ ¬touch`; a hand with `pointer: true`, a selection or the
drawer wants it; after a release or touch, the next press on the world only
relocks.

## The interface

All view plugins: the **toolbar** (the focus path's scene commands: the
editor's while editing, `"world"` ones always), the **body chip** (Look,
bodies with `here` not false, Leave, **Edit**), the **clock chip** (each
focus-path doc's), the **drawer** (panes, `api.dock`; documents,
`api.view.dock`), the **inspector** (tree, fields and the selection's
documents, with **Dock** and **Open**: `src/parts/inspector-model.js`), the
**use prompt** (attention's `"use"` verbs) and the **menu** (what applies to
what was pressed, Select first). The clock chip (`scene.clock-chip`) reads each
stage's `"clock"` through its reader's `use`.

## `api`

Each extension gets its own `api`; everything acquired through it is that
extension's.

| Member | |
|---|---|
| `id`, `repo`, `handle`, `url`, `signal` | |
| `doc()`, `change(fn)`, `newId(prefix)`, `registry(type)` | `change` → its patches (`[]`: nothing written); `registry` → the registry, at once |
| `writable()` | false in a pin or on a refusing handle |
| `scene()` | `{ d, objects, ids, parents, groups, members, traits, world(id), toLocal(id, p) }` |
| `ops` | pure planners (`src/ops.js`) → a change function or null |
| `remove(ids)` | a change function: every `beforeRemove`, then the removal |
| `notify(text, kind?)`, `audience`, `shown`, `pose`, `heldBy`, `ambient` | see "Audience", "Holding a pose", "Ambients" |
| `use(name)`, `settled()` | a service: the first running provider's facet, made for this extension, or null; `{ ready, missing }`: everything the doc calls for started or failed, every listed package here (`missing`: those that aren't) |
| `now()`, `after(ms, fn)`, `frame(fn)` | the stage's one time (`src/stage/time.js`, ms); `after`, `frame` → cancel. Never `Date.now`, `setTimeout` or `requestAnimationFrame`. `manualTime()` moves only when stepped |
| `local`, `pref(key, fallback)`, `setPref` | see "Three places for state" |
| `channel` | the doc's ephemeral side: `{ viewer, session, peers(), get(), set(key, value), watch(fn), send(type, data), rate(hz), shownAt(session) }`; `peers()` → `{ [session]: { viewer, body, held, at, keys } }`, `get()` this extension's keys by session; `send` reaches its `receive` on every peer; cleared when it stops; `session` null in a pin |
| `page` | `{ visible(), on("hide" \| "show" \| "visible", fn) → off }`: pagehide or the stage closing (last-first), pageshow from the back-forward cache, the tab's visibility |
| `packages` | `{ load(urls?), dismiss(urls?) }`: the prompt's answer |
| `nameOf(id)` | the name this viewer sees |
| `content(id)` | `{ loaded, box, extras, stats, root }`; `extras.connectors` each `{ position, rotation, yaw, tags }` |
| `loadState(id)` | where content was routed and what its loader said |
| `box(id, { hints, in })`, `groupBox`, `sceneBox` | `{ min, max }` or null |
| `worldOf(id)` | the drawn matrix, holds included; `scene().world(id)` is the doc's |
| `focus(ids)` | load first |
| `providersFor(url, doc)`, `addObject(url, opts)` | → a change function with its `id`; `opts`: `{ id?, providerId?, name?, group?, parent?, before?, transform?, heads?, hint?, fields?, render? }` |
| `fixPoint(id)` | the `at` fixing an object at what it shows now |
| `view` | `{ get, watch, select, enter, arrive, dock({ url, toolId?, title }) → close }` |
| `link(id)`, `collect(name)`, `run(invocation)` | `collect`: this stage's offers, tagged `stage`; `run` in the stage `invocation.stage` names |
| `body`, `hold`, `popover(close)`, `context(hit?)`, `attention()`, `look()` | see "Bodies", "Hands"; `context` is `{ scene, local, view, from, reach, hit, distance(target) }` |
| `THREE`, `world({ onTop? })` | three.js; a `Group` whose meshes are the extension's widgets |
| `labels()` | `{ set(items) }`; decluttered by `rank`, 2 and up never hide |
| `overlay()`, `edge(side)` | DOM over or beside the canvas; overlay children catch the pointer unless they opt out |
| `dock(el, { title, onClose?, embed?, show? })` → close | a drawer pane; only its × calls `onClose`; `embed: false` is stage chrome |
| `style`, `listen`, `cursor`, `extent(box)`, `invalidate`, `schedule`, `port`, `root` | `port`: the canvas's element; `root`: the view's |
| `loop(fn(dt, now), { first? })`, `afterRender(fn)` | the stage renders every frame while a loop runs (WebGL or not); `dt` ≤ 0.1 s; `first` runs before the others |

**Dressing.** An extension may move or hide `content(id).root` nodes of objects
carrying its traits (a buoy bobbing) and puts them back when it stops. It is
only a look: boxes, picking and shadows go by the pose.

### Picking and camera

`pick(x, y, { ground?, snapPx? })`, `ray(x, y)`, `raycast(origin, dir, { far?,
skip? })` (hit `{ id, point, normal, distance, back }`) and `project(p)`.
`camera` is `{ get, set, frame(box), hold, ride, touched, watch, onEnd }`, in
the stage's frame.

**Hold**: orbit off, nothing saved. **Riding**: `ride(id, { turn, rise, tilt, at
})` carries the orbit camera with an object (`id` null: the stage's root); one
ride applies, the top body's, else the latest base ride (`src/stage/ride.js`).
**Saving**: the camera is the viewer's (`localStorage` `scene-camera:<url>`),
else `view.start.home`.

### Holding a pose

`pose.hold(id, transform, { yields })` → boolean shows an object at a local
transform while held, streamed to peers (20 Hz, or `channel.rate`) and played
back smoothly (`stage/smooth.js`). **One holder** (H6): a person's before a
yielding one, then the earliest `since`, then the session (`ranksAhead`,
`src/stage/holds.js`). A refused holder writes nothing for that object.
`worldOf` in a loop is this frame's pose. Call `release(id, { landed: true })`
right after writing the put-down.

### Undo

The editor's (`src/parts/editor.js`, `src/undo.js`): it records its own writes
from what `change` returns, per person and per focus doc; a package's verb, a
clock act or a process save is never one. A step restores only if the doc still
holds all it wrote, else it is dropped and said; kept objects come back as their
keeper has them now.

## `instance`

| | Read by |
|---|---|
| `update(scene, local, prev, view)` | the stage, once per flush when doc, local, view or what's shown changed |
| `looks()`, `audience(scene)`, `ambient()` | see "Lenses", "Audience", "Ambients" |
| `input`, `bodies`, `commands` | see "The input chain", "Bodies", "A command" |
| `provides` | `{ [name]: (caller) → facet }`, each name in its metadata's `provides`: see "Native services" |
| `messages`, `receive(type, data, from)` | see "Native services" (Telling); `receive` hears this extension's sends |
| `beforeRemove(draft, ids)`, `dispose()` | the stage |
| `hud()` → `[{ text, state }]` | status surfaces |
| `landing(id, worldPoint, hitId)` → `{ faceUp?, flat? }` | the carry, every move; see "Landing" |
| `carryable(id)` → `false` | the carry: a veto for passing states |
| `landed(id, on)` | the carry, once after a put, on the carrier's client |
| `carry(id, ev, opts)` → session | `scene.carry` provides it |

### A command

```js
{ id, name,
  key?: string | string[],    // KeyboardEvent.key values
  show?: string | string[],   // "toolbar", "world", "menu", "inspector", "use"; [] none
  hold?: boolean,             // shown as "hold F"
  reach?: true, edit?: true,
  tool?: { keys?, pointer? },
  state(target, ctx) → null | { title?, label?, checked?, value?, choices?, options?, disabled? },
  run(target, value?, ctx) → void | session | input }   // ctx: api.context(hit)
```

`state` null: not for this target; no `state`: the scene only. Keys work
whatever `show` says; absent `show` means every surface but `"world"`. `label`
names the verb for this target; `title` is the tooltip, and the reason when
`disabled`. `options` become inspector checkboxes passed as `value`. `reach:
true`: beyond reach it is "too far" and runs nowhere (H9). `edit: true`: only
while editing (`inBody`). **Held verbs**: `run` returns `{ end(), cancel(), update?(dt)
}`, kept while the key is down.

### Targets and refs

A target is null (the scene), an object or group id, or a ref `"<kind>:<id>"`
(`"dimension:<id>"`; object ids have no colon). The selection is one target. A
ref's owner answers for it and lets go when its thing is gone. Object-only code
checks `scene.objects[target]`.

### Lenses

`looks()` → `Map id → { sourceUrl?, name?, veil? }` changes how objects appear
to this viewer. Looks merge field by field in running order, later winning;
`nameOf` applies them.

### The veil

`veil: true` means "kept from you". The stage draws a frosted box with a padlock
from `hint.bounds` alone (`stage/veil.js`) and loads none of the object's
content. A later `veil: false` lifts it.

### Landing

Where a carried piece goes down, how it lies is `landedPose`
(`src/parts/carry-math.js`): how it is held (Q/E, F), the snap, then the merged
`landing` answer. `flat` lays it on its broadest face; `faceUp` turns it face up
unless F has turned it since; the snap (`intoSnap`, `src/carry-rules.js`)
applies a connector's frame or yaw. Up, down and on edge are one 45° test
(`sideOf`). Paste and the bin use the snap step.

### How a carry ends

A carry session's `ended` promise settles once to `{ how, on }`: `"put"`
(written once, `landed` called), `"back"` (cancelled, nowhere to land,
read-only, gone), `"yielded"` (a peer's hold ranks ahead) or `"refused"`
(something here holds it). Only a put writes.

### Audience

Who may see what a thing really is. The stage enforces nothing; it gives keepers
one answer per object, the same on every peer (`stage/audience.js`).

```js
audience(scene) → (id) → null | { show?: "all" | viewer[], only?: viewer[] }
// shown = ∪ show;  audience = shown ∩ (⋂ only);  a throwing policy is { only: [] }
```

A policy is pure in the snapshot. `api.audience(id)` and `api.shown(id)` return
null while a listed package is missing or a called-for extension hasn't started;
secrets then stay hidden. It isn't access control: anyone who can write can
change an audience, visibly.

## Native services

Doc extensions of every doc (`src/native/`), on the public api only, each
`provides`-ing one service; what a facet hands a caller goes as its signal
aborts. The kernel knows no service by name.

**Claims** (`scene.claims`, `"claims"`): `claim(id, kind, { onLost })` →
release | null, `claimedBy(id, kind)` → `{ viewer, session, mine }` | null. A
claim is `objects[id].claims[kind] = { viewer, session }` (`doc.claims[kind]`
for the scene), counted while its holder is on the channel (a session never
heard: 6 s), never in a pin. Of concurrent takers the merge keeps one; the
loser gets `onLost`. Claims go with the release, the caller stopping or
pagehide, and come back on pageshow. A claim says who; a pose hold says where.

**World time** (`scene.clock`, `"clock"`; H7): `doc.clock = { running, t, by?
}`; `{ t(), running(), computer(), status(), watch(fn), pause(), resume(),
process({ start?(t), step(dt, t), save?(d), stop?(), replicated? }) → remove
}`. The view holding the `"clock"` claim computes: it acts, may write, is
visible and `settled()`, and has a process. `t()` never goes back; followers
chase the computer's t, never past it; paused, every view's t is `clock.t`.
Processes step on a 1/60 s grid (a replicated one in every view). Checkpoints
(every 30 s, on pause, on letting go) write `clock.t` and every `save(d)`,
stamping what a save moved `saved: t`. Anyone who may write pauses. World time
pauses; act time (`now`, `after`, `frame`, `loop`: a die's tumble) finishes;
liveness (TTLs, grace) never stops (H8).

**Telling** (`scene.telling`, `"tell"`): `tell(type, data)`, after the change
that bears it out, for `messages: { [type]: { valid(data), says(data, who,
scene) } }`. Told here at once as "You"; there `says` is asked until it answers
text or 3 s pass (null: not borne out yet); `who` is `{ viewer, name, mine }`.
Told at most once; a view that can't write tells nothing.

## Conventions

Contributions and module exports by which packages that don't know each other
meet. Depend on the convention, never its provider.

### Seats

From `seats` ([seats/README.md](../seats/README.md)). Trait `seats`: `{
[seatId]: { name, player, lasting?, camera? } }` on the scene or an object.
Contributions: `roster` (`seats`, `viewers`, `open`, `nameOf`, pure in the
snapshot; `who`, `sitting`, `stateOf`, `sit`) and `seatPlaces` (`(scene) → [{
seat, of?, id, min, max }]`). The plugin with `roster: true` exports `lay(d,
seats, of?)` for setup code.

### Keepers

An extension with its own trait that holds what objects are, away from the
scene doc. Its metadata says `keeper: "<kind>"` (the editor reads it), and it
contributes `keeper` (`{ kind, of, name, shuffle }`), read with
`collect("keeper")`. Its looks follow the audience: in it, the item's; shown
only, the veil; else the object's own.

### Ambients

What a world has once. `instance.ambient()` offers `{ [name]: value | null }`;
offers stack per name in running order and are copied to frozen plain JSON
(non-plain is refused as `null`). **A world's ambients are its outermost
doc's.** `api.ambient(name)` → `null | { value, mine, frame, use }` (I13): `use`
is the outermost's services (its world time).

### Atmosphere

```js
{ sky?: { top, horizon, bottom }, fog?: { color?, near, far },
  sun?: { direction, color?, intensity?, shadows? }, exposure?, clouds?: { cover, contrast?, scale?, base? } }
```

One atmosphere wins whole. None is the stage's own look. Ask a flush with
`api.schedule` when it changes on its own.

### Water and wind

**Water**: trait, ambient and contributions `water` and `water.waves`
([water/WATER.md](../water/WATER.md)). **Wind**: the ambient `wind`, from the
`weather` trait ([weather/WEATHER.md](../weather/WEATHER.md)).

## Invariants

| | Invariant |
|---|---|
| H1 | What runs is the doc's: the host resyncs only on a registry or doc change. |
| H2 | One stop rule: stop only when the doc stops calling, after the linger or once not busy. |
| H3 | A shown key works: hints come from the dispatching resolver; each key reaches at most one invocation; a shown touch control reaches its reserver. |
| H4 | Escape pops exactly the top of lock, field, gesture, top hand (its escape first: Edit's clears, then leaves), else selection, then focus; never a body or the clock; the hint names it; every state ends in as many presses as layers. |
| H5 | locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused ∧ ¬touch; after a release or a finger, a press on the world only relocks. |
| H6 | One holder per object, by (person before yielding, `since`); a process saves only what it holds. |
| H7 | At most one clock computer per doc, only eligible views; t monotone per view; no kept process stepped once paused is seen. |
| H8 | A pause changes no act or liveness outcome. |
| H9 | A `reach` command runs iff distance ≤ body.reach, else shows "too far". |
| H10 | The selected path ends at an element of the focus stage. |
| H11 | Carry only with `scene.carry`, no veto, no hold ahead, in its own doc's stage. |
| H12 | An event goes to the hands top first, then the chain, then the top body, cut at the first claim; a tool held replaces only the tool held. |
| H13 | Editing ⇔ the Edit hand is held: its chrome shows exactly then, in any body; no body changes it; putting it down puts down the selection and an `edit: true` tool. |
| I1 | Every api read and write goes to its stage's handle. |
| I2 | No reference crosses docs; a link is the only edge between docs. |
| I3 | Expansion is finite and fixed by the graph: no identity repeats on a path, one acting occurrence per live doc, exact closed reasons. |
| I4 | A stage's snapshot, running set, audience, looks and shown depend only on its doc and the registry; only space and `ambient`'s `mine`, `frame`, `use` depend on placement. |
| I5 | An object's holds and sends, and so its claims, travel on its doc's channel. |
| I6 | A read-only stage writes nothing, through its api or its repo. |
| I7 | Points map by the frame's similarity, directions by its rotation, distances by its scale; boxes are the stage's own. |
| I8 | Inner segments first, out to the outermost; each (stage, extension) once; nothing from a pin; the ride is the current body's, else the latest base ride. |
| I9 | Extract and bundle are each one host change; `bundle(extract(S, K), K)` restores every non-runtime field when S has no edge outside. |
| I10 | Each stage sees its own element of selection and hover or null; keys visit attention's path innermost first; one resolver computes every hint. |
| I11 | Runtime state has at most one writable holder among reachable docs. |
| I12 | Every acting stage draws its doc's people in its frame; a pin draws nobody; nobody draws this view. |
| I13 | Every `api.ambient(name)` is the outermost's stacked value, one frozen object, `mine` only at the outermost; non-plain offers are refused. |

## Inside the stage

For whoever maintains it. Each module named above holds what its sentence says.
The rest:

| Module | Holds |
|---|---|
| `stage/stage.js` | the mount, doc loop, `makeApi` (the channel, the page, services), content, lenses, audience, arriving |
| `stage/view.js` | the view: viewport, router, bodies, selection, prefs, camera saving, session, link expansion, cross-stage input, the view plugins' api |
| `stage/host.js` | starting (in running order) and stopping extensions and view plugins; `collect`, `use` |
| `native/` | the native services, on the public api only: `claims.js`, `clock.js`, `telling.js` |
| `stage/router.js` | DOM to events, sessions, the body stack, the hands, lock, keys, Escape, menu, cursor |
| `stage/presence.js` | the wire protocol: presence (heartbeat 5 s, TTL 15 s), sends, poses |
| `stage/viewport.js`, `stage/dock.js` | rendering and picking, one per view; the drawer |
