# Patchwork Experiments

Experimental, non-core Patchwork tools — the least supported corner of the ecosystem. Read
them for patterns, but expect some to be broken or half-finished.

How to build a tool is covered by the `writing-patchwork-tools` skill from
[patchwork-skills](https://github.com/inkandswitch/patchwork-skills)
(`npx @inkandswitch/patchwork-skills install <dir>`). For polished utility tools you can
reuse — folder, embed, codemirror-base, file, … — look at
[patchwork-pkg-base](https://github.com/inkandswitch/patchwork-pkg-base).

Tailwind is not supported in Patchwork. If a tool here is still using it, remove it and
write plain CSS instead.

## Good reference examples in this repo

**Bundleless (hand-written `.js`, no build):**

- `tic-tac-toe` — the canonical small tool: datatype + tool in one file, JSDoc `@typedef`
  schema, injected `<style>`, proper cleanup
- `word-counter` — a tiny tool-only title-bar plugin (`forTitleBar: true`)
- `writing` — live-preview markdown editor; hand-rolled CodeMirror⇄Automerge splicing with
  a minimal-diff reconcile

**Solid + TypeScript, vite-bundled (the house style):**

- `editable-llm-chat` — compact, complete datatype + tool in one module (~400 lines)
- `openscad` — mid-size package with a clean `index`/`datatype`/`tool` layout (wasm +
  Three.js preview)

**Specialties:**

- `inspector` — title-bar tool that opens on ANY document (`supportedDatatypes: "*"`)
- `codemirror-latex` — a `codemirror:extension` plugin (KaTeX live preview), not a full tool
- `call` — ephemeral multiplayer via `handle.broadcast` (WebRTC signaling); advanced, large
- `themes` — bundleless `patchwork:theme` plugins
- `actions` — headless `patchwork:action` plugins with a zod `argsSchema`

**React — reference for behavior; only copy the approach if the user asked for React:**

- `datagrid` — small React datatype + tool (Handsontable spreadsheet)
- `todo` — React todo list that also registers a `patchwork:skill`
