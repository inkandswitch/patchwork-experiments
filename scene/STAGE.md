# The kernel: the contract

What the scene's kernel (`src/stage/`: the **stage** and the **view**) promises every plugin, and what it asks. Plain
data and functions; no plugin imports another, and the kernel knows none by name. The rest is plugins':
[NATIVE.md](NATIVE.md), [EDITOR.md](EDITOR.md), [CONVENTIONS.md](CONVENTIONS.md). What a plugin is handed, the apis and
what the kernel reads of an instance, is [API.md](API.md).

## Words

| Word | Means |
|---|---|
| **Doc** | An Automerge scene doc: `objects: { [id]: { name, sourceUrl, providerId, parent?, group?, transform, traits?, … } }`, the scene's `traits`, and plugins' own keys. |
| **Stage** | One doc open in a view: its doc, content, channel, frame, extensions and their apis. It **acts**, or is only **drawn**; a **pin** is drawn at fixed heads. |
| **View** | One per mounted tool: DOM, viewport, input, the **body** and **hand** stacks, selection, hover and **focus** (paths; the focus is the acting stage entered), one presence session, the stage tree, its view plugins. |
| **Extension** | A doc plugin (`scene:extension`): one instance per stage whose doc calls for it. |
| **View plugin** | A `scene:view`: one instance per view, for its whole life; works on the focus stage through `api.focus()`. |
| **Contribution** | A named field of an instance, read with `collect(name)`; the kernel reads only those under "`instance`" (API.md). |
| **Event** | A value the view makes of DOM input on the canvas ("The input chain"). |
| **Service** | What an instance `provides` by name, for others to `use`. |
| **Layer** | Of the scene package's modules, lowest first: shared (formats, math), the kernel (`src/stage/`, `src/content/` and what they are built from), native (`src/native/`, `src/sources/`), the editor (`src/parts/`), entry. Imports go only down; above the kernel, only to its api and its face, `stage/public.js` (pure helpers, re-exported). The table and its check: `src/native/boundary.test.js`. |

## Views, stages and links

A view shows a tree of stages: the outermost doc's, and each one a view plugin opens under an object of another, as its
content, in its frame.

| | |
|---|---|
| **Opening** | `api.open(handle, { under: [stagePath, id], acting?, heads?, deps? })` → close, or null: a doc acts at one stage per view, only under one that acts (NATIVE.md, I3). `acting: false` is drawn; `heads` a pin (its repo finding docs at `deps`' heads). Closing one closes what is under it and takes the focus out. A `content: "scene"` source is drawn as its hint until a stage is open under it. |
| **Its doc** | An api touches only its stage's doc: `null` is its root, every id its own (I1, I2). |
| **Embedded documents** | A document the stage shows inside it, marked `data-stage-embed` (`embed.js`), keeps its own keys, pastes and drops. A render's build controls ask the stage with DOM events bubbling to its root: `scene:rebuild` (`detail: { renderUrl }`; the stage rebuilds it and cancels the event) and `scene:render-context` (the stage sets `detail.state`, the object's content state, and `detail.at`, its fixed version); it tells every `.scene-render-controls` element `scene:render-context-changed` when either changes. |
| **Drawn** | Extensions run and draw, nothing more: no segment, body, tool, command, widget, chrome, camera, selection or view service (`drawnApi`). |
| **Read-only** | A stage that doesn't act, or whose handle refuses, gets a doc and repo refusing every write (`stage/readonly.js`; I6). |
| **The focus** | Goes in with a view plugin's `view.enter(path)`, out on Escape's last rung; it scopes the selection (H10), changes only through `selectionStep` (`src/selection.js`), and no stage sees it. |
| **Frames** (I7) | Everything spatial in an api is in its stage's root frame, a similarity (`stage/scope.js`); a hit not of this doc is `{ id: null, point, normal, distance }`. World = parent's world · local; groups give scope, not motion. |
| **Presence where it is** (I12) | A doc's people are drawn where it acts, from its channel. |
| **The outermost doc** | Gives the view its ambients, `view.start` and the camera's home. |

## Three places for state

| | Shared | Lasts | Read | Write |
|---|---|---|---|---|
| **Doc** | yes | yes | `doc()`, `scene()`; ignore missing ids | `change(fn)`, field by field |
| **Channel** | yes | no | `channel.peers()`, `.watch` | `channel.set`, `.send` |
| **Local** | no | no | `local.get()`, `view.get()` | `local.swap`, `view.select` |

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

## Commands

