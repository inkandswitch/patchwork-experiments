# Parametric document type

A `parametric` document is a picture drawn by code from a set of parameters. The document
stores the parameter values and a reference to the source file that draws them. One generic
tool renders the controls and the picture for any such document.

This note is the design. The package in this folder implements it; `README.md` says how to
install and develop it.

## Reference tools

The type must express each of these without loss, except where this note says otherwise.

| Tool | Location | Surface | State shape |
|---|---|---|---|
| harmonograph | `../harmonograph/index.html` | SVG, 600×600 px | One global value and a list of frequency sets with add and remove. |
| catenoid | `../catenoid/index.html` | Canvas 2D, fills the viewport | Flat scalars, split into geometry and view buckets. The 3D reference; harmonograph's HUD is a port of its HUD. |
| thing-grids | `../thing-grids/grid-generator.html` | Canvas 2D in mm, PNG export at a dpi | About 60 flat scalars with a family discriminator, conditional visibility, dynamic notes, and multi-key presets. |
| coln-type | `../coln-type/` | Canvas 2D on screen, SVG export | About 35 scalars plus authored geometry (`masks`, `merges`, `tw`) drawn by clicking the canvas. |
| lattice | `../patchwork-pkg-lattice/grid-builder/` | Canvas 2D, Patchwork tool | The existing Patchwork port of thing-grids. Values at the doc root, schema in `render.js`, schema-driven control builders. |

