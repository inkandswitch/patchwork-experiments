# The kernel's api

What the kernel hands a plugin and what it reads of one: the second page of its contract; the words, the input chain,
bodies, hands, commands and invariants cited here are [STAGE.md](STAGE.md)'s.

## View plugins

One per view, for its whole life (`stage/host.js`). Its `input` is the chain's step 4; its `beforeRemove`, `commands`
and contributions come after the focus stage's extensions', in that stage's frame and context; `update` on its flush.
What is a stage's (its doc, content, space, camera, bodies, presence, flush) it reaches through `focus()`.

| Member | |
|---|---|
| `id`, `signal`, `repo`, `registry`, `THREE` | as `api`'s |
| `port`, `root`, `overlay`, `style`, `listen`, `popover` | as `api`'s, for its whole life |
| `now`, `after`, `loop`, `afterRender`, `invalidate` | as `api`'s, for its whole life |
| `url` | the outermost doc's |
| `focus()` | the focus stage's `api`, made for it; what it acquires there goes as the focus leaves |
| `path(o?)` | the input path's stages as readers, innermost first; `{ pointer: true }`, `{ focus: true }`, `{ at: path }` |
| a reader | `{ stage, path, scene(), runs(ext), collect(name), context(hit), attention(), look(), pointed(), nameOf(id), writable(), use(name) }` |
| | `context(hit)`: what its commands are asked in, `{ scene, local, view, from, reach, hit, distance(target) }` |
| `collect(name)`, `run(inv)` | every acting stage's offers, the input path's first, tagged `stage`; run in `inv.stage`, else the focus |
| `use(name)` | a view plugin's service, else the focus stage's |
| `view` | `get()`, `watch(fn, select?)`; `step(ev)` (`src/selection.js`), `enter(path)`, `arrive()`; `set(value)`: its own, `view[id]` |
| `hand(spec)`, `putDown(which?)` | STAGE.md, "Hands"; events in the world, each hit with its `path`; `putDown` one of `view.held`, else the topmost |
| `offerWidget(type, ev)` | offers `ev` to its widget's owner, as step 2 does, when the widget is nearer than the hit: did it take it? |
| `wantPointer()` → release | the pointer free (no lock) until released (H5) |
| `open(handle, o)`, `opening()` | STAGE.md, "Views, stages and links"; `close.reached`: the docs its repo found; arriving waits on `opening` |
| `packages` | `{ load(urls?), dismiss(urls?) }`: the answer to the prompt for every open doc's (`view.packages`) |
| `trace` | `draws()`: the focus stage's `{ layers, labels, display }`; `routes()`: the last 50 events'; `tap(fn)` → off |

