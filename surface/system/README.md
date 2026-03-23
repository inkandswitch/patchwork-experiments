---
name: system
description: For LLM agents editing the surface system root—`bootstrap.js` entry (nested `ref-view` only), `solid.js` shared helpers, and package exports. Canvas schema and toolbar live under `paper/`.
---

# System (root)

You are working on the thin host shell: `bootstrap.js` and `solid.js`. The interactive canvas is implemented in `paper/paper.js`; do not merge that logic back into `bootstrap.js`.

**Your responsibilities when changing this tree**

- `package.json` exports `./bootstrap` and `./solid`. The Patchwork host loads `bootstrap.js` as the tool URL for the frame document (`surface/tool` uses the automerge filesystem path ending in `bootstrap.js`). Keep that filename stable or update `tool.ts` / synced assets together.
- `bootstrap.js` **only** default-exports `mount(element)`: it renders a single child `<ref-view>` whose `ref-url` is `element.ref.url` and whose `tool-url` resolves to `paper/paper.js`. It does **not** call `ref.as()` or define `schema` / `init`; document defaults are created when `paper/paper.js` runs `ensurePaperDocument` via per-path `.as(schema).value()` (see `ref.ts` `value()` lazy init for non-root paths).
- `solid.js` re-exports Solid primitives and defines `useRef(ref)`—Automerge subscription + `reconcile` into a Solid store. System modules under this tree should import from here.

## Examples

- **Change which canvas tool loads first:** Edit the `paperToolUrl` in `bootstrap.js` if you fork the canvas into a different module; keep a single child `ref-view` unless you intentionally compose multiple layers.
- **Share Solid across tools:** Import `render`, `html`, `For`, `useRef`, etc. from `../solid.js` (or `./solid.js` from `bootstrap.js`).

## Guidelines

- Do not reintroduce `schema` / `init` on `bootstrap.js`; the datatype creates an empty frame doc with `repo.create()` and lets `paper/paper.js` fill `shapes`, `selectedTool`, and `selectedShapes`.
- When adding a new top-level key on the frame document, add a dedicated schema + `.as(...).value()` in `paper/paper.js` `ensurePaperDocument` (root path cannot be replaced via `Ref.change(() => value)`).
- Toolbar registration and `TOOL_NAME` contracts are documented in `paper/README.md`.