The renderer's visual direction comes from `../patchwork-sketches/` and its Patchwork theme in
`../patchwork-pkg-lattice/sketches-theme/`. See [Renderer design direction](#renderer-design-direction).

## The document

```js
/**
 * @typedef {Object} ParametricDoc
 * @property {string}  [title]        Set only when someone renames the document.
 *                                    Otherwise the title comes from titleTemplate.
 * @property {number}  schemaVersion  Version of this shape. Starts at 1.
 * @property {Source}  source         Where the drawing code lives. See The source file.
 * @property {number}  sourceVersion  The source's exported version at the last copy.
 * @property {string}  [titleTemplate] "{key}" placeholders filled from values, for example
 *                                    "Grid {pattern}, {sizeKey}, {spacing}mm". When the param
 *                                    has options, {key} resolves to the matching label, so
 *                                    the title reads "Grid Graph, A6, 5mm". Copied from the
 *                                    source at creation. getTitle is synchronous, so the
 *                                    title cannot come from code.
 * @property {Output}  output         Copied from the source at creation.
 * @property {Param[]} params         Copied from the source at creation. Display order.
 * @property {Object.<string, Value>} values  One entry per design-bucket param key.
 * @property {Preset[]} presets       Named starting points. Copied from the source.
 */

/**
 * @typedef {Object} Source
 * @property {string}   url     automerge: URL of a pushwork directory doc.
 * @property {string}   path    File inside that directory, for example "harmonograph.js".
 * @property {string[]} [heads] Heads of the file doc. When set, the renderer imports that
 *                              version and ignores later edits. Directory entries carry
 *                              no heads, so pinning the directory URL would freeze nothing.
 */

/**
 * @typedef {Object} Output
 * @property {Array<"canvas2d"|"svg">} surfaces  What render() can draw to. The renderer
 *                                    uses canvas2d on screen and svg for export when
 *                                    each is offered.
 * @property {"px"|"mm"} unit         Coordinate unit render() draws in.
 * @property {number|null} width      In unit. null fills the viewport.
 * @property {number|null} height
 * @property {number} dpi             Raster export resolution. Meaningful for mm.
 * @property {string} background      CSS colour behind the drawing.
 * @property {boolean} animated       Call render() every frame with surface.t.
 */

/**
 * A parameter. Plain JSON, no functions, so any tool can read it without loading code.
 *
 * @typedef {Object} Param
 * @property {string} key              Name in values and in the source.
 * @property {string} label
 * @property {"num"|"int"|"bool"|"str"|"color"|"list"|"data"} kind
 * @property {"number"|"range"|"seg"|"select"|"tiles"|"checkbox"|"color"|"text"|"list"|"none"} [control]
 *                                     Defaults: num→number, str→select, bool→checkbox,
 *                                     color→color, list→list, data→none.
 * @property {"design"|"view"} [bucket] Default "design". View values never enter the
 *                                     document; the renderer keeps them in local state.
 * @property {Value}  default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]           Display suffix. A "mm" param is shown converted when
 *                                     the view unit is inches; the stored value stays mm.
 * @property {Array<[Value,string]>} [options]  For seg, select, and tiles: [value, label].
 * @property {Object.<string,Value>} [thumbnail] For tiles: value overrides used when drawing
 *                                     each option's thumbnail through render().
 * @property {Chip[]}  [presets]       Quick picks under the control. On a color param these
 *                                     are the named inks; a custom colour well is always shown.
 * @property {string}  [layer]         Top collapsible band, for example "Sheet" or "Grid".
 * @property {string}  [section]       Heading inside a layer. Consecutive params with the
 *                                     same section form a group.
 * @property {Condition} [showWhen]    Hide the control unless this holds.
 * @property {string}  [note]          Static help text. Dynamic text comes from notes().
 * @property {Param[]} [item]          For list: the row schema. A row may hold one nested
 *                                     list. Two levels is the practical limit.
 * @property {number}  [minItems]
 * @property {number}  [maxItems]
 */

/**
 * @typedef {Object} Chip
 * @property {string} label
 * @property {Value}  value
 * @property {Object.<string, Value>} [also]  Other keys set at the same time.
 */

/**
 * @typedef {{key:string, eq?:Value, neq?:Value, in?:Value[]} |
 *           {all:Condition[]} | {any:Condition[]} | {not:Condition}} Condition
 */

/**
 * @typedef {number|boolean|string|Array<Object.<string,Value>>|Object} Value
 * num and int are numbers. color is "#rrggbb". list is an array of row objects, stored as
 * an Automerge list so concurrent add and remove merge. data is any JSON tree the source owns.
 */

/**
 * @typedef {Object} Preset
 * @property {string} name
 * @property {Object.<string, Value>} values  Partial. Applied over the param defaults.
 */
```

Patchwork stamps `@patchwork` metadata on every document, so the type has no `type` field of
its own.

### How the renderer reads values

Before calling the source, the renderer builds the `values` object it passes: every
design-bucket param's `default`, then `doc.values` on top. Stored keys with no matching param
are ignored, not deleted. Renaming or removing a param never breaks rendering, and restoring
the param restores its old value.

### Example: harmonograph

```js
{
  schemaVersion: 1,
  source: { url: "automerge:3wXP…", path: "harmonograph.js" },
  sourceVersion: 1,
  titleTemplate: "Harmonograph",
  output: { surfaces: ["svg"], unit: "px", width: 600, height: 600, dpi: 96,
            background: "#fafafa", animated: false },
  params: [
    { key: "d",    label: "damp", kind: "num", default: 0.005, min: 0.0001, max: 0.02, step: 0.0001 },
    { key: "zoom", label: "zoom", kind: "num", bucket: "view", default: 1, min: 0.5, max: 3, step: 0.01 },
    { key: "sets", label: "set",  kind: "list", minItems: 1, item: [
        { key: "f1", label: "f1", kind: "num", default: 3,      min: 0.1, max: 10,     step: 0.001 },
        { key: "f2", label: "f2", kind: "num", default: 3.05,   min: 0.1, max: 10,     step: 0.001 },
        { key: "f3", label: "f3", kind: "num", default: 3,      min: 0.1, max: 10,     step: 0.001 },
        { key: "f4", label: "f4", kind: "num", default: 2.95,   min: 0.1, max: 10,     step: 0.001 },
        { key: "p1", label: "p1", kind: "num", default: 0,      min: 0,   max: 6.2832, step: 0.001 },
        { key: "p2", label: "p2", kind: "num", default: 1.5708, min: 0,   max: 6.2832, step: 0.001 },
        { key: "p3", label: "p3", kind: "num", default: 0.7854, min: 0,   max: 6.2832, step: 0.001 },
        { key: "p4", label: "p4", kind: "num", default: 1.0472, min: 0,   max: 6.2832, step: 0.001 },
        { key: "color", label: "", kind: "color", default: "#ff0000" } ] }
  ],
  values: {
    d: 0.005,
    sets: [ { f1: 3, f2: 4, f3: 3, f4: 3, p1: 0, p2: 1.5708, p3: 0.7854, p4: 1.0472, color: "#ff0000" } ]
  },
  presets: [ { name: "flower", values: { d: 0.005, sets: [ /* … */ ] } } ]
}
```

`zoom` has no entry in `values` because it is a view param.

## The source file

A source is an ES module in a pushwork-synced directory. `pushwork sync` turns the directory
into a directory doc whose entries map each path to a file doc URL. Ordinary entries carry no
heads, and an edited file keeps its URL, so the entry always points at the file's latest
content. Only artifact directories (`dist` by default) get heads-pinned entries.

The renderer resolves the entry itself and imports the file doc pinned at its own heads. The
host's service worker serves `/<encoded url>/` for a file doc by answering with its `content`
and `mimeType`, and the heads in the URL make each edit a new module URL, so the browser's
module cache never serves a stale source.

```js
const dir = await repo.find(doc.source.url);
const file = await repo.find(dir.doc()[doc.source.path]);
const pinned = () => `${location.origin}/${encodeURIComponent(file.view(file.heads()).url)}/`;
const load = () => import(pinned());
file.on("change", () => load().then(rerender));   // edits in the file tool show up live
```

Newer platform versions export `getImportableUrlFromDocHandle` from
`@inkandswitch/patchwork-filesystem`, which builds the same URL. The 0.2.x release the host
ships today does not, so the tool builds it by hand.

Bare specifiers resolve through Patchwork's importmap, which includes
`@inkandswitch/patchwork-filesystem`. Anything else, such as three.js, must be an absolute
`https://` URL. Relative imports between sources are not supported in this version, because
the module URL names a file doc, not the directory. Each planned source is one file, so
nothing needs them yet; importing through the directory path would allow them at the cost
of cache busting.

### Exports

Template exports are copied into the document when it is created. They must be JSON, with no
functions, because they are stored in Automerge and read by tools that never load the code.

| Export | Required | Type | Purpose |
|---|---|---|---|
| `version` | yes | `number` | Bumped whenever `params` change shape. |
| `params` | yes | `Param[]` | The parameter schema. |
| `output` | yes | `Output` | The drawing surface. |
| `presets` | no | `Preset[]` | Starting points. |
| `titleTemplate` | no | `string` | Derived title. |

Code exports run in the renderer.

| Export | Required | Signature | Purpose |
|---|---|---|---|
| `render` | yes | `(values, surface) => void` | Draw the picture. Pure in `(values, view, size)`. Module-scope memo caches keyed by their inputs are fine. |
| `extent` | no | `(values) => {width, height}` | Override `output.width` and `height`. thing-grids computes trim plus bleed. |
| `notes` | no | `(values, view) => Object` | Dynamic text: a caption per param key, `$layer:<name>` for a collapsed layer's summary, `$status` for the docket. |
| `interact` | no | `(event, values, surface) => {values?, view?} \| null` | Pointer events on the picture. Returns a patch to design values, view state, or both. The only way `data` params change. |
| `migrate` | no | `(values, fromSourceVersion) => values` | Bring values written under an older `version` up to the current `params`. |

`surface` has this shape:

```js
{ kind: "canvas2d" | "svg",
  ctx,            // CanvasRenderingContext2D, scaled so 1 unit = output.unit
  root,           // <svg> element for kind "svg", viewBox in output.unit
  width, height,  // in output.unit
  scale,          // device px per unit, for hairline clamping
  dpi,            // export dpi when rendering for export, else the screen's
  export,         // true when rendering for a file; grids maps it to its print option
  t,              // seconds, when output.animated
  view }          // the view-bucket values: zoom, unit, selection
```

Export to file is the renderer's job. If `surfaces` includes `svg`, export serializes
`root`. Otherwise the renderer re-renders offscreen at `output.dpi`.

### Why the document snapshots the template

The source is a shared file that several documents reference, and it is edited in the `file`
tool by anyone who can open it. A mid-edit syntax error is the normal case, not the exception.
With `params` and `output` in the document, the controls keep working and the values keep
their meaning while the source is broken. The cost is a copy that can drift.

When the source's exported `version` is greater than the document's `sourceVersion`, the
renderer offers **Update params from source**. The action runs `migrate(values,
sourceVersion)` if the source exports it, replaces `params`, `output`, `presets`, and
`titleTemplate` with the source's, and records the new `sourceVersion`. Unknown keys in
`values` are ignored rather than deleted, so the action never destroys data.

Important: keep sources out of pushwork artifact directories. Artifact entries are pinned at
heads and only move on the next `pushwork sync`, which is the stale-content trap recorded in
`../patchwork-pkg-lattice/CLAUDE.md`. `parametric/sources/` is an ordinary directory.

### Source files

One pushwork directory, `parametric/sources/`, holds every source, published at
`automerge:3SMAP2oETW1tbwddHTkf6f9JpxTs`. Each is a single file that exports the template
and the code above. `dev/harness.html` drives any of them outside Patchwork.

| File | Lifted from | Size | Exercises |
|---|---|---|---|
| `harmonograph.js` | `harmonograph/index.html` | 110 lines | `list` with add and remove, `color` per row, one view param, SVG surface. Path data matches the original byte for byte. |
| `catenoid.js` | `catenoid/index.html` | 170 lines | Geometry and view buckets, `int` params, canvas surface that fills the viewport. |
| `grids.js` | thing-grids HEAD engine, with lattice's paper tint | 1330 lines, 58 params | `seg`, `select`, `tiles`, `layer` and `section`, `showWhen`, chips with `also`, `notes`, `extent`, mm unit with dpi export. Pixel parity with thing-grids on six configurations. |
| `coln-type.js` | `coln-type/src/js/*.js` | 1250 lines, 35 params | `range`, `checkbox`, `data` with `interact` (Dots mode), both surfaces. The solver settles synchronously, so `animated` is false. Select and Strokes modes, per-selection sliders, and own-sizes are deferred; the file header lists them. |

Note: thing-grids has six calligraphy commits past lattice's frozen `reference/` copy, so
`grids.js` starts from lattice's `render.js` and takes those commits from thing-grids HEAD.

A first `coln-type.js` carries the global sliders as params and the drawn geometry as one
`data` param. Its per-selection editing stays inside `interact`. See the next section.

## Two hard cases

**Lists of records.** Harmonograph's frequency sets and thing-grids' planned line families
are variable-length arrays of records. A flat key-to-value map cannot hold them. `kind: "list"`
with `item` covers both: the renderer draws one group per row plus add and remove, and stores
the value as an Automerge list. A row may hold one nested list, which thing-grids needs for a
family's cycle entries.

**Authored data.** Coln-type's `masks`, `merges`, `tw`, and per-cell stretch are drawn by
clicking circles on the canvas, and its Selection sliders write to whichever cells are
selected. Generic controls cannot edit a value whose target is the current selection.
`kind: "data"` is the seam: an opaque JSON value the source owns, changed only through
`interact`, which can also patch view state so a click can select. The global sliders are
ordinary params; the selection editing is not.
Two later extensions, neither in the first version: a `scope: "selection"` flag that routes a
control's writes through `interact`, or letting the source draw its own controls.

## Relationship to lattice

Lattice is the same idea one step earlier. Values sit at the doc root, the schema lives in
`render.js`, and `tool.js` already builds controls from specs through a `BUILDERS` map. The
parametric type moves the schema and the code out of the tool and into documents, so one tool
opens a harmonograph and a grid sheet alike.

| Lattice | Parametric |
|---|---|
| Root fields such as `spacing` and `ink` | `values` |
| `URL_FIELDS` and `GRIDS[pattern].params`, with functions | `params`, functions flattened to `min`, `max`, `showWhen`, `presets` |
| `render(ctx, scale, opts)` over module-scope `S` | `render(values, surface)` wrapping `setState({...surface.view, ...values})` |
| `describe(doc)` in `datatype.js` | `titleTemplate` |
| `layers()` and the key sets in `tool.js` | `layer` and `section` on each param |
| `familyControl` thumbnails | `control: "tiles"` with `thumbnail` |
| Named `INKS` and the custom well | `presets` on a color param |
| `VIEW_DEFAULTS`, `preview`, commit on intent | View-bucket params and the renderer rules below |

The generic renderer starts from lattice's `tool.js`, which is visually ahead of thing-grids,
and generalizes it: read specs from the document instead of `render.js`, add the `range`,
`checkbox`, `list`, and `tiles` builders.

## Renderer design direction

These are renderer rules, not document fields, but `layer`, `tiles`, and colour chips exist
because of them.

- **Elevation by relationship.** Controls are part of the tool's surface, so they sit flush:
  no box, no fill, type and space do the grouping. The picture is a guest of that surface, so
  it is raised: a card with the sketches 1 px stroke and 1 px drop in one colour. Nothing
  nests a well in a well. A mm picture depicts paper and keeps square corners; a px picture
  takes the nested radius.
- **Layers, groups, fields.** A layer band has a hairline above, an 11 px uppercase head, a
  faint mono index, and when collapsed a mono summary from `notes()`. Groups have a 10 px
  uppercase faint heading and hide when every field in them is hidden.
- **Controls.** `seg` as wrapping pills with the accent as the selected surface. `tiles` as a
  three-up grid of thumbnails drawn through `render()`, selected by an accent ring; tiles
  degrade to labelled buttons when the source fails to import. `number` and `select` with a
  visible 1 px edge and mono digits. Chips in 10 px mono with no chrome. Colour as round named
  swatches plus one square custom well.
- **Docket.** A bottom chrome strip in mono: `$status`, the unit toggle, the scale.
- **Theme tokens only.** Every colour derives from `--editor-*` and the `--elevation-*`
  tokens the sketches theme adds, with fallbacks, inside a
  `@layer package { :root, :host, [theme] { … } }` block.
- **Commit on intent.** Controls hold an in-flight value locally and call `handle.change` on
  blur, pointer up, or Enter. A drag is one history entry, not a hundred. View values are
  never written.

## Known losses

- thing-grids' unit-aware chip lists become one flat list. The renderer converts labels to
  the view unit, and inch-native pitches are extra chips.
- Coln-type's per-selection editing stays inside the source.
- Coln-type's build number in export filenames is replaced by the document's heads.
- Harmonograph's "+ add set" picked a random colour. A list row default is fixed, so every
  new set starts red until the renderer offers a random-colour chip.

## Open decisions

Each with a recommendation.

1. **Presets in the document or in separate documents.** In the document for the first
   version. A shared family document that several designs reference is lattice's later plan
   and does not change this shape.
2. **Shared source, many documents.** A source change lands under every document that
   references it. The `version` export, `migrate`, and **Update params from source** handle
   it. Set `source.heads` when a document must not move.
3. **WebGL.** A third entry in `surfaces` that hands over the canvas element. Deferred; nothing
   in the reference set needs it.
4. **Bundled or bundleless renderer.** Bundleless unless its size forces a build. Editing the
   source needs no code here because the `file` tool already edits file docs, and "open with"
   puts the source beside the picture.