| An instance's `commands` | the kernel runs them, surfaces show them (their other fields: EDITOR.md, "A command"), both by `commandState` (`stage/commands.js`); every surface's one walk is `applicable(collected, target, ctx, keep?)`: those that apply, each with its state and the stage it runs in |
|---|---|
| `id`, `run(target, value?, ctx)` | `api.run({ stage?, ext, command, target, value?, hit? })` runs it, `ctx` being its stage's reader's `context(hit)`, only where it applies and isn't disabled |
| `state(target, ctx)` | null: not for this target (no `state`: the scene only; a throw: null), else `{ disabled?, title?, … }` |
| `hand: kind`, `reach: true` | it applies only while a hand of that kind (a plugin's own; one naming the kernel's `tool` or `popover` never applies) is held (H14); beyond the body's reach it is disabled, "too far" (H9) |
| `tool: { keys?, pointer? }` | `run` returns an input, held on top for the command's `hand`, going with the last such hand; run again, it is put down (`value` true only picks up, false only puts down) |

## The input chain

Each event goes, until one consumes it (H12): (1) **the hands**, top first; (2) **the widget's owner**; (3) **the
holders, nearest first**: the hit object, what it hangs on, its groups, the scene (`ev.holder`: the extension's nearest
member with its trait; a segment per stage, innermost first; I8); (4) **the view plugins**; (5) **the top body**; (6)
**the default** (orbit, pan, zoom toward the pointer). Steps 2–4 are `stage/chain.js`; each extension is offered an
event once. An event is `{ type` (`press`, `click`, `menu`, `key`, `keyup`, `wheel`, `move`), `x, y` (port px), `ray,
hit, widget` (lazy), `holder, button, buttons, shift, alt, ctrl, meta, key, code, repeat, dx, dy, deltaY, locked }`; a
hit is `{ id, point, normal, distance }` (a view plugin's hand's also `path`), a widget `{ owner, onTop, distance, point
}` and a mesh's `object` and `userData` (nearer nodes' first), or what `widgetAt` gave. `input = { press(ev) → session
| null, click, menu, key, keyup, wheel` (→ boolean)`, widgetAt(ev), cursor(ev) }`; a session `{ move, end, tap?,
cancel, key?, keyup?, keys?, cursor? }`, its `cursor` a CSS cursor, its `keys` declared as a hand's. `menu` is a
right-click or a 500 ms hold; `move` starts past 4 px, a shorter release is a `tap`. **Widgets**: meshes in `world()`
groups or `widgetAt`; `onTop` beats any object. No double-click. **The look**: the pointer's hit, or the eye ray's under
lock (`looksFromEye`).

**Keys**: one key order (`src/key-order.js`; H12): a focused field, the gesture's declared keys, the topmost hand's
declaring it, the top body's, then `input.key` over attention's path, innermost first (I10). A key with ctrl or meta
held (a modifier itself aside) is no reserver's: it goes to `input.key`. Declared keys are `[{ code,
label }]`; a reserved key is its reserver's; a keyup, its keydown's.

### Bodies

`bodies: [{ id, label, keys, lock, reach, enter(place) → { input, eye?(), ride?, keys?, label?, leave() } | null }]`.
Look (`stage/bodies.js`, the orbit camera) is at the bottom; the first to offer an id has it. `api.body.enter(id,
place)` pushes what `enter` answers (`"look"` leaves every body); `leave()`, `eye()` (the top body is
`view.get().body`). The top body hears every move and its keys; its eye and reach are every command's. A body's input is
told `suspended()` when another goes over it and `resumed()` when it is on top again.

**Hands**: one stack per view (`stage/router.js`): a view plugin's `hand({ kind, name, input, keys?, pointer?,
escape?(), escaping?(), put?() })` → release, onto the top, putting none down; each input consumes an event (true, a
session) or passes it (false, null), acted or not, and hears every `move`; `put()` is told as it leaves the stack,
`escaping()` says what `escape()` would pop (the hint). **A tool** (kind `"tool"`: a command's `tool`, or an extension's
`hold({ name, keys?, pointer? }, input)`) is in `view.held`, its extension kept while it is held, its input told `put()`
as it goes down. **A popover** (an extension's or view plugin's `popover(close)`) wants the pointer, takes every event,
isn't announced, and Escape closes it. **Escape** (`stage/ladder.js`; H4): the lock, a field, the gesture, the top
hand's `escape()` else putting it down; no hand: the selection, else the focus.

## Packages

`doc.packages` (`[{ url }]`, `automerge:` or public `https:`) lists where its contents come from (`src/packages.js`,
`stage/packages.js`): each running source's and trait's package is added; once quiet, those no running plugin comes from
are pruned. Nothing loads without a click on Load for its URL.

## Arriving

`view.start` is read on open and on a view plugin's `view.arrive()`; view plugins are told `view.arrived` (`{ start, n
}`: the start whole, frozen, and how many times this viewer arrived; keys beyond `body`, `place`, `home` are theirs, and
an extension reads its own doc's). `home` is the camera when none is saved; `body` is entered at `place` once offered
and loaded (or after `ARRIVE_WAIT_MS`), after anything `opening()`; a place holding an acting stage arrives in that
stage alone, a drawn one nowhere.

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
