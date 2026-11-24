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
| `patchwork:tool` | `scene-render-controls` | the build-param form for a render doc |
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
parts bin. Extensions never import one another. [STAGE.md](STAGE.md) is the
contract.

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
  build({ doc, handle, url, params, repo }): Promise<{ kind: "glb", glb: Uint8Array,
        meta?: { bounds?: { min, max }, notes?: string } }>,   // must not write the source
  fingerprint?(doc): string,              // changes iff something build() reads changes
  dependencies?(doc): AutomergeUrl[],     // other docs build() reads; rebuilt when they change
  fingerprintDependency?(url, doc): string | null }
```

- `"built"`: `build()` makes a GLB, kept in the object's own `scene-render`
  doc and rebuilt when the source, params, dependencies or `version` change.
  `params` arrive with defaults filled in and clamped to their spec.
- **Where `build()` runs.** On the page's main thread, called by the render
  manager (`src/build.js`) of whichever open scene finds the render stale:
  at most one build per render doc at a time, builds of different objects
  side by side; a provider that needs a thread starts its own worker. It is
  given exactly `{ doc, handle, url, params, repo }`: the source doc and its
  handle (a read-only view at `at.heads` for a fixed object, `url` then
  carrying `#heads`), the params as above, the repo to read dependencies
  from. It must not write the source, nor assume a stage, a DOM or a scene:
  other packages call it too, outside any scene, to get a doc's geometry
  with its params' defaults (naval's, flow-field's and openfoam's hull
  links). Nothing cancels it: a removed object's build runs out and is
  dropped. A provider may cancel its own build by rejecting with an error
  named `"AbortError"` (a newer build of the same doc superseding it): that
  is not a failure, and the render is looked at again. Any other rejection
  is the render's `error`, retried with backoff.
- `"file"`: the source doc already is a GLB file. No render doc, no `load()`.
  `file-glb` is this package's: a package adding a GLB file doc to a scene
  writes `providerId: "file-glb"`.
- A render doc records `glbUrl` and what it was `builtFrom`; new bytes make a
  new immutable GLB file doc (`newRenderDoc` in `src/datatype.js`, staleness
  in `src/staleness.js`).

### Consuming a render

To use another object's geometry, read its render doc, never its source or
another package's provider. Copy `src/render-read.js`: `readRender(repo,
url)` gives `{ glb, glbUrl, builtFrom, status, error, bounds, source }`. List
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

`routeOf` in `src/providers.js`: an object with a render doc goes to the
render manager, which shows what was built even without its provider. One
without goes where its provider's `content` says (`"file"`: the GLB queue;
`"scene"`: a link). Anything else is drawn as its `hint`.
`api.loadState(id).content` says which.

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
  tag. `extras.snapRadius` (metres) sets the reach; without it the carry
  takes 0.71 × the closest spacing, so a lone connector doesn't snap.
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

[STAGE.md](STAGE.md) is the kernel's contract, [NATIVE.md](NATIVE.md) the
native services, [EDITOR.md](EDITOR.md) the editor and the commands packages
meet it by, [CONVENTIONS.md](CONVENTIONS.md) what packages agree among
themselves; [DESIGN.md](DESIGN.md) the idea, [HISTORY.md](HISTORY.md) how and
why, [PLANS.md](PLANS.md) deferred work.
`src/index.js` is plugin metadata only (worker-safe); `src/stage/` the stage
and view; `src/parts/` the editor's extensions; `src/test/` the harness.

## Probes

`probes/` holds browser probes: a page that mounts the built tool against an
in-memory repo, and a `*-run.mjs` runner that drives it in headless Chrome
over CDP with a real mouse, keyboard or touch. Run `pnpm build`, then `node
probes/<name>-run.mjs` (`--show` to watch). Each `publish-*.mjs` run makes
new docs on a real sync server.
