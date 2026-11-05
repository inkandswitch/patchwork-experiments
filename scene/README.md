# scene

A 3D scene for Patchwork that composes geometry from many datatypes. Each
datatype keeps its own canonical format; its package registers a
**`scene:source` provider** that renders it to GLB. The scene links each object
to a small **`scene-render`** doc that records how it was built, rebuilds it
when the source or the build params change, and shows the result with grid,
axes, bounding-box dimensions and point-to-point measurements. A GLB file is
shown as it is, with no render doc (a *passthrough* provider). Objects are
filed in **groups** (which organise, and hide or fade what's in them) and
**attached** to one another (which is where they are: an attachment moves
with its parent), two separate things; a scene of hundreds of parts only
loads what is shown.

The tool itself is a **stage** with no UI of its own: it keeps the doc,
loads and builds content, renders, picks and routes input. Everything you
see or do in a scene comes from **extensions** (`scene:extension` plugins),
and the editor described under "Using it" is the **model kit**: 20 of them
that this package ships (selection, gizmo, hand, outline, inspector,
toolbar…), each its own module in `src/parts/`. Other packages add more
(tabletop's game table, arena's first-person level), and any kit can be
turned on or off per viewer. [STAGE.md](STAGE.md) is the contract between
the stage and extensions; [DESIGN.md](DESIGN.md) says why it's built this way.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `scene` | the composition (listed) |
| `patchwork:datatype` | `scene-render` | one per scene object (unlisted) |
| `patchwork:tool` | `scene` | the stage (`src/stage/stage.js`) |
| `patchwork:tool` | `scene-render-controls` | generic build-param form for a `scene-render` doc |
| `scene:source` | `file-glb` | `file` docs with extension `glb` — `passthrough: true`: shown straight from the file, never built |
| `scene:source` | `file-stl` | `file` docs with extension `stl` (binary + ASCII → GLB; params `unit` mm/cm/m/in, `up` z/y) |
| `scene:extension` | `scene.*` (21) | the parts in `src/parts/`, listed under "Layout" |
| `scene:kit` | `model` | the scene editor: every part but `scene.kits`, in the order input is offered to them |

`scene.kits` (the Kits button, which turns kits on and off for you) runs in
every scene.

## Using it

This is the model kit, which a scene opens with unless its doc suggests
other kits (`view.kits`; a game table suggests none).

Make a Scene, then drop documents onto it from the sidebar (or drop `.stl` /
`.glb` files from the desktop, or paste an automerge URL anywhere outside a
text field). If more than one provider can show a document you pick one.

Dropping onto the **outline** puts the document where you dropped it rather than
at the top level: on a group's row it goes inside that group, and near a row's
top or bottom edge it goes before or after that row instead. The row under the
pointer says which it will be. Below an open row with children the line sits
between that row and its first child, and that is where the drop goes: inside,
at the top. Beside an object that is attached to another, a dropped document
is attached to the same object (and filed in its group). Rows can be dragged
by their name to move them the same way: among a group's rows a row is filed
in that group and detached from whatever it was attached to; among an
object's attachments it's attached to that object. Either way it stays
exactly where it is on screen (a group has no transform; attaching and
detaching rewrite the object's transform to keep its world pose). A row
released where it already sits writes nothing, and a reorder among siblings
changes only `order` (spliced, so a collaborator's concurrent add survives the
merge). A group can't be dropped into itself or anything inside it, or among
an object's attachments, and a row dragged in from another scene's outline is
refused.

- **Outline**: visibility, colour, remove; click to select, double-click to frame.
  What's in a group is listed under it, and an object attached to another in
  the same group under that object (indented, 10 px a level up to 8); an
  object attached to something filed elsewhere is listed in its own group.
  Anything with children folds open and shut (the
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
- **Inspector**: name, colour, opacity, wireframe, **In group** (the groups,
  as a tree; filing moves nothing), **Attached to** (objects), position
  (display units), rotation (degrees), scale; **Group** puts the object in a
  new group where it's filed; for a group, name, visibility, opacity and the
  group it's in, and **Ungroup** moves its contents up a level, as they look
  (a hidden group's contents stay hidden, a translucent one's keep its
  opacity), and removes it. Commands from extensions (*Shuffle pile* at a game
  table, say) are buttons here too. **About** shows the object's `infoUrl` document (or its nearest
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
  **Frame all** (`F`). The gizmo on a selected group sits at the middle of
  what's in it and moves all of it (what's attached to a member follows the
  member; locked members stay), written as one change.
- **Hand** (`H`, or *Hand* in the gizmo menu): pick objects up and put them
  down elsewhere, like pieces on a table. Press on an object and drag: it
  floats just above the spot under the pointer (the table, or the top of a
  stack) and a ring shows where it will land. Let go and it rests on the
  highest surface under its footprint, or on the ground. If another object
  has **connectors** (snap points, from its GLB, below) near that spot that
  take it, it goes to the nearest one (accent ring) — hold **Alt** to put it down exactly where you
  are, or untick **Snap** to turn snapping off for this scene. A snap point
  with a yaw turns the piece to face that way. **Q** / **E** turn it 45°
  while carried, **F** turns it over (about its own length, as a card goes
  face down); **Esc** puts it back. A press that doesn't move
  is still a click (select), and a press on empty space or on a **locked**
  object orbits. There is no physics: nothing tips or slides, and only the
  final pose is written. While it's carried, other people see it move (over
  `handle.broadcast`, below). An extension can ask for the piece to go
  down another way where it's put (tabletop turns a card face up in your
  hand). A scene can open in the hand (`view.defaultMode`); after that the
  menu is yours alone.
