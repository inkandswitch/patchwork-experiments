# scene

A 3D scene for Patchwork that composes content from many datatypes. Each
datatype's package registers a `scene:source` provider that shows it,
usually by building a GLB. The tool is a **stage** with no UI of its own:
everything you see or do comes from **extensions**, chosen by the doc's
traits alone. The editor below is the set this package ships; other packages
add games, ships and walking. Editing and playing share one running world.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `scene` | the composition |
| `patchwork:datatype` | `scene-render` | one per built object (unlisted) |
| `patchwork:tool` | `scene` | the stage (`src/stage/stage.js`) |
| `patchwork:tool` | `scene-render-controls` | the build-param form for a render doc; alone (no scene around it) it builds when asked, from the source's latest version (a scene object's fixed version lives in the scene, which it doesn't know), on `element.time` if given (a stage time), else the page's |
| `scene:source` | `file-glb` | `.glb` file docs, `content: "file"` |
| `scene:source` | `file-stl` | `.stl` file docs, `content: "built"` (params `unit`, `up`) |
| `scene:source` | `scene.link` | a scene doc placed in a scene, `content: "scene"` |
| `scene:view` | `scene.*` | the editor and the surfaces every scene has, one module each in `src/parts/` |
| `scene:extension` | `scene.carry`, `scene.others` | carrying (by trait), others' selections (every doc) |

`src/index.js` lists them in the order input reaches them. The view plugins
run once per view, whatever the focus, and work on the focus doc.

## Using it

- **Make a scene.** An empty scene lists the installed templates and Blank.
  A new scene starts you holding the editor; a doc's `view.start` puts you
  somewhere else once, on arrival (a seat, a spawn point, Look, editing or not).
- **Add things.** Drop docs from the sidebar or `.stl`/`.glb` files from the
  desktop, paste an automerge URL, or use the parts bin (toolbar, Parts).
