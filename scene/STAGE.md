# The kernel: the contract

What the scene's kernel (`src/stage/`: the **stage** and the **view**) promises every plugin, and what it asks. Plain
data and functions; no plugin imports another, and the kernel knows none by name. The rest is plugins':
[NATIVE.md](NATIVE.md), [EDITOR.md](EDITOR.md), [CONVENTIONS.md](CONVENTIONS.md).

## Words

| Word | Means |
|---|---|
| **Doc** | An Automerge scene doc: `objects: { [id]: { name, sourceUrl, providerId, parent?, group?, transform, traits?, … } }`, the scene's `traits`, and plugins' own keys. |
| **Stage** | One doc open in a view: its doc, content, channel, frame, extensions and their apis. It **acts**, or is only **drawn**; a **pin** is drawn at fixed heads. |
| **View** | One per mounted tool: DOM, viewport, input, the **body** and **hand** stacks, selection, hover and **focus** (paths; the focus is the acting stage entered), one presence session, the stage tree, its view plugins. |
| **Extension** | A doc plugin (`scene:extension`): one instance per stage whose doc calls for it. |
| **View plugin** | A `scene:view`: one instance per view, for its whole life; works on the focus stage through `api.focus()`. |
| **Contribution** | A named field of an instance, read with `collect(name)`; the kernel reads only those under "`instance`". |
| **Event** | A value the view makes of DOM input on the canvas ("The input chain"). |
| **Service** | What an instance `provides` by name, for others to `use`. |
| **Layer** | Of the scene package's modules, lowest first: shared (formats, math), the kernel (`src/stage/` and the modules it is built from), native (`src/native/`, `src/sources/`), the editor (`src/parts/`), entry. Imports go only down; above the kernel, only to its api and its face, `stage/public.js` (pure helpers, re-exported). The table and its check: `src/native/boundary.test.js`. |

## Views, stages and links

A view shows a tree of stages: the outermost doc's, and each one a view plugin opens under an object of another, as its
content, in its frame.

| | |
|---|---|
| **Opening** | `api.open(handle, { under: [stagePath, id], acting?, heads?, deps? })` → close, or null: a doc acts at one stage per view, only under one that acts (NATIVE.md, I3). `acting: false` is drawn; `heads` a pin (its repo finding docs at `deps`' heads). Closing one closes what is under it and takes the focus out. A `content: "scene"` source is drawn as its hint until a stage is open under it. |
| **Its doc** | An api touches only its stage's doc: `null` is its root, every id its own (I1, I2). |
| **Embedded documents** | A document the stage shows inside it, marked `data-stage-embed` (`embed.js`), keeps its own keys, pastes and drops. A render's build controls ask the stage with DOM events bubbling to its root: `scene:rebuild` (`detail: { renderUrl }`; the stage rebuilds it and cancels the event) and `scene:render-context` (the stage sets `detail.at`, the object's fixed version); it tells every `.scene-render-controls` element `scene:render-context-changed` when an object is fixed, refixed or let go. |
| **Drawn** | Extensions run and draw, nothing more: no segment, body, tool, command, widget, chrome, camera, selection or view service (`drawnApi`). |
| **Read-only** | A stage that doesn't act, or whose handle refuses, gets a doc and repo refusing every write (`stage/readonly.js`; I6). |
| **The focus** | Goes in with `api.view.enter(id)`, out on Escape's last rung; it scopes the selection (H10), changes only through `selectionStep` (`src/selection.js`), and no stage sees it. |
| **Frames** (I7) | Everything spatial in an api is in its stage's root frame, a similarity (`stage/scope.js`); a hit not of this doc is `{ id: null, point, normal, distance }`. World = parent's world · local; groups give scope, not motion. |
| **Presence where it is** (I12) | A doc's people are drawn where it acts, from its channel. |
| **The outermost doc** | Gives the view its ambients, `view.start` and the camera's home. |

## Three places for state

| | Shared | Lasts | Read | Write |
|---|---|---|---|---|
| **Doc** | yes | yes | `doc()`, `scene()`; ignore missing ids | `change(fn)`, field by field |
| **Channel** | yes | no | `channel.peers()`, `.get()`, `.watch` | `channel.set`, `.send` |
| **Local** | no | no | `local.get()`, `view.get()` | `local.swap`, `view.select`, `view.enter` |

## Activation

