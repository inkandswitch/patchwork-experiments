# scene

A 3D scene for Patchwork that composes geometry from many datatypes. Each
datatype keeps its own canonical format; its package registers a
**`scene:source` provider** that renders it to GLB. The scene links each object
to a small **`scene-render`** doc that records how it was built, rebuilds it
when the source or the build params change, and shows the result with grid,
axes, bounding-box dimensions and point-to-point measurements. A GLB file is
shown as it is, with no render doc (a *passthrough* provider). Objects can be
arranged in **groups**, and a scene of hundreds of parts only loads what is
shown.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `scene` | the composition (listed) |
| `patchwork:datatype` | `scene-render` | one per scene object (unlisted) |
| `patchwork:tool` | `scene` | the scene host |
| `patchwork:tool` | `scene-render-controls` | generic build-param form for a `scene-render` doc |
| `scene:source` | `file-glb` | `file` docs with extension `glb` — `passthrough: true`: shown straight from the file, never built |
| `scene:source` | `file-stl` | `file` docs with extension `stl` (binary + ASCII → GLB; params `unit` mm/cm/m/in, `up` z/y) |

## Using it

Make a Scene, then drop documents onto it from the sidebar (or drop `.stl` /
`.glb` files from the desktop, or paste an automerge URL anywhere outside a
text field). If more than one provider can show a document you pick one.