- **Bodies.** The body chip (bottom right) picks Look or a body a package
  offers (walk, a seat, a ship's station). Leave goes back to Look.
- **Edit.** The editor is a hand: **Edit**, beside the body chip, picks it up
  or puts it down, in any body (you can walk while editing). Holding it,
  click to select; Escape deselects, then leaves an entered link, then puts
  it down. **Move** (`V`) is a tool: while it's held, the selection has
  the **halo**: move arrows, rotate rings, scale corners and a provider's
  param knobs. The
  **inspector** drawer tab holds the object tree, the selection's fields and
  behaviours, and its documents (Source, Build, About), each dockable. The
  toolbar opens Dimensions and Parts; `M` measures.
- **Groups and attachment** are two things. A group organises and hides or
  fades what's in it; it has no transform. An attached object moves with its
  parent. Re-filing or re-attaching keeps everything where it is on screen.
- **Carry.** Anyone in any body can pick up what has the `scene.carry` trait.
  It lands on the highest surface under it and snaps to a connector that
  takes it (Alt places freely). Q/E turn it, F flips it, Escape puts it back.
  A **locked** object can't be carried or moved.
- **Verbs.** The use prompt shows attention's keyed verbs ("[F] Take the
  helm"); the right-click menu shows them all, Select first. Under touch,
  the keys in play become on-screen controls.
- **Undo** (⌘Z, ⇧⌘Z) takes back your own edits, never a verb's.
- **Copy and paste** (⌘C/⌘V, or a tree row dragged into another scene)
  copies an object with what's attached under it. The copy shares GLB files,
  gets its own render docs, and leaves runtime state behind.
- **Links.** A scene doc dropped on a scene is a link: its own world, drawn
  in the link's frame. **Enter** it (menu, inspector, its tree row) to edit
  inside it in place; Leave or Escape comes back out. **Extract** makes a
  selection its own linked doc; **Bundle** copies a linked doc back in.
- **Fixed versions.** A URL with heads, or *Fix at this version*, holds an
  object at one version (a fixed link is a pin); *Follow latest* lets go.
- **The clock.** A doc with processes gets a chip to pause its world time.
- **Yours alone:** the camera, grid, axes, bounds, units and panel (`P`);
  the doc's `view` gives defaults. Selection, hover and carries are shared
  live, never written. Only shown objects load.

## Extensions

A `scene:extension` adds behaviour or UI without the scene knowing what it
means; a `scene:template` lays out an empty scene; a `scene:part` is in the
parts bin. Extensions never import one another. [STAGE.md](STAGE.md) and
[API.md](API.md) are the contract.

## Content

### Writing a provider

A provider lives in the package that owns the datatype, as metadata in its
`plugins` array (every field but `load` must survive `structuredClone`):

```js
{ type: "scene:source", id: "camber-hull-surface", name: "Camber hull", icon: "Sailboat",
  supportedDatatypes: ["camber-hull"],  // ["file"] plus `extensions: ["stl"]` for file docs
  content: "built",                     // REQUIRED: "built" or "file"; neither is never used
  params: [ParamSpec], handles: [{ param, axis: [x, y, z], label? }],  // optional
  cost: "expensive", version: 1,        // bump version when build() output changes
  async load() { return (await import("./scene-source.js")).default } }

ParamSpec = { key, label?, kind: "number"|"integer"|"boolean"|"enum"|"string"|"color", default,
              min?, max?, step?, log?, options?: [{ value, label }], cost?: "cheap"|"expensive" }
SourceImpl = {
  build({ doc, handle, url, params, repo, signal }): Promise<{ kind: "glb", glb: Uint8Array,
        meta?: { bounds?: { min, max }, notes?: string } }>,   // must not write the source
  fingerprint?(doc): string,              // changes iff something build() reads changes
  dependencies?(doc): AutomergeUrl[],     // other docs build() reads; rebuilt when they change
  fingerprintDependency?(url, doc): string | null }
```

- `"built"`: `build()` makes a GLB, kept in the object's own `scene-render`
  doc and rebuilt when the source, params, dependencies or `version` change.
  `params` arrive with defaults filled in and clamped to their spec.
- **Where `build()` runs.** On the page's main thread, called by the render
  manager (`src/content/render-manager.js`) of the open scene the lock
  chooses ("Who builds"), or of a render's build controls opened alone,
  which build only when asked. Builds of one render doc don't overlap while
  the lock's timing assumption holds (C1); builds of different objects run
  side by side; a provider that needs a thread starts its own worker. It is given exactly `{ doc, handle, url, params, repo,
  signal }`: the source doc and its handle (a read-only view at `at.heads`
  for a fixed object, `url` then carrying `#heads`), the params as above,
  the repo to read dependencies from, and an `AbortSignal` that aborts when
  its result is no longer wanted: newer inputs are about to be built, the
  object was removed, or the scene closed. It must not write the source,
  nor assume a stage, a DOM or a scene: other packages call it too, outside
  any scene, to get a doc's geometry with its params' defaults (naval's,
  flow-field's and openfoam's hull links; they may pass no `signal`). A
  build cancelled, by its signal or by rejecting with an error named
  `"AbortError"`, is not a failure: nothing is written and the render is
  looked at again. Any other rejection is the render's `failure`, retried
  with backoff by the peer holding it.
- `"file"`: the source doc already is a GLB file. No render doc, no `load()`.
  `file-glb` is this package's: a package adding a GLB file doc to a scene
  writes `providerId: "file-glb"`.
- A render doc (`newRenderDoc` in `src/datatype.js`) holds `{ "@patchwork":
  { type: "scene-render" }, title, parent, providerId, params, pinned,
  result, failure }`. `result` is the last build written, one value written
  whole, so a merge of two keeps one writer's: `{ glbUrl, builtFrom: { heads,
  fingerprint, paramsKey, deps, glbHash, providerVersion? }, bounds, builtAt }`,
  or null. `failure` is the last failed build, `{ error, inputs }` with the
  inputs it was of (`inputsKey` in `src/content/staleness.js`), or null; a
  result written clears it. Bytes other than the current GLB's make another
  immutable GLB file doc; a result arriving between making it and the write
  leaves it orphaned, referenced by nothing. Nothing is written as a build
  starts.

### An object's state

One value says whether what is drawn for an object is built and current:
`contentState` (`src/content/state.js`), a pure function of what is known
(the object, its render doc, the heads of its source and dependencies, the
provider and its version, the params, who is building, failures). Its
states are a closed set: `loading` (`version`: a fixed version not synced
yet), `no-provider`, `building` (`by`), `failed` (`in: "build"` with
`retrying`, or `"load"`), `waiting` (`on`: linked documents loading),
`stale` (`reason`; `hold`: `"pinned"`, `"contested"`, `"unavailable"` or
null, the one it will rebuild on its own) and `fresh` (`behind`: built
from changes this replica hasn't synced). `api.content(id).state` is it;
`local.status` says it to people; the render manager builds on it; the
build controls show it (a stage answers their `scene:render-context`).

### Who builds

Every writable open scene with a stale render could build it; the lock
(`src/content/lock.js`) chooses one, with **one claim per render doc**. A
peer that wants it built claims it on the render doc's channel, waits
`CLAIM_MS` for a rival, and then holds it: it builds, rebuilds as the inputs
move (cancelling the build in flight through its `signal`), retries a
failure, says it still holds it every `HEARTBEAT_MS`, and lets it go once it
has wanted nothing for `HEARTBEAT_MS`. Nobody claims while another's claim
is live. Of two claims at once the lower id holds; a holder beats a claimer;
of two holders (after a lost message) the higher id lets go once it isn't
building. Whoever beats a claim answers it at once (a holder says it holds,
a lower-id claimer claims again), so a peer that opens the render late hears
them within its window. The scene that made a render builds it the first
time without claiming: nobody else knows of it. A peer not holding the
render that reads a failure of exactly its own inputs leaves those inputs
alone until they change or someone asks; a failure of other inputs (another
provider version's) is nothing to it. A peer's "building" is a builder it
hears, or its own build, the wait on the fence included.

**The write fence.** A result is written by compare-and-set, only over the
result the render had as its build began, and only if its writer has heard
no other peer hold or build the render since. A holder silent past
`LEASE_MS` (a frozen tab, a blocked thread, a background tab's slowed
timers) says nothing until it has listened `RECHECK_MS`. If it heard
anyone, it drops a build still running and lets the render go; a build that
has finished it announces (`build`), listens `RECHECK_MS` more, and writes
by compare-and-set alone before letting go, unless a lower id said it holds
or builds meanwhile. (Without the fence's second condition a woken holder's
older build and its successor's newer one can be written concurrently, and
the merge may keep the older: the model finds it.)

**Timing.** One assumption, `REACH_MS` (D = 250 ms): every message and change
reaches every peer within it. With the heartbeat H = 2 s: `CLAIM_MS` = 4D
(needs > 2D: a claim and its answer, an exact tie included); `LAPSE_MS` = 3H
(needs > 2H + D: one heartbeat may be lost); `LEASE_MS` = `LAPSE_MS` − H − D;
`RECHECK_MS` = 2D (needs > D and < `CLAIM_MS` − D). The derivation is in
`lock.js`.

**What a person waits for**, the debounce being `DEBOUNCE` (150 ms for a
cheap change, 800 ms otherwise, `staleness.js`):

- an edit while this scene still holds the render (within H of its last
  build): the build starts after the debounce;
- an edit once the render has been idle: debounce + `CLAIM_MS`, 1.15 or 1.8 s;
  a render never built, 1 s; one this scene just made, at once;
- a render another live peer holds: that peer builds it; nobody else starts;
- its holder vanished: another starts within `REACH_MS` + `LAPSE_MS` +
  `CLAIM_MS` = 7.25 s of the holder's last word (C2);
- "Rebuild now": at once if this scene holds the render (after the build in
  flight); `CLAIM_MS` = 1 s if nobody does; if another peer does, H + D +
  `CLAIM_MS` = 3.25 s after that peer's last build, when it has let go.

| | Among the peers with the render open |
|---|---|
| C1 | (needs the assumption) At most one peer builds it at a time, a frozen peer aside. |
| C2 | (needs it) A builder that vanishes is replaced within `REACH_MS` + `LAPSE_MS` + `CLAIM_MS` of its last word. |
| C3 | (always) A peer that can't write never builds nor writes; a build is shown in progress only while one is, until its release arrives, or `LAPSE_MS` after its holder's last word. |
| C4 | (always) A write replaces only the result its writer had as its build began, so never a newer one it had received; a merge keeps one writer's result whole. (Needs the assumption) No two results are written concurrently, and no older build replaces a newer one at any replica, a peer that froze mid-build included. |
| C5 | (always, while one writer stays) Once nothing moves, every replica holds the same render doc, built from the current inputs (or failed for them, or pinned), and nobody holds it, lost messages, slowed timers and builds that block their page past `LAPSE_MS` included; failing inputs are tried at most 1 + `RETRY_BACKOFF_MS.length` times in all (with the assumption). |

`src/content/lock.test.js` checks them on a finite model: two or three real
managers, each with its own replica of the docs, merging as Automerge does
(each key the write with the greater op id, actor ties broken both ways),
and its own view of one manual clock, over a network delivering each message
and change at once or at exactly `REACH_MS`. Every run is enumerated over
who edits, when, builds short or past `LAPSE_MS`, failing, a builder
freezing past `LAPSE_MS` (or only into another's claim) and waking to write,
a builder whose timers fire on whole minutes, builds that block their
page for 10 s, a forced rebuild, a peer
joining mid-build or between heartbeats, provider versions one of which
fails, lost messages, and writers that can't hear each other.
`src/content/result-merge.test.js` merges two results on real Automerge
docs.

### Consuming a render

To use another object's geometry, read its render doc, never its source or
another package's provider. Copy `src/render-read.js`: `readRender(repo,
url)` gives `{ glb, glbUrl, builtFrom, builtAt, bounds, failure, source }`. List
the render's URL in `dependencies(doc)`; you rebuild only on a new GLB. An
unbuilt render gives `glb: null`: say so in `meta.notes`.

### `scene` — the composition

```ts
{ title, objects: { [id]: Object | Group }, order: string[],
  dimensions: { [id]: { a: Anchor, b: Anchor, label } },
  view: { units, grid, axes, bounds, snap?, start?: { body?, place?, home? } },
  traits, assets: { [key]: { url, hint? } }, packages: { url }[], clock: { running, t } }