`{ type: "scene:extension" | "scene:view", id, name, traits?, provides?, uses?, …, async load() → { create(api) →
instance } }`: `traits` for an extension (`"*"`: every doc); the services it `provides`, those its create `uses`; other
plain data for plugins (`drops`, `describes`: EDITOR.md).

| | |
|---|---|
| **The running set** | A pure function of metadata and the doc (`stage/activation.js`; H1). An extension runs for a trait: scope `scene` (a scene trait, or `"*"`) or `objects`; a trait covers what it sits on and what hangs or is filed under it. One instance per stage. |
| **Order** | Providers (after those of what they `uses`), then the rest; each `scene`, then `objects`, in registry order (`local.running`), the only order anything combines in. Providers start in parallel, each waiting only for the providers of what it `uses`; the rest wait for all before them and the view's providers, so a create's `use` finds every service that runs. |
| **Stopping** (H2) | Leaving the running set, an extension lingers `LINGER_MS` (2 s), and while it holds a body, tool or session or an instance's `busy(id)` says so; one loading or unregistered stops at once. Its `signal` aborts (services' gifts go), then what it acquired goes, `dispose()`. |
| **Failing** | A failed one starts again only when its plugin registers from elsewhere (its package's next version). |

## View plugins

One per view, for its whole life (`stage/host.js`). Its `input` is the chain's step 4; its `beforeRemove`, `commands`
and contributions come after the focus stage's extensions', in that stage's frame and context; `update` on its flush.

| Member | |
|---|---|
| as the extension `api`'s | `id`, `signal`, `repo`, `THREE`, `registry`, `port`, `root`, `overlay`, `edge`, `style`, `listen`, `popover`, `loop`, `afterRender`, `schedule`, `invalidate`, `body`, `now`, `after`, `frame`; `camera`, `pick`, `project` in the world |
| `url`, `viewer`, `session`, `use(name)` | the outermost's url; a view plugin's service, else the focus stage's |
| `view` | `get()`, `watch(fn, select?)`: the value whole (`selected`, `hovered`, `focus` as paths; `packages`; `arrived`: "Arriving"); `step(ev)`, `set(value)` (its own) |
| `packages` | `{ load(urls?), dismiss(urls?) }`: the prompt's answer for every open doc's (`view.packages`) |
| `hand(spec)`, `putDown(tool?)`, `offerWidget(type, ev)`, `wantPointer()` | "Hands"; events in the world, each hit with its `path`; `putDown` one of `held`, else the topmost |
| `open(handle, o)`, `opening()` | "Views, stages and links"; `close.reached`: docs its repo found; arriving waits on `opening` |
| `focus()` | the focus stage's `api` for it; what it acquires there goes as the focus leaves |
| `path(o?)` | the input path's stages, innermost first (`{ pointer: true }`, `{ focus: true }`, `{ at: path }`), each a reader: `{ stage, path, scene(), runs(ext), collect(name), context(hit), attention(), look(), pointed(), nameOf(id), writable(), use(name) }` in its frame |
| `collect(name)`, `run(inv)`, `routes()`, `tap(fn)` → off | acting stages' offers, the input path's first, tagged `stage`; run ("Commands") in the stage named, else the focus; the last 50 events' routes (`{ type, at, path, steps: [{ step, stage?, ext, holder? }], took }`); every channel message sent or heard (`{ stage, url, dir, kind, session, viewer, ext?, type?, data?, keys?, to? \| dropped? }`), made only while tapped |

## `api`

Each extension's own; what it acquires through it goes when it stops.

| Member | |
|---|---|
| `id`, `repo`, `url`, `signal`, `registry(type)` | `repo` is `{ find(url), create(doc), create2(doc), peerId }`, what it finds noted (a link's fix holds it); `registry(type)` that type's plugin registry at once, or null: `get(id)`, `has(id)`, `all()`, `filter(fn)`, `load(id)` → Promise, `on("changed", fn)` → off |
| `doc()`, `scene()`, `change(fn)`, `newId(prefix)`, `writable()` | `{ d, objects, ids, parents, groups, members, traits, world(id), toLocal(id, p) }`; `change` → its patches (`[]`: none), its message `{"ext":id}` (the stage's own `{"kernel":…}`; `lastWriter(doc, path)`: `stage/provenance.js`) |
| `ops`, `remove(ids)` | `src/ops.js`: pure planners (`setTransform`, `setTransformPart`, `setField`, `removeObjects`, `attachTo`, `fileIn`, `newGroup`, `ungroup`, `moveRow`, `setLayerShown`, `clearLayers`) → a change function or null; `remove` runs every `beforeRemove` first |
| `use(name)`, `settled()` | the stage's first provider's facet, else (acting) a view plugin's, or null; `{ ready, missing, failed, errors }` (`ready`: nothing the doc calls for is still on its way, a failed one included; the clock and the audience also need `failed` empty; `errors[id]`: why) |
| `now()`, `after(ms, fn)`, `frame(fn)`, `loop(fn(dt, now), { first? })`, `afterRender(fn)` | the stage's one time (`stage/time.js`; `manualTime()` moves when stepped), → cancel; never `Date.now`, `setTimeout`, `requestAnimationFrame`; rendering every frame while a loop runs, `dt` ≤ 0.1 s |
| `local` | `get`, `swap(fn)`: the stage's frozen value; the kernel's `running` (`[{ id, scope }]`), `status` (`{ [id]: { state, reason?, text, title } }`), `packages` (`{ ask, loading, failed, missing }`); plugins' keys `<id>.`-prefixed |
| `view` | `get`: the viewer's, as this stage sees it: `selected`, `hovered` (its element or null; I10), `body` (`{ id, label, ext, depth, lock, reach, keys, serial }`), `hands` (`[{ ext, kind, name, keys, pointer, serial }]`, top last), `held` (its tools, `[{ ext, command, name, handKind, keys, pointer, serial }]`), `gesture`, `pointer` (`{ locked, lock, wanted, released, refused, touch }`), `escape`, `theme`, view plugins' values; `select(target)`, `enter(id)`, `arrive()` |
| `channel` | the doc's ephemeral side (`stage/presence.js`; I5): `{ viewer, session, peers(), get(), set(key, value), watch(fn), send(type, data), rate(hz) }`; `peers()` → `{ [session]: { viewer, body, held: [{ name }] (top last), at, keys } }`; `send` reaches `receive` on every peer; `session` null in a pin |
| `page`, `packages` | `{ visible(), on("hide" \| "show" \| "visible", fn) }`; the prompt's answer for its doc, `{ load(urls?), dismiss(urls?) }` |
| `nameOf(id)`, `content(id)`, `loadState(id)`, `box(target, { hints?, in? })`, `worldOf(id)` | `{ loaded, box, extras, stats, root }`; where content went, what its loader said; `{ min, max }` or null, an object's, a group's (its members') or the scene's (`null`); the drawn matrix |
| `focus(ids)`, `providersFor`, `addObject(url, o)`, `fixPoint(id)` | load first; → a change function with its `id`; `at` for what a built object shows |
| `display(id, o)` → release | **Display**: `{ transform?, content?, hidden?, name?, tint?, opacity?, outline? }` shows an object otherwise to this viewer, unwritten (`worldOf`, boxes, picks, labels follow); layered in running order per field; `tint` a CSS colour over its own, `opacity` × its own, `outline` colours its box is drawn in (several: alternating dashes). **Dressing** (moving `content(id).root` nodes) is only a look; a content mesh whose `userData.receiveShadow` (a glTF node's extras) is `false` casts shadows and receives none |
| `ambient(name)`, `extent(box)` | **Ambients**: `instance.ambient()` offers `{ [name]: value \| null }`, stacked in running order, copied to frozen JSON; this is the outermost doc's, `null \| { value, mine, frame, use }` (I13). The viewport draws `atmosphere`, every field, default and range as CONVENTIONS.md, "Atmosphere" states; the depth range and the shadows fit `extent` too |
| `pick`, `raycast`, `project` | **Picking and camera**: `pick(x, y, { ground?, snapPx? })`, `raycast(origin, dir, { far?, skip(id)? })` → `{ id, point, normal, distance }`; `project(p)` → `{ x, y, visible }` (port px) |
| `camera` | `{ get, set, frame(box), hold, ride, touched, onEnd }`; `set({ position?, target?, quaternion?, fov?, near?, far? })`, `near`, `far` only while held. **Hold**: orbit off. **Riding**: `ride(id, { turn, rise, tilt, at })`, the top body's, else the latest base ride (I8). **Saving**: the viewer's, else `view.start.home` |
| `body`, `hold`, `popover(close)`, `context(hit?)`, `look()` | "Bodies", "Hands"; `context` is `{ scene, local, view, from, reach, hit, distance(target) }` |
| `collect(name)`, `run(inv)` | this stage's offers, tagged `stage`; run in the stage `inv.stage` names ("Commands") |
| `THREE`, `world({ onTop? })`, `labels()`, `owners()` | a `Group` whose meshes are its widgets (one under a `userData.noPick` node never is); `{ set([{ key, text, place?, screen?, on? (+ offset), at?, position?, rank?, className?, data?, onPointerDown? }]) }`, placed by the first of these given: `place({ project, w, h })` → `{ x, y, leader?: { x, y } }` (port px), `screen` (port px), an object's drawn frame, `at()` → a point, `position`; each asked every frame (`stage/labels.js`); rank 2 and up never give way; who draws in this stage, frozen, in running (layering) order: `{ layers: [{ ext, onTop, meshes }], labels: [{ ext, key, text, on }], display: { [id]: [{ ext, fields }] } }` |
| `overlay()`, `edge(side)`, `style`, `listen`, `invalidate`, `schedule`, `port`, `root` | DOM over or beside the canvas; draw once more; after the next update flush; the canvas's element, the stage's root |

## `instance`

| | Read by the kernel |
|---|---|
| `update(scene, local, prev, view)` | once per flush when doc, local, view or what's shown changed |
| `input`, `bodies`, `ambient()`, `commands` | "The input chain", "Bodies", "Ambients", "Commands" |
| `provides` | `{ [name]: (caller) → facet }`; `caller` `{ id, signal }`, from a stage to a view plugin also `runs(id)`, `doc()`, `path` |
| `receive(type, data, from)`, `beforeRemove(draft, ids)`, `dispose()`, `busy(id)` | its sends; before a removal; on stop; "Stopping" |

## Commands

| An instance's `commands` | the kernel runs them, surfaces show them (their other fields: EDITOR.md, "A command"), both by `commandState` (`stage/commands.js`) |
|---|---|
| `id`, `run(target, value?, ctx)` | `api.run({ stage?, ext, command, target, value?, hit? })` runs it, `ctx` being `api.context(hit)`, only where it applies and isn't disabled |
| `state(target, ctx)` | null: not for this target (no `state`: the scene only; a throw: null), else `{ disabled?, title?, … }` |
| `hand: kind`, `reach: true` | it applies only while a hand of that kind (a plugin's own; one naming the kernel's `tool` or `popover` never applies) is held (H14); beyond the body's reach it is disabled, "too far" (H9) |
| `tool: { keys?, pointer? }` | `run` returns an input, held on top for the command's `hand`, going with the last such hand; run again, it is put down (`value` true only picks up, false only puts down) |

## The input chain

Each event goes, until one consumes it (H12): (1) **the hands**, top first; (2) **the widget's owner**; (3) **the
holders, nearest first**: the hit object, what it hangs on, its groups, the scene (`ev.holder`: the extension's nearest
member with its trait; a segment per stage, innermost first; I8); (4) **the view plugins**; (5) **the top body**; (6)
**the default** (orbit, pan, zoom toward the pointer). Steps 2–4 are `stage/chain.js`; each extension is offered an
event once. An event is `{ type` (`press`, `click`, `menu`, `key`, `keyup`, `wheel`, `move`), `x, y` (port px),
`ray, hit, widget` (lazy), `holder, button, buttons, shift, alt, ctrl, meta, key, code, repeat, dx, dy, deltaY, locked
}`; a widget is `{ owner, onTop, distance, point }` and a mesh's `object` and `userData`
(nearer nodes' first), or what `widgetAt` gave. `input = { press(ev) → session | null, click, menu, key, keyup, wheel`
(→ boolean)`, widgetAt(ev), cursor(ev) }`; a session `{ move, end, tap?, cancel, key?, keyup?, keys?, cursor? }`, its
`cursor` a CSS cursor (not a function), its `keys` declared as a hand's. `menu` is a right-click or a 500 ms hold;
`move` starts past 4 px, a shorter release is a `tap`. **Widgets**: meshes in `world()` groups or `widgetAt`; `onTop`
beats any object. No double-click. **The look**: the pointer's hit, or the eye ray's under lock (`looksFromEye`).

**Keys**: one key order (`src/key-order.js`; H12): a focused field, the gesture's declared keys, the topmost hand's
declaring it, the top body's, then `input.key` over attention's path, innermost first (I10). Declared keys are `[{ code,
label }]`; a reserved key is its reserver's; a keyup, its keydown's.

### Bodies

`bodies: [{ id, label, keys, lock, reach, enter(place) → { input, eye?(), ride?, keys?, label?, leave() } | null }]`.
Look (`stage/bodies.js`, the orbit camera) is at the bottom; the first to offer an id has it. `api.body.enter(id,
place)` pushes what `enter` answers (`"look"` leaves every body); `leave()`, `current()`, `eye()`. The top
body hears every move and its keys; its eye and reach are every command's. A body's input is told `suspended()` when
another goes over it and `resumed()` when it is on top again.

**Hands**: one stack per view (`stage/router.js`), `{ kind, name, input, keys?, pointer?, escape?(), escaping?(), put?()
}`; each input consumes an event (true, a session) or passes it (false, null), acted or not, and hears every `move`;
`put()` is told as it leaves the stack, `escaping()` says what `escape()` would pop now (the hint). **Tools**: a
command's `tool`, or `api.hold({ name, keys?, pointer? }, input)`: onto the top (one held: put down), out from anywhere.
**A popover** (`api.popover(close)`) wants the pointer, takes all. **Escape** (`stage/ladder.js`; H4): the lock, a
field, the gesture, the top hand's `escape()` else putting it down; no hand: the selection, else the focus.

## Packages

`doc.packages` (`[{ url }]`, `automerge:` or public `https:`) lists where its contents come from (`src/packages.js`,
`stage/packages.js`): each running source's and trait's package is added; once quiet, those no running plugin comes
from are pruned. Nothing loads without a click on Load for its URL.

## Arriving

`view.start` is read on open and on `api.view.arrive()`; view plugins are told `view.arrived` (`{ start, n }`: the start
whole, frozen, and how many times this viewer arrived; keys beyond `body`, `place`, `home` are theirs, and an extension
reads its own doc's). `home` is the camera when none is saved; `body` is entered at `place` once offered and loaded (or
after `ARRIVE_WAIT_MS`), after anything `opening()`; a place holding an acting stage arrives in that stage alone, a
drawn one nowhere.

## Invariants

| | The kernel guarantees |
|---|---|
| H1 | What runs is the doc's: the host resyncs only on a registry or doc change. |
| H2 | One stop rule: stop only when the doc stops calling, after the linger or once not busy. |
| H4 | Escape pops exactly the top of lock, field, gesture, the hand stack's top (its escape first), else selection, then focus; never a body or the clock; every state ends in as many presses as layers. |
| H5 | locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused ∧ ¬touch, wanted ⇔ any hand, a selection or a wantPointer() asks; after a release or a finger, a press on the world only relocks. |
| H9 | A `reach` command that applies to a target is enabled iff its distance ≤ the body's reach; beyond it, it is disabled, "too far", and runs nowhere. |
| H10 | The selected path ends at an element of the focus stage. |
| H12 | An event goes to the hands top first, then the chain, then the top body, cut exactly at the first that consumes it; a tool picked up goes on top (one held: put down) and puts none down; a key is the gesture's, else the topmost hand's declaring it, else the top body's. |
| H14 | A command naming a kind of hand applies (`run`, every surface) only while a hand of that kind is held; a tool held through it is held only while one is. |
| I1 | Every api read and write goes to its stage's handle. |
| I2 | No reference crosses docs; a link (an object whose source is a scene doc) is the only edge between docs. |
| I4 | A stage's snapshot, running set and display depend only on its doc and the registry; only space and `ambient`'s `mine`, `frame`, `use` depend on placement. |
| I5 | An object's holds and sends travel on its doc's channel. |
| I6 | A read-only stage writes nothing, through its api or its repo. |
| I7 | Points map by the frame's similarity, directions by its rotation, distances by its scale; boxes are the stage's own. |
| I8 | Inner segments first, out to the outermost; each (stage, extension) once; nothing from a pin; the ride is the current body's, else the latest base ride. |
| I10 | Each stage sees its own element of selection and hover or null; keys visit attention's path innermost first. |
| I11 | Runtime state has at most one writable holder among reachable docs. |
| I12 | Every acting stage draws its doc's people in its frame; a pin draws nobody; nobody draws this view. |
| I13 | Every `api.ambient(name)` is the outermost's stacked value, one frozen object, `mine` only at the outermost; non-plain offers are refused. |
