# OpenSCAD

A `.scad` source editor and live 3D preview for Patchwork, powered by
[OpenSCAD](https://openscad.org) compiled to WebAssembly
([openscad-wasm](https://github.com/openscad/openscad-wasm)). Everything runs
client-side — there is no server component.

Ported from the spirit of [openscad-playground](https://github.com/openscad/openscad-playground),
scoped down to the essentials for a first version: a plain-text editor, a
render button (+ debounced auto-render), a 3D viewer, and an error/log
console. No customizer panel and no bundled community libraries (BOSL2 etc.)
yet — see "Possible follow-ups" below.

## How it works

- The `.scad` source lives in the document's `source` field and is edited
  collaboratively via CodeMirror + `@automerge/automerge-codemirror` (same
  approach as the `file` tool's text editor).
- The ~14MB OpenSCAD WASM engine is **not** bundled with this module. It's
  downloaded from a CDN (jsdelivr, pinned version, with an unpkg fallback) on
  first use and cached in the browser's Cache API, so subsequent loads are
  instant. The official `files.openscad.org` build isn't CORS-enabled for
  cross-origin fetches, so we use the `openscad-wasm` npm package instead,
  which jsdelivr/unpkg always serve with `Access-Control-Allow-Origin: *`.
- Rendering happens in a persistent Web Worker (`src/render/worker.ts`):
  writes the source to a fresh engine instance's in-memory filesystem, runs
  `callMain(["/input.scad", "--backend=manifold", "--export-format=binstl",
  "-o", "/model.stl"])` (arguments built in `src/render/args.ts`), and reads
  back the STL bytes.
- **Manifold.** The pinned `openscad-wasm@0.0.4` is OpenSCAD 2025.07.18 with
  Manifold 3.1.1 (`--version`, `--info`). Manifold is selected with
  `--backend=manifold`; CGAL is still OpenSCAD's default. On a plate with 64
  holes and a row of spheres (`$fn = 48`), run in node against that exact
  build, CGAL took ~60 s and Manifold ~0.2 s. The older `--enable=manifold`
  spelling is *not* a feature in this build: OpenSCAD prints
  `Ignoring request to enable unknown feature 'manifold'` and renders with
  CGAL, which is what this tool did until provider version 1.
- **One cache for the whole bundle.** `renderScad()` in `src/render/engine.ts`
  keeps the last 8 results, keyed by the source text plus each import's name
  and JSON, and a request whose key is already rendering joins that render
  instead of starting another. The editor and the scene provider both call it,
  so with both open on a doc the source compiles once. Failures aren't cached
  (a crashed worker or failed engine download is worth retrying). A cache hit
  shows as "(cached)" in the editor's status line.
- The STL is parsed with three.js's `STLLoader` and rendered with
  `OrbitControls` — no `<model-viewer>` / glTF conversion step, keeping the
  pipeline self-contained.

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
- A single generated line — `<name> = import("imports/<name>.json");` for
  every active import — is prepended to your source before compiling, so
  `<name>` is just a normal variable by the time your code runs (see the
  [OpenSCAD JSON import docs](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Importing_Geometry#Importing_JSON)
  for the resulting object/array shape and dot-access semantics). This uses
  OpenSCAD's experimental `import-function` feature, enabled automatically
  (`--enable=import-function`) only when at least one import is attached.
- Imports are live: editing the source doc re-resolves and re-renders
  automatically, same as editing the `.scad` text itself.
- Because of the generated line, reported error/warning line numbers are
  off by exactly one (not one per import) whenever any import is attached.

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
  bound as JSON; an unavailable one binds to `{}`, and the host retries
  dependencies that haven't loaded), parses the binary STL and encodes a GLB
  with flat per-face normals. OpenSCAD is Z-up and unitless; the `unit` param
  (default millimetres) scales to metres and `(x, y, z)` becomes `(x, z, -y)`
  for glTF's Y-up.
- The provider keeps no cache of its own; the engine's shared cache means
  changing `unit` re-encodes without running OpenSCAD again, and a render the
  editor already did is reused.
- `cost: "expensive"` (a source edit re-runs OpenSCAD), while the `unit` param
  is `cheap`. The host clamps params to their spec before `build()`.
- `fingerprint()` hashes the source and the import bindings (name, doc url),
  not the title, so renaming never rebuilds. It describes the inputs only.
- `version` (currently 1: the Manifold backend) is bumped whenever `build()`
  would make different output from the same doc and params. Renders built by
  an older version (or by none) go stale once; don't change the `scad1:`
  fingerprint prefix for that.
- `dependencies()` lists the imported docs (once each, not transitively,
  since imports are bound as plain JSON). The scene host records their heads
  next to the source's, so an edit *inside* an imported doc rebuilds too.
- `src/scene/glb.js` is a copy of the scene package's encoder. Don't edit it
  here; copy a newer one over it.

The worker URL is resolved against the engine chunk (`import.meta.url`), not
the page, so it works when the scene loads this provider. If the bundle is on
a different origin from the page (a dev server), the engine fetches the
worker and starts it from a blob URL, since `new Worker()` refuses
cross-origin scripts.

## Possible follow-ups

- Customizer panel for OpenSCAD `/* [group] */` parameters.
- Basic `.scad` syntax highlighting in the editor.
- Bundled community libraries (BOSL2, MCAD, ...).
- Export to STEP/3MF/OFF, not just STL.
- Correct reported error line numbers for the generated imports prelude.

## Develop

```bash
pnpm install
pnpm build            # build dist/
pnpm test             # STL -> GLB, fingerprint, dependencies, render cache, import retries
pnpm typecheck
```

## Sync to Patchwork

```bash
pushwork init .       # first time only
pnpm sync             # vite build + pushwork sync (`pnpm push` is an alias)
pnpm register         # register module (needs $MODULE_SETTINGS_DOC_URL)
```