Object = { kind?: "object", name, sourceUrl, providerId, renderUrl /* null: not built */,
  visible, color, opacity, wireframe, transform: { position, rotation /* Euler XYZ rad */, scale },
  parent?, group?, infoUrl?, infoToolId?, locked?, tags?, layers?, traits?,
  hint?: { bounds?, triangles?, bytes? }, at?: { heads, deps? } | null }
Group = { kind: "group", name, group?, visible, opacity, infoUrl?, infoToolId?, traits? }
Anchor = { objectId, local, world }  // a point in its object's frame: follows its transform
```

- `transform` is relative to `parent` (`src/hierarchy.js`). Loops from
  concurrent edits break the same way on every peer.
- `renderUrl` is written once; null for `"file"` content and links.
  `hint.bounds` is drawn until content loads.
- `packages` lists where the contents come from, kept true by the stage.
  Only this shape is read.

### Content is routed at sync

`routeOf` in `src/content/providers.js`: an object with a render doc goes to the
render manager, which shows what was built even without its provider. One
without goes where its provider's `content` says (`"file"`: the GLB queue;
`"scene"`: a link). Anything else is drawn as its `hint`.
`api.content(id).route` says which. Only what is shown loads, biggest
first, the viewer's selection first of all. All of it is `src/content/`, the
stage's one door to it `createContent` (`src/content/content.js`).

### Fixed versions (`at`)

With `at`, an object builds from its source at `at.heads`, and each
dependency in `at.deps` at its heads. Source edits never make it stale.
*Fix at this version* copies `at` from the render's `builtFrom`, so nothing
rebuilds. A file object is never fixed. `pinned` on a render doc only stops
automatic rebuilds. Render docs aren't branch-aware.

## Conventions

Traits are keyed `<extension>.<name>`. Names shared between packages are in
CONVENTIONS.md.

### GLB conventions

- glTF 2.0, **Y-up, metres**, right-handed. Convert inside the provider.
  `asset.extras.units` says so (`"m"`; `src/glb.js` writes it). The stage
  draws every GLB as metres; a package reading a GLB from outside a scene
  (a hull file) honours `"m"`, `"cm"`, `"mm"`, `"in"` or `"ft"` there.
- Name nodes and meshes. Triangles for surfaces, lines for edges. Include
  `NORMAL`. A mesh with no material takes the theme colour. Optional vertex
  attributes: `_ID`, `_<NAME>`. Meshopt, quantization, `KHR_materials_*` and
  `KHR_texture_transform` are accepted.
- **Layers:** `extras.layers = [{ id, name?, parent?, visible? }]` on the
  scene, `extras.layer = id` on a node. Keep ids stable across rebuilds, and
  emit hidden layers too (`src/layers.js`).
- **Connectors:** `extras.connectors = [{ position, rotation?, tags? }]` on
  any node, in its frame: where things go. A carry, part or paste goes into
  the connector's frame. A tagged connector takes only objects sharing a
  tag. `extras.snapRadius` (metres) sets the reach; without it the reach is
  0.71 × the connectors' closest spacing in plan (x, z), so a lone connector
  reaches nothing. The scene reads it once (`src/connectors.js`), and every
  reader takes it from `content(id).extras.snapRadius`.
- **Legend:** `extras.legend = { title, unit, min, max, stops }` on a mesh,
  2–32 `#rrggbb` stops, draws a colour bar.