Its `view.get()` is an extension's (below) with `selected`, `hovered`, `focus` as paths, and `packages`, `arrived` (`{
start, n }`: STAGE.md, "Arriving"). `draws()` is `{ layers: [{ ext, onTop, meshes }], labels: [{ ext, key, text, on }],
display: { [id]: [{ ext, fields }] } }`, in running order; a route `{ type, at, path, steps: [{ step, stage?, ext,
holder? }], took }`; a tapped message, every one a channel sends or hears, `{ stage, url, dir, kind, session, viewer,
ext?, type?, data?, keys?, to? | dropped? }`, made only while tapped.

## `api`

Each extension's own; what it acquires through it goes when it stops. Everything spatial is in its stage's frame (I7).

| Member | |
|---|---|
| `id`, `signal`, `url` | its id; aborts as it stops; its doc's URL |
| `repo` | `{ find(url), create(doc), create2(doc), peerId }`; what it finds is noted (a link's fix holds it); read-only: I6 |
| `registry(type)` | that type's plugin registry, at once: `get(id)`, `has(id)`, `all()`, `filter(fn)`, `load(id)` → Promise, `on` |
| `doc()`, `scene()` | the doc; `{ d, objects, ids, parents, groups, members, traits, world(id), toLocal(id, p) }`, `d` the doc |
| `change(fn)`, `writable()` | → its patches (`[]`: none), message `{"ext":id}` (`lastWriter`: `stage/provenance.js`); may it write |
| `newId(prefix)`, `remove(ids)` | a fresh id; removes, running every `beforeRemove` first |
| `ops` | `src/ops.js`: planners (`setTransform`, `setField`, `removeObjects`, `attachTo`, `fileIn`, `newGroup`, `ungroup`, |
| | `moveRow`, `setLayerShown`, `clearLayers`, `setTransformPart`) → a change function, or null with a reason |
| `local` | `get()`, `swap(fn)`: the stage's frozen value (below); plugins' keys `<id>.`-prefixed |
| `view` | `get()`: the viewer's, as this stage sees it (below); `select(target)` |
| `channel` | `{ viewer, session, peers(), set(key, value), watch(fn), send(type, data), rate(hz) }` (I5; below) |
| `page.on(type, fn)` | `"hide"`: the page goes into the back-forward cache, or the stage closes; `"show"`: it is back |
| `use(name)` | the stage's first provider's facet, else (acting) a view plugin's, or null |
| `settled()` | `{ ready, missing, failed, errors }`: `ready`, nothing the doc calls for still on its way; `errors[id]`: why |
| `packages` | the prompt's answer for its doc: `{ load(urls?), dismiss(urls?) }` |
| `content(id)` | what it shows and how it got there, or null: `loaded`, `box` (its frame's), `extras`, `stats`, `root` (drawn); |
| | `route` (`"built"`, `"file"`, `"scene"`, null), `state` (README.md, "An object's state"), `render` (built: `providerId`, |
| | `providerName`, `pinned`, `builtAt`, `builtHeads`, `bounds`, `at`, `notes`), `fix` (the `at` fixing it as it is, or null) |
| `box(target, o?)` | `{ min, max }` or null: an object's, a group's (its members'), the scene's (`null`); `{ hints?, in? }` |
| `worldOf(id)`, `nameOf(id)` | its drawn matrix; its displayed name |
| `providersFor` | the sources that take a doc |
| `addObject(url, o)` | → a change function with its new object's `id` |
| `display(id, o)` → release | **Display** (below) |
| `pick(x, y, o?)`, `raycast(origin, dir, o?)` | → `{ id, point, normal, distance }` or null; `{ ground?, snapPx? }`; `{ far?, skip(id)? }` |
| `project(p)`, `look()` | → `{ x, y, visible }` (port px); the pointer's hit, the eye ray's under lock |
| `camera` | `get()` → `{ position, target, fov, up }`; `set(cam)`; `frame(box)`; `hold()` → release; `touched()`; `onEnd(fn)` |
| | `set({ position?, target?, quaternion?, fov?, near?, far? })`; `near`, `far` hold only while it is held |
| | `ride(id, { at?, turn?, rise?, tilt? })` → off: a base ride, the latest applying while the top body has none (I8) |
| `body` | `enter(id, place)`, `leave()`, `eye()` → `{ position, direction }`: STAGE.md, "Bodies" |
| `hold(tool, input)` → put, `popover(close)` → release | STAGE.md, "Hands": a tool held directly; an open menu or dialog |
| `THREE`, `world({ onTop? })` | a `Group` whose meshes are its widgets; one under `userData.noPick` is never a widget |
| `labels()` | `{ set(items) }`: each `{ key, text, rank?, className?, data?, onPointerDown? }` and, first given, |
| | `place({ project, w, h })` → `{ x, y, leader? }`, `screen` (port px), `on` (+ `offset`), `at()`, `position` |
| `extent(box)` | the depth range and the shadows fit it too (what its world groups draw beyond any object) |
| `ambient(name)` | **Ambients** (below) |
| `port`, `root`, `overlay(side?)` | the canvas's element, the stage's root; a `div` over the canvas, or beside it (`top`…`left`) |
| `style(css)`, `listen(target, type, fn, o?)` | a stylesheet in the view; a listener |
| `now()`, `after(ms, fn)`, `loop(fn(dt, now), { first? })` | the stage's one time (`stage/time.js`), → cancel; a loop renders every frame, `dt` ≤ 0.1 s |
| `afterRender(fn)`, `schedule(fn)`, `invalidate()` | after each frame drawn; after the next update flush; draw once more |
| `collect(name)`, `run(inv)` | this stage's offers, tagged `stage`; run in the stage `inv.stage` names (STAGE.md, "Commands") |

**The values.** `view.get()`: `selected`, `hovered` (its element or null; I10), `body` `{ id, label, ext, depth, lock,
reach, keys, serial }`, `hands` `[{ ext, kind, name, keys, pointer, serial }]` (top last), `held` (its tools: `[{ ext,
command, name, handKind, keys, pointer, serial }]`), `gesture` `{ owner, keys, serial }`, `pointer` `{ locked, lock,
wanted, released, refused, touch }`, `escape` `{ layer, hint }`, `theme` (the stage's colours, `{ bg, fg, accent,
remote, muted, object }` in sRGB 0..1, another object each time the CSS changes), view plugins' values. `local.get()`:
`running` `[{ id, scope }]`, `status` `{ [id]: { state, reason?, text, title } }`, `packages` `{ ask, loading, failed,
missing }`. `channel.peers()`: `{ [session]: { viewer, body, held: [{ name }], at, keys } }`; `session` null in a pin. A
content mesh whose `userData.receiveShadow` (a glTF node's extras) is `false` casts shadows and receives none.

**Display** `{ transform?, content?, hidden?, name?, tint?, opacity?, outline? }` shows an object otherwise to this
viewer, unwritten (`worldOf`, boxes, picks, labels follow), layered in running order per field: `tint` a CSS colour over
its own, `opacity` × its own, `outline` the colours its box is drawn in (several: alternating dashes). **Dressing**
(moving `content(id).root` nodes) is only a look. **Ambients**: `instance.ambient()` offers `{ [name]: value | null }`,
stacked in running order, copied to frozen JSON; `ambient(name)` is the outermost doc's, `null | { value, mine, frame,
use }` (I13); the viewport draws `atmosphere` as CONVENTIONS.md, "Atmosphere" states. **The camera** is saved per
viewer, else `view.start.home`; held, the orbit is off. **Time** is never `Date.now`, `setTimeout` or
`requestAnimationFrame` (`manualTime()` moves when stepped).

## `instance`

| | Read by the kernel |
|---|---|
| `update(scene, local, prev, view)` | once per flush when the doc, local, view or what's shown changed |
| `input` | STAGE.md, "The input chain" |
| `bodies`, `commands`, `ambient()` | STAGE.md, "Bodies", "Commands"; **Ambients** (above) |
| `provides` | `{ [name]: (caller) → facet }`; `caller` `{ id, signal }`, a view plugin's also `runs(id)`, `doc()`, `path` |
| `receive(type, data, from)` | what a peer's `channel.send` sent |
| `beforeRemove(draft, ids)` | inside `remove`'s write, before the objects go |
| `busy(id)` | a service is working for extension `id` (a pose held): STAGE.md, "Stopping" |
| `dispose()` | as it stops |