- **Locked** (inspector): a locked object can't be carried or given the
  gizmo — a game board, say. Everything else about it still works.
- **Panels**: the sidebar's panels fold from their titles; any extension
  can contribute one.

- **Grid / Axes / Bounds** toggles and a units selector (mm, cm, m, in, ft).
  With **Bounds** on, the selected object (or every object) gets width / height /
  depth labels. These are yours: the doc's `view` only gives their defaults,
  and changing one changes it for you alone.
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
`handle.broadcast`; nothing about presence is written to the doc. So is an
object in someone's hand or on their gizmo (and each member of a group being
moved): `{ type: "scene:carry", id, transform }` (its local transform, at
most every 50 ms) while it moves, and `transform: null` when it is put down,
let go or the carry is cancelled. Peers show it there instead of where
the doc says; the put-down shows the doc's pose as soon as the doc has it (or
after a second), and a carry that goes quiet for 3 s is put back.

## Extensions

A `scene:extension` adds behaviour or UI to a scene without the scene
knowing what it means. [STAGE.md](STAGE.md) is the full contract. In short:

```js
{ type: "scene:extension", id: "tabletop", name: "Tabletop",
  traits: ["tabletop.seats", "tabletop.zone", "tabletop.hidden"],  // trait keys that start it
  legacy: { scene: ["seats"], objects: ["zone", "hidden"] },         // old fields that start it (it upgrades them)
  drops: ["*"],                                                      // datatypes it may lay out when dropped
  requires: ["scene.hand", "scene.keys"],                            // what must run with it
  always: false,
  async load() { return { create(api) { return instance }, drop?(ctx, info) } } }

{ type: "scene:kit", id: "model", name: "Model", extensions: [...], kits?: [...] }
```

- **What runs** is a function of the registry, the doc and this viewer's
  kits: an extension runs when the scene or an object has one of its traits
  or legacy fields, when a kit the viewer has on lists it, when it's
  `always`, or when a running one `requires` it. The doc suggests kits
  (`view.kits`, else `["model"]`); each viewer turns kits on and off for
  themselves.
- **State** lives in three places: the doc (shared, kept), presence (shared,
  passing: selections, carries, avatars) and local (this view only:
  selection, the current tool, display prefs). Extensions talk to each other
  through local keys, commands and contributions, never by importing one
  another.
- **Input** is offered down a chain: the armed extension (measure, a game),
  the widget under the pointer, the extensions whose traits are on the object
  under it, the scene's, then the viewer's kits in order. A press nobody
  claims orbits.
- **Commands** are verbs with a target (an object, or null for the scene).
  Surfaces (toolbar, inspector, menu, key map) show and run them; the
  extension that owns a verb doesn't know which surfaces exist.
- **Everything acquired through `api`** (layers, overlays, listeners,
  loops, pose holds, presence keys) is the extension's, and goes when it
  stops.

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
  handles: [Handle, ...],              // params to drag in the viewport, optional (below)
  async load() { return (await import("./scene-source.js")).default },
}
```

**Handles.** A number or integer param that is a position along an axis of
the object (a slice's height, a rake's) can be dragged in place:

```ts
type Handle = { param: string, axis: [x, y, z], label?: string }  // axis: in the object's (GLB's) frame
```

While the object is selected (not in the hand, not measuring), the scene
draws a knob for each on the line through the middle of its geometry along
`axis`, at the param's value (from its render doc, else the default), with
its label, and a track over its range. Drag the knob: it follows the pointer
along the line, held to the param's `min`, `max` and `step`; let go and the
value is written to the render doc's params, which rebuilds the object like
any other param change (`src/handles.js`). flow-field's slice (height) and
streamlines (seed height) have one.

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
}

type BuildResult = {
  kind: "glb"
  glb: Uint8Array                                        // glTF 2.0 binary
  meta?: { bounds?: { min: [x,y,z], max: [x,y,z] }, notes?: string }
}
```