- **Shadows:** a mesh whose node's `extras.receiveShadow` is `false` casts
  the sun's shadows but takes none (a one-sided sheet: a sail). Dressing may
  set `userData.receiveShadow = false` on a mesh it draws for the same.

### The kit

Small modules several packages need are copied, never imported:
`src/glb.js` (GLB encoder), `src/render-read.js`, `src/layers.js`. Each
says `[kit: <name> v<N>]`. Edit the canonical copy here, bump its version,
and run `node scripts/check-kit.mjs --fix` at the repo root.

## Where to look

[STAGE.md](STAGE.md) and [API.md](API.md) are the kernel's contract, [NATIVE.md](NATIVE.md) the
native services, [EDITOR.md](EDITOR.md) the editor and the commands packages
meet it by, [CONVENTIONS.md](CONVENTIONS.md) what packages agree among
themselves; [DESIGN.md](DESIGN.md) the idea, [HISTORY.md](HISTORY.md) how and
why, [PLANS.md](PLANS.md) deferred work.
`src/index.js` is plugin metadata only (worker-safe); `src/stage/` the stage
and view; `src/content/` content; `src/parts/` the editor's extensions;
`src/test/` the harness.

## Probes

`probes/` holds browser probes: a page that mounts the built tool against an
in-memory repo, and a `*-run.mjs` runner that drives it in headless Chrome
over CDP with a real mouse, keyboard or touch. Run `pnpm build`, then `node
probes/<name>-run.mjs` (`--show` to watch). Each `publish-*.mjs` run makes
new docs on a real sync server.