Dropping onto the **outline** puts the document where you dropped it rather than
at the top level: on a group's row it goes inside that group, and near a row's
top or bottom edge it goes before or after that row instead. The row under the
pointer says which it will be. Below an open row with children the line sits
between that row and its first child, and that is where the drop goes: inside,
at the top. Beside an object that is attached to another (rather than in a
group), a dropped document is attached to the same object. Rows can be dragged
by their name to move them the same way — that is the same thing the
inspector's **Attached to** does, and like it, re-parenting keeps the object's
world pose, so nothing moves on screen. A row released where it already sits
writes nothing, and a reorder among siblings changes only `order` (spliced, so
a collaborator's concurrent add survives the merge). A group can't be dropped
into itself or into anything inside it, and a row dragged in from another
scene's outline is refused. Dragged out of the scene, a row is its geometry:
it carries the object's render doc (a passthrough object, its GLB file) in the
sidebar's drag formats, so it can be dropped on a slicer or a flow field's body
slot; scenes themselves never add a dragged row.

- **Outline**: visibility, colour, remove; click to select, double-click to frame.
  Groups and attached objects are listed (indented, 10 px a level up to 8)
  under their parent, and anything with children folds open and shut (the
  chevron, or ← / → on a focused row; ↑ / ↓ move). What's open is yours alone,
  kept in this browser (`localStorage`, `scene-outline:<scene url>`), never in
  the doc; by default a visible top-level group is open and everything deeper is
  closed. A group's checkbox hides or shows everything in it (one write) and
  shows a dash when something inside is hidden. **Remove** on a group takes the
  group and everything in it, after asking. **New group** makes an empty group
  (inside the selected group, if one is selected).
- **Filter** (above the list, once there are 8 or more objects): matches every
  word, case-insensitively, against each object's name and its group path, and
  shows the matches with their groups (dimmed) and a count ("12 of 507").
  Enter selects and frames the first match; Esc clears. It never touches the doc.
- **Inspector**: name, colour, opacity, wireframe, **Attached to** (groups
  first, as a tree, then objects), position (display units), rotation
  (degrees), scale; **Group** puts the object in a new group where it is;
  for a group, **Ungroup** moves its contents up a level, where they are and
  as they look (a hidden group's contents stay hidden, a translucent one's
  keep its opacity), and removes it. **About** shows the object's `infoUrl` document (or its nearest
  group's, labelled "About <group>") in an embedded `<patchwork-view>`, with
  **Open**. Then the embedded build controls, for objects that have a render doc.
- **Attaching**: pick an object under *Attached to* and this one moves with it
  from then on (a flow field attached to its hull, say). Attaching and
  detaching keep the object exactly where it is; only its stored transform
  changes, since that is relative to what it's attached to. The list leaves out
  the object itself and anything attached to it, so a loop can't be made.
  Hiding an object doesn't hide what's attached to it. Removing an object
  leaves its attachments where they were, now at the scene root.
- **Viewport**: orbit/pan/zoom, click to select, move/rotate gizmo (`G` / `R`),
  **Frame all** (`F`).
- **Grid / Axes / Bounds** toggles and a units selector (mm, cm, m, in, ft).
  With **Bounds** on, the selected object (or every object) gets width / height /
  depth labels.
- **Panel** (`P`) hides the side panel for a full-width view. It is yours
  alone, not saved in the doc.
- **Legends**: an object whose GLB says how it was coloured (below) gets a
  colour bar in the viewport's corner while it is visible.
- **Loading**: only objects that are actually shown (their own box ticked and
  every group above them shown) are loaded; a hidden group costs nothing until
  it is shown, and what has loaded stays loaded when hidden again. Until an
  object's GLB arrives, a `hint.bounds` box (if the doc has one) is drawn in its
  place, and **Frame all** uses it. The HUD says "Loading 40 of 74…".
- **Measure** (`M`): click two points on geometry (snaps to a vertex within
  10 px; misses land on the ground plane). The dimension is saved in the scene,
  anchored to each object's local coordinates so it follows when the object
  moves. Click a dimension label to select it, `Delete` to remove it, `Esc` to
  cancel or stop measuring. A dimension that is short on screen (under 2½
  label widths, like a cleat's length) has its label lifted off the line on a
  leader, so the label doesn't cover the part it measures.

Lighting is a key light fixed in the world (so faceted panels shade
differently as you orbit), a weak headlight fill, and a dim sky/ground and
room environment, kept near 1 in total so light baked colours don't clip.

Selection and hover are shared with other people in the scene over
`handle.broadcast`; nothing about presence is written to the doc.

## Writing a provider

A provider lives in the package that owns the datatype. It is plain metadata in
the exported `plugins` array (the entry module runs in a worker, so every field
except `load` must survive `structuredClone`) with the code behind `load()`:

```js
{
  type: "scene:source",
  id: "camber-hull-surface",          // globally unique
  name: "Camber hull",
  icon: "Sailboat",                    // lucide name, optional
  supportedDatatypes: ["camber-hull"], // datatype ids; ["file"] for file docs
  extensions: ["stl"],                 // ONLY for file providers: lower-case, no dot
  params: [ParamSpec, ...],            // build params, optional
  cost: "expensive",                   // what a build after a source edit costs (set it!)
  version: 1,                          // integer; bump when build() output changes for the same inputs
  async load() { return (await import("./scene-source.js")).default },
}
```

```ts
type ParamSpec = {
  key: string
  label?: string
  kind: "number" | "integer" | "boolean" | "enum" | "string" | "color"
  default: any
  min?: number; max?: number; step?: number; log?: boolean   // number/integer
  options?: { value: any; label: string }[]                  // enum
  cost?: "cheap" | "expensive"                               // default "expensive"
}

type SourceImpl = {
  build(args: { doc, handle, url, params, repo }): Promise<BuildResult>  // must not write the source
  fingerprint?(doc): string   // changes iff something build() reads changes; else heads are used
  dependencies?(doc): AutomergeUrl[]  // sync: the OTHER docs build() reads (imports, a linked hull…)
  fingerprintDependency?(url, doc): string | null  // sync: like fingerprint(), for one dependency
}

type BuildResult = {
  kind: "glb"
  glb: Uint8Array                                        // glTF 2.0 binary
  meta?: { bounds?: { min: [x,y,z], max: [x,y,z] }, notes?: string }
}
```

`params` passed to `build()` always have every ParamSpec default filled in, so a
provider can add params later without migrating render docs. They are also
**coerced and clamped to their spec** (`min`/`max`, integer rounding, enum
options, `#rrggbb` colours); a value that can't be coerced is replaced by the
default. Render docs are written by forms, agents, other tools and merges, so
the host checks them once and a provider can trust its own metadata instead of
re-clamping (and disagreeing with it). Keys without a spec pass through.

**Version.** A provider that declares an integer `version` gets it recorded in
`builtFrom.providerVersion`. Bump it whenever `build()` would make different
output from the same doc and params (a better mesher, a fixed transform), and
every render built by an older version (or by one that declared none) goes
stale once. A render built by a *newer* version is never stale to an older
provider, so two collaborators on different versions don't rebuild over each
other; the newer build stays. Prefer this to a hand-bumped prefix inside the
fingerprint.

**Dependencies.** If `build()` reads documents besides its source (an OpenSCAD
file's imports, a flow field's linked hull), return their URLs from
`dependencies(doc)`. The scene calls it whenever the source changes, keeps a
subscription to exactly the docs it lists (adding and dropping them as the list
changes), and rebuilds when one of them changes, debounced like a source edit.
Each build records the heads of every dependency as it was read
(`builtFrom.deps`). A dependency that can't be loaded doesn't block the build —
`build()` decides what that means — and is retried in the background; the
render goes stale (and rebuilds) once it arrives. On first open the scene waits
up to 5 s for dependencies that are still loading, so it doesn't build once
without them and again with them. Dependencies are only transitive if you list
them transitively. Duplicates and the source's own URL are ignored.

By default a dependency is recorded by its heads, so *any* edit to it rebuilds.
`fingerprintDependency(url, doc)` narrows that the way `fingerprint` narrows
the source: return a string that changes iff something build() reads from that
doc changes (null = use heads), and it is recorded as `["fp:<string>"]` in
place of the heads. A **scene-render** dependency needs nothing: the host keys
it by its `glbUrl` on its own, so a consumer rebuilds when the render it reads
gets a new GLB, never on the render's status writes (see *Consuming a render*).

The form in `scene-render-controls` is generated from `params`: `number` /
`integer` get a number field plus a slider when both `min` and `max` are given
(logarithmic when `log: true` and `min > 0`), `enum` a select, `boolean` a
checkbox, `color` a colour picker (`#rrggbb`), `string` a text field.

**Rebuild debounce** is by cost: a params edit where every changed key is
`cheap` waits 150 ms, anything else 800 ms; a never-built render builds at once.
For source-doc edits the scene uses 150 ms if every param is `cheap`, otherwise
800 ms. A provider may also set an optional top-level `cost: "cheap" |
"expensive"` to say how expensive a build from a source edit is (this is an
extension; hosts that don't know it fall back to the rule above).

### Consuming a render

When your provider (or tool) needs another object's geometry — a flow field
around a hull, a slicer, an FEA mesh — read that object's **render doc**, not
its source, and never call another package's provider yourself:

- the work is done once and shared, by whichever scene keeps it fresh;
- you get exactly the geometry the scene shows, built with the params the
  scene chose for it, not the provider's defaults;
- its own dependencies come along for free: an OpenSCAD part's imports are the
  render's business, and a new GLB is all you see.

Copy `src/render-read.js` (see *The kit*) and list the render's url in
`dependencies(doc)`; `readRender(repo, url)` gives you `{ glb, glbUrl,
builtFrom, status, error, bounds, source }`. The GLB is in the render's own
frame (Y-up metres); to follow the object around the scene, attach your object
to it. A render that hasn't been built yet gives `glb: null`: say so in your
`meta.notes` rather than throwing, and you rebuild when it arrives.

### GLB conventions

- glTF 2.0, **Y-up, metres**, right-handed. Convert units and axes inside the
  provider. If the source is unitless, expose a `scale`-style param.
- Name nodes and meshes; names show up in the scene.
- Triangles (mode 4) for surfaces. Lines (mode 1) or line strips (mode 3) for
  edges and curves.
- Optional per-vertex FLOAT attributes: `_ID` (a stable face/part id) and scalar
  fields as `_<NAME>`. (three.js lower-cases custom attribute names on load:
  `_ID` arrives as `_id`.)
- Hosts accept `EXT_meshopt_compression` and `KHR_mesh_quantization` (as
  gltfpack and Rhino's exporter write them), `KHR_materials_*` and
  `KHR_texture_transform`. Quantized positions are converted to Float32 on load,
  so measuring snaps to them. Meshes that reuse one (geometry, material) pair
  inside a GLB are drawn as one InstancedMesh.
- Include `NORMAL` where you can. Materials are optional; the scene may override
  colour. A mesh without a material is drawn in the theme's object colour
  (GLTFLoader's default material, found exactly; a material the file does
  define keeps its colour even if it is unnamed white metal). An
  object colour replaces the base colour only, so a material's metalness and
  roughness survive it (a white metal part tinted bronze stays metal), and
  `KHR_materials_unlit` draws baked colours exactly.
- Optional colour legend: put `extras.legend = { title, unit, min, max, stops }`
  on a mesh, `stops` being 2–32 `#rrggbb` colours spaced evenly from `min` to
  `max`. The scene draws it as a bar with three ticks. Anything else in it is
  ignored, and a legend that doesn't check out is simply not shown.

### The kit

Small modules that several packages need are **copied**, never imported across
packages. Each says `[kit: <name> v<N>]` in its header; the canonical copies
live here in `src/`:

| file | what |
|---|---|
| `src/glb.js` | the GLB encoder (and a minimal reader), below |
| `src/render-read.js` | reading a `scene-render` doc and its GLB from another package |

To change one, edit the canonical copy, bump its version, and run
`node scripts/check-kit.mjs --fix` at the repo root to copy it over every other;
without `--fix` the script fails on any copy that has drifted.

### The encoder

`src/glb.js` is a dependency-free GLB encoder. **Copy it** into your package
(never import across packages). Its API is documented at the top of the file.
v2 adds per-vertex `colors` (COLOR_0), `unlit` (KHR_materials_unlit), `blend`
(alphaMode BLEND) and writes `asset.extras.units = "m"`, so a consumer outside
a scene (a slicer, say) knows the scale without guessing:

```js
import { encodeGLB, computeNormals, MODE } from "./glb.js"

const glb = encodeGLB({
  meshes: [
    { name: "hull", positions, indices, normals: computeNormals(positions, indices),
      attributes: { _ID: faceIds }, color: "#c0c8d8" },
    { name: "sheer", positions: sheerPts, mode: MODE.LINE_STRIP, color: [0, 0, 0] },
  ],
})
```

It is tested by round-tripping through three's `GLTFLoader` (`src/glb.test.js`).

## Documents

### `scene-render` — one per object, URL stable forever

```ts
{
  "@patchwork": { type: "scene-render" },
  title: string,
  parent: AutomergeUrl,             // the source doc (never written)
  providerId: string,
  params: { [key]: value },         // edited by the controls
  glbUrl: AutomergeUrl | null,      // repointed on every rebuild
  builtFrom: {
    heads: string[], fingerprint: string | null, paramsKey: string,
    deps?: { [url: AutomergeUrl]: string[] },  // each dependency's sorted heads, as read ({} when none),
                                               // or ["fp:<key>"] for a keyed dependency
    providerVersion?: number,                  // the provider's `version`, if it declares one
    glbHash?: string                           // content hash of the GLB at glbUrl
  } | null,
  builtAt: number | null,
  bounds?: { min: [x,y,z], max: [x,y,z] } | null,  // the last build's meta.bounds (placeholder box)
  status: "idle" | "building" | "error",
  error: string | null,
  pinned: boolean                   // true = never auto-rebuild
}
```

- `paramsKey` is JSON of `params` (as stored, before defaults and clamping)
  with keys sorted at every level.
- **Stale** iff `builtFrom` is null, or `paramsKey` differs, or the installed
  provider declares a `version` newer than `builtFrom.providerVersion` (or
  there is none recorded), or (provider has a
  fingerprint ? `fingerprint(source) !== builtFrom.fingerprint` : sorted source
  heads ≠ sorted `builtFrom.heads`), or the provider's current dependency URLs
  differ from the keys of `builtFrom.deps`, or any dependency's sorted heads
  differ from the recorded ones. A render doc without `deps` (built before
  dependencies existed) counts as `{}`, so a provider that starts reporting
  dependencies rebuilds each of its renders once. A dependency that isn't
  loaded counts as having no heads (`[]`).
- Every build that produces new bytes makes a **new immutable GLB file doc**
  and repoints `glbUrl`: `{ "@patchwork": { type: "file" }, name:
  "<title>.glb", extension: "glb", mimeType: "model/gltf-binary", content:
  Uint8Array }`. A build whose bytes hash the same as the current GLB's
  (`builtFrom.glbHash`) keeps the current file doc, so a rebuild that changes
  nothing (a rename, a version bump with identical output) makes no new doc
  and doesn't disturb anything that depends on the render. Superseded GLBs are
  simply orphaned.
- `bounds` is the last build's `meta.bounds`; until the GLB loads it is drawn
  as a placeholder box (a scene object's own `hint.bounds` wins).
- The previous GLB stays on screen while the next one builds.
- A failed build records `status: "error"` and `error`. It is retried
  automatically after 5 s, 30 s and 2 min (inputs unchanged; covers a CDN
  fetch, a worker that ran out of memory once), then not again until its
  inputs change or someone presses Rebuild.
- Before building, a scene broadcasts `{ type: "scene-render:building", key }` on
  the render doc; other open scenes hold off on the same inputs for 20 s so two
  peers don't both run an expensive build.
- "Rebuild now" in the controls dispatches a bubbling, cancelable
  `scene:rebuild` DOM event (`detail.renderUrl`). A scene around it claims it
  and rebuilds through its own loop; standalone, the controls build directly.

### `scene` — the composition

```ts
{
  title: string,
  objects: { [objectId]: {
    kind?: "object" | "group",      // absent = "object"
    name: string,
    sourceUrl: AutomergeUrl | null, providerId: string | null,
    renderUrl: AutomergeUrl | null, // null: passthrough (shown from sourceUrl) or a group
    visible: boolean, color: string | null, opacity: number, wireframe: boolean,
    transform: { position: [x,y,z], rotation: [x,y,z] /* Euler XYZ, radians */, scale: number },
    parent?: string | null,         // another objectId (object or group); absent = null
    infoUrl?: AutomergeUrl | null,  // a document about it, any datatype (the About section)
    infoToolId?: string | null,     // the tool to show it with; absent = the shell's default
    hint?: { bounds?: { min: [x,y,z], max: [x,y,z] }, triangles?: number, bytes?: number }
  } },
  order: string[],
  dimensions: { [id]: { a: Anchor, b: Anchor, label: string | null } },
  view: { units: "m" | "cm" | "mm" | "in" | "ft", grid: boolean, axes: boolean, bounds: boolean },
  camera: { position: [x,y,z], target: [x,y,z] } | null,
  materialRules?: MaterialRule[]
}
Anchor = { objectId: string | null, local: [x,y,z] | null, world: [x,y,z] }
MaterialRule = {
  match: { nameIncludes: string } | { nameEquals: string } | { unnamed: true },   // case-sensitive
  set: { color?: "#rrggbb", emissive?: "#rrggbb", metalness?, roughness?, opacity?, transmission? }  // 0..1
}
```

- `renderUrl` is written once, when the object is added. It is `null` for an
  object added through a passthrough provider (`file-glb`): no render doc and
  no GLB copy are made, the scene shows `sourceUrl`'s bytes directly and never
  builds it. An object that has a `renderUrl` keeps the render-doc path, so
  GLBs added before passthrough still work.
- **Groups** (`kind: "group"`) have no geometry: `sourceUrl`, `providerId`,
  `renderUrl` and `color` are null and `wireframe` false. They are parents like
  any object (transforms compose). Unlike an object, hiding a group hides
  everything below it, and its opacity multiplies into everything below it.
  A group is never picked and can't anchor a dimension; its box (Frame,
  selection) is the union of what's shown inside it.
- `hint` is written by importers: `bounds` (metres, in the GLB's own frame)
  is drawn as a placeholder until the GLB loads and decides load order (bigger
  first, the selected object before everything).
- `materialRules` are applied, in order, to every loaded material whose name
  matches, after the GLB's own values and before the object's colour and
  opacity; later rules win. `unnamed` matches authored materials with no name,
  never GLTFLoader's default material. Changing them re-applies them at once,
  with no rebuild.
- Build params live on the render doc; display state lives here and never
  triggers a rebuild.
- **Attachment.** `transform` is relative to `parent`: world = parent's world ·
  local (`src/hierarchy.js`). A `parent` naming a missing object (or the object
  itself) means the scene root. Cycles are never written by the UI; if
  concurrent edits merge into one, every peer breaks it the same way (the
  object with the smallest id in the loop is treated as a root). Attaching and
  detaching rewrite `transform` so the world pose is unchanged. Removing an
  object sets each of its children's `parent` to null and their `transform` to
  their world pose. (A peer running an older scene that removes a parent
  doesn't do that, and its children then jump to their local transform at the
  root.) The move/rotate gizmo edits the local transform.
- An anchor with an `objectId` whose object still exists resolves through that
  object's current world matrix (so it follows whatever the object is attached
  to); otherwise it uses `world`. Removing an object freezes its anchors at
  their current world position.
- Bounds, **Frame all** and selection boxes are world-space boxes of each
  object's own geometry (not including what is attached to it).
- `camera` is written 1.5 s after you stop orbiting and read once on open.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/datatype.js` | the two datatypes |
| `src/tool.js` | scene host: doc ↔ viewport ↔ render manager / GLB queue ↔ sidebar |
| `src/viewport.js` | three.js: renderer, controls, grid/axes/triad, bounds, dimensions, picking, placeholders |
| `src/gltf-content.js` | GLB bytes → display-ready content: the shared loader (meshopt), dequantizing, default-material detection, material rules, InstancedMesh collapse |
| `src/pick-accel.js` | lazy three-mesh-bvh for big meshes (built in idle time or on the first ray that crosses one) |
| `src/render-manager.js` | per-object watch / stale / debounce / build / load loop (render-doc objects) |
| `src/glb-queue.js` | the load queue for passthrough objects: priority, ≤ 4 finds, 1 parse at a time, retries, subscriptions |
| `src/groups.js` | groups: inherited visibility / opacity, remove / ungroup plans, the outline's rows and filter |
| `src/material-rules.js` | `materialRules`: checking and matching |
| `src/deps.js` | watches a provider's dependency docs (subscribe, retry, heads) |
| `src/build.js` | one build: provider → GLB file doc → repoint render doc |
| `src/controls-tool.js`, `src/param-form.js` | the `scene-render-controls` tool |
| `src/glb.js` | the GLB encoder (kit: copy me) |
| `src/render-read.js` | reading a render doc and its GLB from another package (kit: copy me) |
| `src/stl.js`, `src/sources/*` | STL parsing and the two file providers |
| `src/staleness.js`, `src/units.js`, `src/anchors.js`, `src/providers.js`, `src/dnd.js` | pure logic, unit-tested |
| `src/transform.js`, `src/hierarchy.js` | transform matrices (compose / decompose / invert) and attachment (world matrices, cycle checks, re-parenting that keeps the world pose) |
| `src/tree-drop.js` | where a drag lands in the outline: which band of a row means inside vs beside, and what parent and sibling that comes to |
| `probes/` | browser probes: `scene-probe.html` mounts the built tool in headless Chrome against an in-memory repo; `attach-probe.html` drives the real viewport with a parent and a child; `solander-probe.html` + `solander-run.mjs` load a 507-object imported scene of real GLBs and measure it; `make-example-scene.mjs` writes `solander-scene.example.json`, a portable stand-in for the importer's scene; `publish-example-scene.mjs` uploads it to a real sync server; `drag-probe.html` + `drag-run.mjs` drive real mouse drags into and within the outline |

### Browser probe

```
pnpm build
node probes/probe-server.mjs . 4457 &     # prints the JSON report and exits
open http://localhost:4457/probes/scene-probe.html
node probes/shoot.mjs http://localhost:4457/probes/scene-probe.html shot.png   # screenshot over CDP
```

It adds a 20 mm STL cube and a GLB box, waits for both to build, checks the
bounds labels (30/10/15 mm and 20/20/20 mm), finds the objects by hovering,
selects one, measures between two picked points, moves the cube and checks the
dimension follows, then switches the STL's unit param to cm through the
embedded controls and checks it rebuilds at 200 mm. Serve a root that also has
`themes/theme.css` and `themes/gloom.css` (copied from `theming/src`) to see it
in the real light theme, and add `?theme=gloom` for dark.

```
node probes/probe-server.mjs . 4458 &
node probes/shoot.mjs http://localhost:4458/probes/attach-probe.html shot.png
```

`attach-probe.html` needs no build (it imports `src/`, and three from
`node_modules`). It checks that a child's box follows its parent, that boxes
are each object's own geometry, that hiding a parent leaves the child visible,
that a gizmo drag on a child of a rotated, scaled parent moves it along the
world axis and reports a local transform whose world pose matches, and that
detaching, and removing the parent, keep the child's world pose.

### At scale: the Solander 38 probe

`solander-run.mjs` serves the Solander 38 site's original GLBs (378 files,
13.0 MB, meshopt + quantized) and a scene doc of the importer's shape (507
objects: 378 passthrough layers under 129 groups, 74 shown by default, the
battery and deck-jig roots hidden), mounts the built tool in headless Chrome
(real WebGL: ANGLE Metal, Apple M4) against an in-memory repo whose file docs
arrive over HTTP on first `find`, throttled to 50 Mbit/s and 20 ms, and
reports:

```
pnpm build
node probes/solander-run.mjs --geom <site>/frontend/public --scene <importer>/dry/scene.json --out /tmp/solander [--site]
```

Measured 2026-09-30 (warm runs; the very first launch after a reboot was
slower, see below):

| metric | target | measured |
|---|---|---|
| docs fetched on open | 74 docs, 3.97 MB; hidden: 0 | 74 docs, 3,968,988 B; 0 hidden fetched |
| concurrency | ≤ 4 finds, ≤ 1 parse | 4 finds, 1 parse |
| handles per loaded object | ≤ 1 | 1 (74 subscriptions) |
| first pixels (hull + deck) | < 1.5 s | 0.14–0.23 s |
| all 74 default layers loaded | < 8 s | 0.95–1.05 s |
| long tasks during load | none > 50 ms | none after mount; the mount's own task (WebGL context, environment map, first sync) is 66–126 ms |
| sync + outline, one visibility toggle | < 8 ms | layer p95 2.8 ms, group p95 2.1 ms |
| `renderOutline()` | ≤ 1 per frame, < 4 ms | max 1 per frame during load; p95 0.2 ms, max 1.2 ms. A burst of doc changes redraws at once for the first 3 (≤ 4 ms), then once per frame: 100 changes in one task → 3 passes, then 1 |
| draw calls, default view (renderer.info) | ≤ 150 | 238, not met: 117 objects drawn, and three's transmission pre-pass redraws the opaque ones for the Glass / Acrylic / Solar panels materials. 129 with a transmission → opacity rule, which the importer can write |
| draw calls, everything shown (renderer.info) | ≤ 500 | 928 with the pre-pass, not met: 462 objects drawn (battery 2,953 nodes → 265 instanced) |
| triangles | 0.55 M / 4.18 M | 550,417 / 4,176,884 |
| hover pick, default view | p95 < 4 ms | p95 0.5 ms (7 ms before the lazy BVH); in Measure mode (10 px vertex snap) p95 1.1 ms, everything shown 1.6 ms |
| idle | 0 frames | 0 |

The first launch after the machine had been idle (cold GPU process and page
cache) took 0.95 s to first pixels and 2.2 s to load, with five long tasks
(57–386 ms). Making every shader source unique (`--query cold=1`) did not
reproduce it, so it isn't shader compilation (compileAsync runs before a GLB is
shown).

### The example scene, without the importer

`--scene <importer>/dry/scene.json` needs the original importer checkout.
`probes/solander-scene.example.json` is the portable stand-in: the same shape
(378 objects, 129 groups, 507 total), reconstructed from the GLB filenames,
which carry their assembly path separated by `__`. Regenerate it, and run the
probe against it, with:

```
node probes/make-example-scene.mjs --geom <site>/frontend/public
node probes/solander-run.mjs --geom <site>/frontend/public --scene probes/solander-scene.example.json --out /tmp/solander
```

Its default visibility is a guess (the main set shown, battery and deck jig
hidden), so it opens **135 objects, not the 74** in the table above; the
structural rows are comparable, "docs fetched on open" is not.

`publish-example-scene.mjs` turns it into a real document you can open in
Patchwork. **Every run creates new docs on a shared sync server** — 378 file
docs and a scene doc, about 13 MB — with no dedupe across runs, so run it only
when you need a fresh URL. It uses `wss://subduction.sync.inkandswitch.com`
unless `--sync <url>` or `PATCHWORK_SYNC` says otherwise, then reads every doc
back from a fresh repo and exits non-zero (without printing the URL) if any is
missing or has no content.

```
node probes/publish-example-scene.mjs --geom <site>/frontend/public [--scene probes/solander-scene.example.json] [--sync wss://…]
```

### Drag probe

```
pnpm build
node probes/drag-run.mjs              # serves the package, drives headless Chrome, prints the report
```

`drag-probe.html` mounts the built tool against an in-memory repo next to a
fake sidebar whose rows start a drag carrying the same payload Patchwork's
sidebar does (`text/x-patchwork-dnd`, `text/x-patchwork-urls`, `text/plain`).
`drag-run.mjs` moves a real mouse over CDP at the rows' real heights: a
document dragged onto a group goes inside it, a row reorders, a row reparents
into a group keeping its world pose, a group refuses to go into its own child,
and the whole-tool hint is down afterwards.