`params` passed to `build()` always have every ParamSpec default filled in, so a
provider can add params later without migrating render docs.

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
- Optional **connectors**: `extras.connectors = [{ position: [x, y, z],
  rotation?: [x, y, z], tags?: string[] }, …]` on any node (or on the glTF
  scene), in that node's frame: places where something goes. `rotation`
  (Euler XYZ, radians) is the connector's frame; the hand turns whatever it
  puts there to face where that frame turns +Z, seen from above (so a card in
  the far player's column reads right for them), and keeps the rest for
  whatever comes to use a whole frame (a CAD mate, say). A connector with
  `tags` takes only objects whose `tags` share one (none: anything), as
  Tabletop Simulator's tagged snap points do. The older `extras.snapPoints =
  [[x, y, z] | { position, yaw }, …]` (yaw in radians about +Y) are read as
  untagged connectors. Optionally `extras.snapRadius` (metres, in the GLB's
  frame). When the hand puts something down near one — the centre of its
  footprint within the radius, in plan — it goes there; height is still
  decided by what is underneath, so pieces stack on a board's spaces. Without
  a radius it is 0.71 × the closest spacing between the points, so every part
  of a square grid's cell, corners included, snaps to that cell. Malformed
  connectors are ignored.
- Optional colour legend: put `extras.legend = { title, unit, min, max, stops }`
  on a mesh, `stops` being 2–32 `#rrggbb` colours spaced evenly from `min` to
  `max`. The scene draws it as a bar with three ticks. Anything else in it is
  ignored, and a legend that doesn't check out is simply not shown.

### The encoder

`src/glb.js` is a dependency-free GLB encoder. **Copy it** into your package
(never import across packages). Its API is documented at the top of the file:

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
    deps?: { [url: AutomergeUrl]: string[] }   // each dependency's sorted heads, as read; {} when none
  } | null,
  builtAt: number | null,
  status: "idle" | "building" | "error",
  error: string | null,
  pinned: boolean                   // true = never auto-rebuild
}
```

- `paramsKey` is JSON of `params` with keys sorted at every level.
- **Stale** iff `builtFrom` is null, or `paramsKey` differs, or (provider has a
  fingerprint ? `fingerprint(source) !== builtFrom.fingerprint` : sorted source
  heads ≠ sorted `builtFrom.heads`), or the provider's current dependency URLs
  differ from the keys of `builtFrom.deps`, or any dependency's sorted heads
  differ from the recorded ones. A render doc without `deps` (built before
  dependencies existed) counts as `{}`, so a provider that starts reporting
  dependencies rebuilds each of its renders once. A dependency that isn't
  loaded counts as having no heads (`[]`).
- Every build makes a **new immutable GLB file doc** and repoints `glbUrl`:
  `{ "@patchwork": { type: "file" }, name: "<title>.glb", extension: "glb",
  mimeType: "model/gltf-binary", content: Uint8Array }`. Superseded GLBs are
  simply orphaned.
- The previous GLB stays on screen while the next one builds.
- A failed build records `status: "error"` and `error`, and is not retried until
  its inputs change (or someone presses Rebuild).
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
  objects: { [objectId]: Object | Group },
  order: string[],                  // objects and groups, as the outline lists them
  dimensions: { [id]: { a: Anchor, b: Anchor, label: string | null } },
  // defaults for each viewer (each can change their own): display, snapping, the starting tool
  view: { units: "m" | "cm" | "mm" | "in" | "ft", grid: boolean, axes: boolean, bounds: boolean,
          snap?: boolean,                                  // the hand snaps (absent = true)
          defaultMode?: "move" | "rotate" | "hand" | "select", // the tool a viewer starts with (absent = move)
          kits?: string[],                                 // the kits a viewer starts with (absent = ["model"])
          panels?: string[],                               // the sidebar panels that start open, in order (absent = all)
          home?: { position, target, fov? } },             // where a viewer with no saved camera starts
  camera: { position: [x,y,z], target: [x,y,z] } | null,  // older docs: a home view, read only
  traits?: { [key: string]: any },  // extensions' data on the scene itself
  materialRules?: MaterialRule[]
}
Object = {
    kind?: "object",                // absent = an object
    name: string,
    sourceUrl: AutomergeUrl | null, providerId: string | null,
    renderUrl: AutomergeUrl | null, // null: passthrough (shown from sourceUrl)
    visible: boolean, color: string | null, opacity: number, wireframe: boolean,
    transform: { position: [x,y,z], rotation: [x,y,z] /* Euler XYZ, radians */, scale: number },
    parent?: string | null,         // the object it's attached to (never a group); absent = null
    group?: string | null,          // the group it's filed in; absent = none
    infoUrl?: AutomergeUrl | null,  // a document about it, any datatype (the About section)
    infoToolId?: string | null,     // the tool to show it with; absent = the shell's default
    locked?: boolean,               // true: the hand and the gizmo leave it where it is
    tags?: string[],                // what tagged connectors it fits (GLB conventions, below)
    traits?: { [key: string]: any }, // extensions' data, "<extension>.<name>" (Extensions, above)
    hint?: { bounds?: { min: [x,y,z], max: [x,y,z] }, triangles?: number, bytes?: number }
}
Group = {
    kind: "group", name: string,
    group?: string | null,          // the group it's in; absent = none
    visible: boolean, opacity: number,
    infoUrl?: AutomergeUrl | null, infoToolId?: string | null,
    traits?: { [key: string]: any },
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
- **Groups** (`kind: "group"`) organise: no geometry and no transform.
  Hiding a group hides everything filed in it (at any depth), and its opacity
  multiplies into everything filed in it. A group is never picked, never a
  parent and can't anchor a dimension; its box (Frame, selection, the gizmo's
  pivot) is the union of what's shown inside it. Moving it with the gizmo
  writes each member's transform. A loop of groups (two concurrent edits) is
  broken the same way on every peer, like an attachment cycle.
- **Older scenes**, whose groups were parents with transforms, are upgraded
  the first time a current scene tool opens them (`src/migrate.js`): each
  object is filed in the nearest group it was under, attached to the nearest
  object it was under, and keeps its world pose (what the groups between
  contributed is baked into its transform). `view.defaultGizmo` becomes
  `view.defaultMode`.
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
- The camera is each viewer's own, kept in this browser per scene. A viewer
  with no saved camera starts at `view.home` (set with *Set home view*),
  else at an older doc's `camera`, else framing what's there. Orbiting never
  writes the doc.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/datatype.js` | the two datatypes |
