# Pandoc

Any-to-any document conversion for Patchwork, running entirely in the browser
via [pandoc](https://pandoc.org) compiled to WebAssembly
([pandoc-wasm](https://github.com/pandoc/pandoc-wasm)).

## How it works

- The ~56MB `pandoc.wasm` binary is **not** bundled with the module. It is
  downloaded from a CDN (unpkg, pinned version) on first use, with a progress
  bar, and cached in the browser Cache API so subsequent loads are instant.
- The engine runs in a **Web Worker** (download, instantiation, and
  conversions all happen off the main thread), with a main-thread fallback
  if the worker can't start.
- Inputs can be uploaded files, uploaded folders, or existing Patchwork
  documents — all of them can also be dragged and dropped onto the tool
  (including docs dragged from the sidebar). Each OS file becomes a regular
  Patchwork file doc; the pandoc doc only stores references.
- Dropping a Patchwork doc that isn't a plain file doc opens an outline of
  the document structure so you can pick which value to use as input (e.g.
  a `content` string field), or use the whole doc as JSON.
- One input is the *main* document (click a row to choose); the rest are
  passed to pandoc as resources (images, bibliographies, csl, templates...).
- From/to formats are **detected when an input is added** (by file
  extension) and written to the dropdowns, where they can be overridden.
- **PDF output** works like the official pandoc-wasm demo: pandoc converts
  to Typst markup, then the Typst WASM compiler
  (`@myriaddreamin/typst-all-in-one.ts`, lazy-loaded from a CDN only when
  PDF is requested) compiles it to PDF, previewed inline.
- Results preview inline (rendered HTML, PDF, or source text), and can be
  downloaded or saved back into Patchwork as a file doc (the "Saved" chips
  are draggable into the sidebar).

The conversion core comes from the `pandoc-wasm` npm package; we alias
straight to its internal `src/core.js` (see `vite.config.ts`) so we can
supply the wasm binary ourselves instead of bundling it.

## Develop

```bash
pnpm install
pnpm build            # build dist/
node scripts/smoke-test.mjs   # end-to-end conversion test in Node
```

## Sync to Patchwork

```bash
pushwork init .       # first time only
pnpm push             # build + pushwork sync
pnpm register         # register module (needs $MODULE_SETTINGS_DOC_URL)
```
