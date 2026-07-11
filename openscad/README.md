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
  writes the source to the engine's in-memory filesystem, runs
  `callMain(["/input.scad", "--enable=manifold", "-o", "/model.stl"])`, and
  reads back the STL bytes.
- The STL is parsed with three.js's `STLLoader` and rendered with
  `OrbitControls` — no `<model-viewer>` / glTF conversion step, keeping the
  pipeline self-contained.

## Importing data from other Automerge documents

Drag any Patchwork document onto the "Imports" bar above the editor to make
its data available inside your `.scad` source as JSON.

- Dropping a doc adds `{name, docUrl, label}` to `doc.imports`. `name` is a
  sanitized, deduped identifier derived from the doc's title (click it to
  rename).
- On every render, each imported doc is resolved via `element.repo.find()`,
  reduced to plain JSON (dropping any `@`-prefixed Patchwork metadata keys),
  and written into the WASM engine's virtual filesystem as
  `/imports/<name>.json`.
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
```

## Sync to Patchwork

```bash
pushwork init .       # first time only
pnpm push             # build + pushwork sync
pnpm register         # register module (needs $MODULE_SETTINGS_DOC_URL)
```