| `src/stage/` | the stage: `stage.js` (mount, doc loop, the api each extension gets), `viewport.js` (renderer, camera rig, picking, layers, labels, poses), `router.js` (DOM input → events, the chain, sessions, arming, pointer lock, keys), `presence.js` (the presence protocol, sends, pose holds), `host.js` (starting and stopping extensions), `activation.js` and `chain.js` (pure: what runs, in what order, who hears an event), `atom.js` (the local value) |
| `src/parts/` | the model kit's extensions, one module each (with its CSS and tests): `select`, `gizmo`, `hand`, `handles`, `measure`, `dimensions`, `grid`, `axes`, `bounds`, `units`, `legends`, `frame`, `toolbar`, `sidebar`, `keys`, `menu`, `notices`, `outline`, `inspector`, `add`, and `kits` (always on) |
| `src/ops.js` | pure doc planners for structural edits (remove, group, ungroup, file in, attach, move a row, set a transform): a snapshot in, a change function out |
| `src/gltf-content.js` | GLB bytes → display-ready content: the shared loader (meshopt), dequantizing, default-material detection, material rules, InstancedMesh collapse |
| `src/pick-accel.js` | lazy three-mesh-bvh for big meshes (built in idle time or on the first ray that crosses one) |
| `src/render-manager.js` | per-object watch / stale / debounce / build / load loop (render-doc objects) |
| `src/glb-queue.js` | the load queue for passthrough objects: priority, ≤ 4 finds, 1 parse at a time, retries, subscriptions |
| `src/groups.js` | groups: inherited visibility / opacity, remove / ungroup plans, the outline's rows and filter |
| `src/material-rules.js` | `materialRules`: checking and matching |
| `src/deps.js` | watches a provider's dependency docs (subscribe, retry, heads) |
| `src/build.js` | one build: provider → GLB file doc → repoint render doc |
| `src/controls-tool.js`, `src/param-form.js` | the `scene-render-controls` tool |
| `src/glb.js` | the GLB encoder (copy me) |
| `src/stl.js`, `src/sources/*` | STL parsing and the two file providers |
| `src/staleness.js`, `src/units.js`, `src/anchors.js`, `src/providers.js`, `src/dnd.js` | pure logic, unit-tested |
| `src/transform.js`, `src/hierarchy.js` | transform matrices (compose / decompose / invert) and attachment (world matrices, cycle checks, re-parenting that keeps the world pose) |
| `src/migrate.js` | upgrading a scene doc written in an older shape, in place, on open (the stage's own; extensions upgrade their own fields) |
| `src/hand.js` | the hand's pure parts: connectors (rotation, tags), default radius, nearest snap, footprint samples, resting height |
| `src/handles.js` | handles: a provider's params dragged in place (which ones, where, the pointer → a value) |
| `src/tree-drop.js` | where a drag lands in the outline: which band of a row means inside vs beside, and what parent and sibling that comes to |
| `probes/` | browser probes, each a page that mounts the BUILT tool against an in-memory repo plus a runner that drives it in headless Chrome over CDP with a real mouse and keyboard (`cdp.mjs` is what they share): `editor-probe.html` + `editor-run.mjs` the editor (the model kit) between two peers; `hand-probe.html` + `hand-run.mjs` carry pieces with the hand, and a scene extension of the page's own; `drag-probe.html` + `drag-run.mjs` drags into and within the outline; `solander-probe.html` + `solander-run.mjs` load a 507-object imported scene of real GLBs and measure it; `make-example-scene.mjs` writes `solander-scene.example.json`, a portable stand-in for the importer's scene; `publish-example-scene.mjs` uploads it to a real sync server |

### The editor probe

```
pnpm build
node probes/editor-run.mjs     # --show to watch, --shots <dir> for the screenshots
```

Two views of one doc (A, and a small B; each one's broadcasts reach only the
other): a locked 5×5 board with connectors, three blocks, two pawns, and an
STL file in the repo. A real mouse and keyboard over CDP check the layout
(toolbar along the top in one row, the sidebar at the right with Objects, then
Dimensions, the canvas filling the rest); a click selects (the outline row is
marked, the inspector shows it, B draws A's selection box and marks the row);
Escape and a click on nothing deselect; G / R / H and the toolbar's buttons
switch tools, Grid / Axes / Bounds toggle (per viewer, never the doc); a drag
on the gizmo's X arrow (found by hovering) moves a block, B seeing the pose
mid-drag and then the landed transform; the hand carries a block onto a
connector, Q turns it 45°, Esc puts it back, Alt puts one down between
connectors; dragging the locked board orbits and writes nothing; F frames
everything; M and two clicks on the board write a 24 cm dimension (label on
the canvas and in the panel); Delete removes the selection; P hides and shows
the sidebar; a double-click frames an object; a right-click opens the menu
(Select and Remove work); the Kits button turns Model off (no toolbar, no
sidebar, the canvas fills the view) and on again; pasted automerge URLs add a
GLB and the STL, which builds, shows 20 mm bounds in mm, and rebuilds at
200 mm when its unit param changes in the inspector's embedded controls; an
object attached through the inspector keeps its world pose and follows its
parent's gizmo drag. Paste is the one synthetic event (headless Chrome won't
give a page the system clipboard).

### The hand

```
pnpm build
node probes/hand-run.mjs        # --show to watch, --shots <dir>
```

Two scene tools on one doc (each one's broadcasts reach only the other, and
`element.viewerId` makes them two viewers), a locked 5×5 board GLB with
`extras.snapPoints`, four blocks, two pawns, a tray and three cards, and a
`scene:extension` the probe page registers itself (a stand-in for tabletop's,
which this package can't import): a lens that shows a card's face to whoever
sits at the tray (a scene trait) when it's in the tray and to everyone when
it's face up, a Shuffle command on S, a landing hook that turns a card face up
over the tray, and a panel. A real mouse over CDP carries a block onto a space
released off-centre (it snaps, and rests on the board; the other peer sees it
in the air, then where it landed), stacks two more blocks on it, puts a pawn
down with Alt (exactly where dropped), another off the board (on the ground),
drags the locked board (it stays; the camera orbits) and cancels a carry with
Esc. Then the extension: its panel is in the sidebar; with nobody seated both
viewers show both cards' backs; once A sits, A shows the card in the tray as
itself and B still its back; S over a pile of two face-down cards runs its
command; a face-down card is carried, turned over with F and put down, and
both show its face; another carried into the tray lands face up, seen by A
alone.
Last, the gizmo with a real drag on its X arrow: B sees the block move
before the doc does, then the written pose; and on a group's pivot, both
pawns move by the same amount. The page's extension is written to
[STAGE.md](STAGE.md)'s contract (`looks`, `landing`, commands with `state`,
`panels`, `api.notify`).

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
