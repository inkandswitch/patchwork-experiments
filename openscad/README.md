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

## Possible follow-ups

- Customizer panel for OpenSCAD `/* [group] */` parameters.
- Basic `.scad` syntax highlighting in the editor.
- Bundled community libraries (BOSL2, MCAD, ...).
- Export to STEP/3MF/OFF, not just STL.

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
