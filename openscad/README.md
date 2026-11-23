# OpenSCAD

A `.scad` source editor and live 3D preview for Patchwork, powered by
[OpenSCAD](https://openscad.org) compiled to WebAssembly (OpenSCAD's own
nightly build, vendored). Everything runs client-side — there is no server
component and no CDN.

Ported from the spirit of [openscad-playground](https://github.com/openscad/openscad-playground),
scoped down to the essentials for a first version: a plain-text editor, a
render button (+ debounced auto-render), a 3D viewer, and an error/log
console. No customizer panel and no bundled community libraries (BOSL2 etc.)
yet — see "Possible follow-ups" below.

## How it works

- The `.scad` source lives in the document's `source` field and is edited
  collaboratively via CodeMirror + `@automerge/automerge-codemirror` (same
  approach as the `file` tool's text editor).
- **The engine ships with the package.** OpenSCAD 2026.11.20 (Manifold
  3.5.4), the official WebAssembly nightly, is vendored in
  `vendor/openscad-2026.11.20/` (`openscad.js` + an 11 MB `openscad.wasm`) and
  the build copies it, checksum-checked, into `dist/openscad-2026.11.20/`. The
  engine chunk resolves those files against its own URL
  (`src/render/engineFiles.ts`), so it loads wherever the package does, with
  no CDN. Why vendored, and how to update it: `vendor/README.md`.
- Rendering happens in a persistent Web Worker (`src/render/worker.ts`). It
  fetches and compiles the wasm once, then for each render instantiates that
  compiled module afresh, writes the source to its in-memory filesystem, runs
  `callMain(["/input.scad", "--backend=manifold", "--export-format=off",
  "-o", "/model.off"])` (arguments built in `src/render/args.ts`), and parses
  the OFF there into triangles grouped by colour (`src/render/model.ts`).
- **Manifold.** Selected with `--backend=manifold`; CGAL is still OpenSCAD's
  default. On a plate with 64 holes and a row of spheres (`$fn = 48`), in
  Chrome against the vendored engine, CGAL takes ~52 s and Manifold ~0.26 s.
  (`--enable=manifold` is not a feature: OpenSCAD ignores it with a warning
  and renders with CGAL.) Moving from the npm `openscad-wasm@0.0.4`
  (OpenSCAD 2025.07.18, Manifold 3.1.1) to this engine changed speed little
  (±25% either way on four benchmark models); Manifold 3.2–3.5 is about
  correctness: deterministic output across platforms, colour (`originalID`)
  tracking fixes, robustness, and error propagation.
- **One cache for the whole bundle.** `renderScad()` in `src/render/engine.ts`
  keeps the last 8 results, keyed by the source text plus each import's name,
  JSON and OpenSCAD source, and a request whose key is already rendering joins that render
  instead of starting another. The editor and the scene provider both call it,
  so with both open on a doc the source compiles once. Failures aren't cached
  (a crashed worker or failed engine download is worth retrying). A cache hit
  shows as "(cached)" in the editor's status line.
- The viewer draws the triangles as one three.js geometry with a group and a
  material per colour, under `OrbitControls`.

## Colours

`color()` shows in the viewer, in a scene, and in the 3MF download.

- The engine exports **OFF**, which carries an RGB(A) colour per face. (It
  can write 3MF too, but see below for why the tool writes its own; the npm
  `openscad-wasm@0.0.4` this tool used before crashed on 3MF.) On the
  Manifold backend colours survive
  CSG: the faces a coloured `difference()` cuts take the cutter's colour, as in
  OpenSCAD's own preview.
- OpenSCAD gives faces without `color()` its default colour, `#f9d72c`. Faces
  of exactly that opaque colour read as *uncoloured*, so a part with no colour
  keeps the viewer's grey (and the scene's default material) rather than going
  yellow. The cost: an explicit `color("#f9d72c")` reads as none too.
- **Download 3MF** is written by this tool (`to3MF` in `src/render/model.ts`):
  one closed mesh object (vertices shared across colours, so a slicer sees one
  solid), colours as core-spec `basematerials` with a `displaycolor` each, and
  a pid/p1 on every triangle. A model without colours has no materials; in one
  with some, uncoloured triangles get `#F9D72C`, as OpenSCAD's own 3MF export
  does, because the spec gives triangles of a coloured object no way to have
  none. lib3mf (OpenSCAD's `import()`) reads it back with the same triangles
  and colours.
- **Download STL** is the same triangles without colours.
- Alpha below 1 is kept: a translucent material in the viewer, `alphaMode:
  BLEND` in the scene's GLB, `#RRGGBBAA` in the 3MF.

## Importing data from other Automerge documents

Drag any Patchwork document onto the "Imports" bar above the editor to make
its data available inside your `.scad` source as JSON.

- Dropping a doc adds `{name, docUrl, label}` to `doc.imports`. `name` is a
  sanitized, deduped identifier derived from the doc's title (click it to
  rename).
- Each imported doc is resolved once via `element.repo.find()` and kept live
  (`src/importResolver.ts`). On every render it is reduced to plain JSON
  (dropping any `@`-prefixed Patchwork metadata keys) and written into the
  WASM engine's virtual filesystem as `/imports/<name>.json`.
- A render waits for imports that are still loading (up to 5 s, like the scene
  host), so opening a doc doesn't first compile with `{}`, flash an error, and
  compile again. An import that fails to load, or takes longer than that,
  binds to `{}`.
- A failed `repo.find()` is retried with backoff (1 s, 2 s, 4 s, … up to 30 s)
  for as long as the import is attached; when the doc arrives, the editor
  re-renders.
- A generated binding — `<name> = import("imports/<name>.json");` for every
  active import — is joined onto the first line of your source before
  compiling, so `<name>` is just a normal variable by the time your code runs
  (see the
  [OpenSCAD JSON import docs](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Importing_Geometry#Importing_JSON)
  for the resulting object/array shape and dot-access semantics). `import()` of a
  `.json` file is standard in this OpenSCAD; no feature flag.
- Imports are live: editing the source doc re-resolves and re-renders
  automatically, same as editing the `.scad` text itself.
- The bindings share your first line rather than getting one of their own, so
  reported error and warning line numbers are the lines in your source.

### Including a linked document: `include <x.scad>` and `use <x.scad>`

A linked document can also be OpenSCAD source. `include <register.scad>` and
`use <register.scad>` read the import named `register`, live, and a file
document named `parts.scad` is found by `include <parts.scad>` whatever its
import is called. Imports are the only place these paths resolve: an include
names an attached document, never a file in the folder.

A linked document's source is, in order:

1. what its datatype gives for `asSource(doc, "scad")`: the plugin registry is
   asked for the datatype named by the doc's `@patchwork.type`, and if its
   implementation has `asSource` and it returns a string, that is the source
   (anything else, or an error, moves on or is reported);
2. a file document's text;
3. otherwise nothing, and an include of it fails with a message naming the
   import and why it has no OpenSCAD source (for instance, its datatype has no
   `asSource`, or it is a binary file).

OpenSCAD documents give their own source this way, so one OpenSCAD document
linked into another is a library: `use <brackets.scad>` makes its modules and
functions available without running its top-level geometry, and `include`
runs it too.

Every import is still bound as JSON as above, whether or not it has source.

An include that matches no attached document fails the render (OpenSCAD itself
only warns, and carries on with every name undefined) with a message that says
how to attach it: drag the document onto the Imports bar above the editor, and
name it for the include (`register` for `<register.scad>`).

An edit inside an included document re-renders, in the editor and in a scene.
The render cache key includes the included source, so a changed register never
shows a stale render.

#### For agents

To use a document's data as OpenSCAD source (the assumptions register, say):

1. Attach it: add `{name: "assumptions", docUrl: "<its automerge url>",
   label: "Assumptions"}` to the OpenSCAD doc's `imports` with doc_edit. The
   name is what the include uses: `<assumptions.scad>` reads the import
   `assumptions`.
2. Write `include <assumptions.scad>` (variables and modules in scope) or
   `use <assumptions.scad>` (modules and functions only) in the source. Don't
   paste the register's lines into the CAD file: the include is live.
3. Its values are also available as JSON, `assumptions.<key>`, with no include.

A render that says `matches no attached document` means step 1 is missing; one
that says `has no OpenSCAD source` means the document's datatype can't be
written as OpenSCAD, so use the JSON binding instead.

## In a 3D scene

The package also registers a `scene:source` provider, `openscad-model`, so an
OpenSCAD doc can be dropped into a Patchwork scene (the `scene` package). It
lives in `src/scene/`:

- The plugin entry in `src/index.ts` is plain data apart from `load()`,
  because the scene host reads the `plugins` array in a worker. `build()`
  itself runs on the main thread, and the render engine it calls starts its
  own worker for OpenSCAD.
- `build()` runs the same engine as the editor (same worker, same cache, same
  import binding: each `doc.imports` entry is fetched with `repo.find()` and
  bound as JSON and, when it has OpenSCAD source, made includable (see
  above); an unavailable one binds to `{}` with no source, and the host
  retries dependencies that haven't loaded) and encodes a GLB with flat per-face
  normals: one mesh, one primitive per colour, uncoloured triangles without a
  material. OpenSCAD is Z-up and unitless; the `unit` param
  (default millimetres) scales to metres and `(x, y, z)` becomes `(x, z, -y)`
  for glTF's Y-up.
- The provider keeps no cache of its own; the engine's shared cache means
  changing `unit` re-encodes without running OpenSCAD again, and a render the
  editor already did is reused.
- `cost: "expensive"` (a source edit re-runs OpenSCAD), while the `unit` param
  is `cheap`. The host clamps params to their spec before `build()`.
- `fingerprint()` hashes the source and the import bindings (name, doc url),
  not the title, so renaming never rebuilds. It describes the inputs only.
- `version` (currently 3: the vendored engine; 2 was colours, 1 the Manifold
  backend) is bumped whenever `build()`
  would make different output from the same doc and params. Renders built by
  an older version (or by none) go stale once; don't change the `scad1:`
  fingerprint prefix for that.
- `dependencies()` lists the imported docs (once each, not transitively,
  since imports are bound as plain JSON or as one source file each), included
  ones among them. The scene host records their heads
  next to the source's, so an edit *inside* an imported doc rebuilds too.
- `src/scene/glb.js` is a copy of the scene package's encoder. Don't edit it
  here; copy a newer one over it.

The worker URL is resolved against the engine chunk (`import.meta.url`), not
the page, so it works when the scene loads this provider. If the bundle is on
a different origin from the page (a dev server), the engine fetches the
worker and starts it from a blob URL, since `new Worker()` refuses
cross-origin scripts.

### Editing it in place

The package also registers a `scene:view`, `openscad-scene-edit`
(`src/scene/editTool.tsx`): the model's **Open** (the scene's `open: true`
convention: the inspector's header button, the object's menu, a double-click
or Enter, in Edit). It puts a hand on the scene's stack, hides the object's
built GLB from this viewer, lays this package's editor over the scene
(`OpenscadEditor` with `hosted`: toolbar, imports, code and console, no 3D
view of its own) and draws each of its renders in the object's place with
the scene's own three.js, a mesh per colour part as the built GLB has them
(none: the body grey), in the object's frame and its build's `unit`
(`src/scene/hosted.ts` `modelFrame`, the GLB's own turn, from `axes.ts`). Every write goes
on the scene's undo through its `edits` service (`hostedHandle`), leaving
Patchwork's `@` keys out; without the service it writes directly. Escape
leaves (a focused code field takes its own Escape first).

## Possible follow-ups

- Customizer panel for OpenSCAD `/* [group] */` parameters.
- Basic `.scad` syntax highlighting in the editor.
- Bundled community libraries (BOSL2, MCAD, ...).
- Fonts, so `text()` works: the engine bundles none ("Can't get font"; it
  never worked here, with the old engine either).
- Export to STEP/OFF too.
- Correct reported error line numbers for the generated imports prelude.

## Develop

```bash
pnpm install
pnpm build            # build dist/
pnpm test             # OFF -> model -> GLB/3MF/STL, fingerprint, dependencies, render cache, import retries
pnpm typecheck
```

## Sync to Patchwork

```bash
pushwork init .       # first time only
pnpm sync             # vite build + pushwork sync (`pnpm push` is an alias)
pnpm register         # register module (needs $MODULE_SETTINGS_DOC_URL)
```
