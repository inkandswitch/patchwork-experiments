---
name: writing-patchwork-tools
description: >-
  Build, scaffold, or modify a Patchwork tool, datatype, or action in this repo.
  Use whenever creating a new tool from scratch, porting something into Patchwork,
  adding a datatype/tool/action plugin, wiring an automerge document model, or
  setting up the build/sync (vite + pushwork). House style: write tools in plain
  vanilla JavaScript with NO TypeScript; if a reactive framework is truly needed,
  use Solid (never React). Covers the plugin registration shape, the
  (handle, element) => cleanup render contract, the datatype lifecycle, bundleless
  vs bundled builds, multiplayer/ephemeral messaging, the importmap, and the common
  gotchas (undefined assignment, Solid click delegation, light-DOM CSS).
---

# Writing Patchwork Tools

A Patchwork tool is a **plugin module** that registers one or more plugins and renders a
view into a host-provided DOM element. The host (Patchwork) supplies the automerge `repo`,
the document `DocHandle`, and the element to render into. You ship an ES module; Patchwork
loads it.

There is **no shadow DOM** — tools render into the **light DOM** inside a `<patchwork-view>`.
Namespace your CSS class names and inject styles with the JS bundle (see Build).

## 0. House style (read this first)

These are the defaults for **new** tools in this repo. Follow them unless the user says
otherwise.

- **Write plain vanilla JavaScript. No TypeScript.** No `.ts`/`.tsx`, no type annotations, no
  `tsconfig`. Document shapes with a JSDoc `@typedef` comment if you want a schema note (see
  `tic-tac-toe.js`) — that's all the typing a tool needs.
- **Default to no framework and no build step.** A single hand-written `.js` file that
  re-renders the DOM on `handle.on("change", …)` is the preferred shape (see §4). It's the
  simplest thing that works and it syncs with just `pushwork sync`.
- **If — and only if — you genuinely need fine-grained reactivity, use Solid. Never React.**
  Solid is already in the importmap and you can use it **without JSX or a build** via
  `solid-js/html` tagged templates, so you stay in plain JS. Reach for it when the UI has
  enough independent live-updating pieces that hand-diffing the DOM gets painful.
- **React is legacy here.** Several existing tools use React + TS; do not start new tools that
  way, and when editing a React tool, match its existing style rather than rewriting it.

Rule of thumb: **vanilla JS first → Solid (via `solid-js/html`) if you need reactivity →
React only when modifying a tool that already uses it.**

## 1. Pick a flavor

| | Bundleless (single `.js`) — **default** | Bundled (vite) — only if needed |
|---|---|---|
| Use when | almost always: vanilla JS, Web Components, or Solid via `solid-js/html` | you need JSX, or many source files, or you're editing an existing React tool |
| Source | one hand-written `.js` (e.g. `walkies.js`, `catclock.js`, `tic-tac-toe.js`) | `src/` compiled to `dist/index.js` |
| Imports | bare specifiers via Patchwork's **importmap**; assets via `import.meta.url` | same, but bundled; deps marked external |
| Build | none — `pushwork sync` directly | `pnpm build` then `pushwork sync` |
| `package.json main` | the `.js` file | `./dist/index.js` |

Both flavors export the **same** `plugins` array. **Strongly prefer bundleless** — there's
nothing to build, no TypeScript, no toolchain, and the importmap already covers automerge,
solid-js, codemirror, and the patchwork packages. You can write a fully reactive Solid tool
bundleless using `solid-js/html` (§4), so most tools never need vite at all. Reach for the
bundled flavor only when JSX or a multi-file source tree genuinely earns its keep.

## 2. Plugin registration — `export const plugins`

Every tool module exports `plugins`, an array of plugin objects. Three plugin `type`s:

```js
export const plugins = [
  {
    type: "patchwork:datatype",     // describes a document shape
    id: "tic-tac-toe",
    name: "Tic Tac Toe",
    icon: "Grid3x3",                // a lucide-react icon NAME
    // unlisted: true,              // hide from "new document" menus (e.g. "file")
    async load() {
      return TicTacToeDatatype       // the datatype object (see §3)
    },
  },
  {
    type: "patchwork:tool",          // a view/editor for a datatype
    id: "tic-tac-toe",               // ⚠ MUST equal the pin id when pinning a tool
    name: "Tic Tac Toe",
    icon: "Grid3x3",
    supportedDatatypes: ["tic-tac-toe"],  // or ["*"] for any doc (e.g. inspectors)
    async load() {
      return Tool                    // a render function (see §4)
    },
  },
]
```

- `load()` is **async** and lazy — `import()` the heavy code inside it so the registry stays
  cheap. Bundleless tools often `return SomeObject` directly; bundled tools
  `const { X } = await import("./x"); return X`.
- **`id` rule:** a tool's `id` and the pin `id` must match. When pinning a tool, use the same
  id the tool registers with.
- `icon` is a [lucide](https://lucide.dev) icon name (`"Music"`, `"Database"`, `"File"`,
  `"Sparkles"`, `"Cat"`, `"Grid3x3"`…).
- A package can register **many** plugins (a datatype + its tool, or several datatypes). See
  `file/src/index.ts` (file + new-file) and `bento/main.js` (datatype + tool).

## 3. The datatype contract

A datatype object describes a document type and how to title it:

```js
export const TicTacToeDatatype = {
  init(doc) {                        // seed a brand-new doc (runs inside a change)
    doc.title = "Tic Tac Toe"
    doc.board = [null, null, null, null, null, null, null, null, null]
    doc.currentPlayer = "X"
    doc.status = "playing"
    doc.winner = null
  },
  getTitle(doc) {                    // string shown in the UI / file lists
    return doc.title || "Tic Tac Toe"
  },
  setTitle(doc, title) {             // rename (called inside a handle.change)
    doc.title = title
  }
}
```

- `init` defines your **document schema** by example — the fields you set here are your data
  model. Keep it flat and automerge-friendly (plain objects/arrays/strings/numbers).
- `getTitle`/`setTitle` are required for a doc to show a name. `markCopy` is optional.
- Datatypes can carry richer helpers/exports too (type guards, content getters) — see
  `file/src/datatype.ts`.

## 4. The tool render contract — `(handle, element) => cleanup`

A tool's `load()` resolves to a **render function**. It receives the document `DocHandle` and
the host `element`, mounts UI into `element`, and **returns a cleanup function**.

**Vanilla / Web Components — the default.** Re-render on every change. This is the right
shape for the large majority of tools:

```js
function Tool(handle, element) {
  const container = document.createElement("div")
  const style = document.createElement("style")
  style.textContent = `.ttt-board { /* namespaced! */ }`
  element.append(style, container)

  function render() {
    const doc = handle.doc()          // current snapshot
    // ...build DOM from doc, wire events that call handle.change(...)
  }
  render()
  handle.on("change", render)         // re-render when the doc changes (local or remote)

  return () => {                      // cleanup: undo everything you did
    handle.off("change", render)
    container.remove()
    style.remove()
  }
}
```

**Solid (when you need reactivity) — use `solid-js/html`, no JSX, no build.** Tagged-template
markup keeps you in plain vanilla JS while getting fine-grained updates. Wrap the doc in a
signal you push to from the `change` event; write dynamic expressions as functions so they
stay reactive. `render()` returns a disposer — return it from cleanup:

```js
import { render } from "solid-js/web"
import html from "solid-js/html"
import { createSignal } from "solid-js"

function CounterTool(handle, element) {
  const [doc, setDoc] = createSignal(handle.doc())
  const onChange = () => setDoc(handle.doc())
  handle.on("change", onChange)

  const dispose = render(
    () => html`<button onClick=${() => handle.change(d => { d.count++ })}>
      count: ${() => doc().count}
    </button>`,
    element,
  )
  return () => { handle.off("change", onChange); dispose() }
}
```

**React — legacy; do NOT use for new tools.** Existing React tools mount a root and unmount in
cleanup. Edit them in place; don't introduce React into a new tool.

```js
import { createRoot } from "react-dom/client"
export function Tool(handle, element) {
  const root = createRoot(element)
  root.render(<App handle={handle} element={element} />)
  return () => root.unmount()
}
```

The cleanup function is **mandatory** — Patchwork calls it when the tool unmounts. Remove
listeners, dispose roots, cancel intervals/animation frames, close audio contexts.

## 5. Reading & writing the automerge document

```js
const doc = handle.doc()             // synchronous snapshot of current state
handle.change(d => { d.foo = 1 })    // ALL writes go through change()
handle.on("change", render)          // fires on local + remote edits
handle.off("change", render)
```

**Automerge gotchas:**
- You **cannot assign `undefined`** to a doc property. To remove a field, `delete d.prop`
  inside a `change()`; to nullify, set `d.prop = null`.
- Always mutate inside `handle.change(d => …)`. Never mutate `handle.doc()` directly.
- Keep the model JSON-shaped. For collaborative **text**, prefer `@automerge/automerge-codemirror`
  + Automerge cursors over naive string replacement (see `file`, `call`, `datalog`).

## 6. Globals & the repo

Patchwork exposes globals — use them directly, don't dig through handles:

```js
window.repo                  // the automerge Repo
window.accountDocHandle      // current user's account DocHandle
window.hive                  // tool/datatype registry

const handle = await repo.find(url)        // ⚠ returns a Promise<DocHandle>, already ready
const fresh  = await repo.create2(initial) // create a new doc (repo.create is deprecated)
```

**Current automerge-repo API** (do not use the old patterns):

```js
// WRONG — old API
const handle = repo.find(url); await handle.whenReady()
// CORRECT — current API
const handle = await repo.find(url)
```

Get the user's name:
`(await repo.find(window.accountDocHandle.doc().contactUrl)).doc().name`.

## 7. Multiplayer & ephemeral messaging

`DocHandle` has a built-in broadcast channel for **non-persisted** peer-to-peer messages —
ideal for presence, cursors, typing indicators, "now playing" state, WebRTC signaling:

```js
handle.broadcast({ type: "play", playing: true })   // to all peers with this doc open
handle.on("ephemeral-message", payload => {
  const msg = payload.message                        // the wrapped payload
})
handle.off("ephemeral-message", handler)
```

Messages reach only **currently-connected** peers and are never stored. For persisted shared
state, write to the doc with `handle.change()`.

## 8. Custom DOM events

Patchwork events bubble and are `composed` (defined in `@inkandswitch/patchwork-elements`):

```js
import { openDocument } from "@inkandswitch/patchwork-elements"
openDocument(element, url, toolId)   // navigate Patchwork to another document

// or manually:
element.dispatchEvent(new CustomEvent("patchwork:open-document", {
  detail: { url, toolId }, bubbles: true, composed: true,
}))

element.addEventListener("patchwork:mounted", () => { /* inner tool is ready */ })
```

## 9. The importmap (bare imports — no CDN needed)

Patchwork provides an importmap, so both flavors can `import` these by bare specifier:

- `@automerge/automerge`, `@automerge/automerge/slim`
- `@automerge/automerge-repo`, `@automerge/automerge-repo-keyhive`
- `@keyhive/keyhive`
- `@inkandswitch/patchwork-bootloader`, `-elements`, `-filesystem`, `-plugins`
- `@codemirror/state`, `@codemirror/view`, `@codemirror/language`
- `solid-js` and its subpaths (`solid-js/web`, `/store`, `/html`, `/h`, `/jsx-runtime`)

Use direct imports (`import("@codemirror/view")`) — never esm.sh / unpkg URLs for these.
In bundleless tools, load your own static assets with `new URL("./x.flac", import.meta.url)`.

## 10. Working with files & assets

From `@inkandswitch/patchwork-filesystem`:

```ts
type FolderDoc     = { title: string; docs: DocLink[] }
type DocLink       = { name: string; type: string; url: AutomergeUrl; icon?: string; copyOf?: AutomergeUrl }
type UnixFileEntry = { content: string | Uint8Array | ImmutableString; extension: string; mimeType: string; name: string }
```

- `automergeUrlToServiceWorkerUrl(url)` → a URL usable as `<img src>` / `<audio src>` for a
  doc's bytes. Import from `@inkandswitch/patchwork-filesystem`.
- Docs may carry a `@patchwork` metadata field: `{ type: "file", suggestedImportUrl: "…" }`.
- Load a datatype at runtime: `await getRegistry("patchwork:datatype").load(id)`.


## 11. Styling & theming

**Do NOT use Tailwind, DaisyUI, or any CSS framework.** Write plain CSS following the
CUBE CSS methodology (cube.fyi). The theming system provides CSS custom properties for
colors, fonts, spacing, radius, and shadows.

### CUBE CSS methodology

We structure CSS using **Composition, Utility, Block, Exception** layers:

1. **Composition** — layout primitives that control how elements flow and relate to each
   other. These are generic and reusable (e.g. a `.flow` class that adds vertical rhythm,
   a `.cluster` for inline groups with gap). Composition classes never apply visual
   treatments — only spacing and layout.

2. **Block** — the namespaced component. A block is a skeletal container for one
   contextual piece of UI (e.g. `.history-panel`, `.sideboard`, `.comments-thread`).
   Blocks define their appearance using local CSS variables derived from the theme.
   Child elements use simple descendant selectors: `.my-tool .header`, `.my-tool .title`.

3. **Exception** — a state deviation from a block, applied via **data attributes** (not
   class modifiers). E.g. `data-selected`, `data-state="reversed"`, `data-expanded`.

```html
<!-- Block with exception via data attribute -->
<div class="history-item" data-selected>…</div>

<!-- Composition + Block together -->
<div class="flow comments-panel">…</div>
```

```css
/* Composition — generic layout */
.flow > * + * {
  margin-top: var(--flow-space, var(--studio-space, 0.75rem));
}

/* Block — the component */
.history-item {
  display: flex;
  gap: var(--studio-space-sm, 0.5rem);
  padding: var(--studio-space-xs, 0.375rem);
  border-radius: var(--studio-radius-sm, 4px);
  cursor: pointer;
}

/* Exception — state via data attribute */
.history-item[data-selected] {
  background: var(--history-accent);
  color: var(--history-accent-fg);
}
```

### CSS variables

Use these variables (with fallbacks) instead of hardcoded values:

**Colors:**
- `var(--studio-fill, white)` / `var(--studio-line, black)` — background/foreground
- `var(--studio-fill-offset-10)` through `-50` — tinted backgrounds (mix of fill + line)
- `var(--studio-line-offset-10)` through `-50` — muted text (mix of line + fill)
- `var(--studio-primary, #35f7ca)`, `--studio-secondary`, `--studio-danger`, `--studio-warning`
- `var(--studio-added)`, `--studio-deleted`, `--studio-modified`, `--studio-link`

**Typography:**
- `var(--studio-family-sans, system-ui, sans-serif)` — UI text
- `var(--studio-family-code, ui-monospace, monospace)` — code/mono
- `var(--studio-font-size, 16px)`, `var(--studio-line-height, 1.5)`

**Spacing:**
- `var(--studio-space-2xs)` (4px) through `var(--studio-space-2xl)` (48px)

**Border radius:**
- `var(--studio-radius-sm, 4px)` through `var(--studio-radius-xl, 16px)`
- `var(--studio-radius-round, 9999px)` for pills

**Shadows:**
- `var(--studio-shadow-sm)` through `var(--studio-shadow-lg)`

**Transitions:**
- `var(--studio-transition-fast, 0.1s ease)` through `var(--studio-transition-slow, 0.25s ease)`

### CSS file structure

Every tool's CSS follows this structure:

1. **Define local variables in `:root, :host, [theme]`** so they re-evaluate when a theme is
   applied (the theme system sets a `[theme]` attribute on `<html>`):

```css
:root,
:host,
[theme] {
  --my-tool-bg: var(--studio-fill, white);
  --my-tool-fg: var(--studio-line, black);
  --my-tool-muted: var(--studio-line-offset-50, #999);
  --my-tool-border: var(--studio-fill-offset-20, #ccc);
  --my-tool-accent: var(--studio-primary, #35f7ca);
  --my-tool-hover: color-mix(in oklch, var(--studio-fill), var(--studio-line) 5%);
  --my-tool-family: var(--studio-family-sans, system-ui, sans-serif);
  --my-tool-family-code: var(--studio-family-code, ui-monospace, monospace);
}
```

**Important:** Global `--studio-*` variables must NEVER be used directly in CSS rules. They
should ONLY appear inside `:root, :host, [theme]` derivation blocks. The derived
`--my-tool-*` variables are what you use in actual rules. This ensures themes re-evaluate
correctly when the `[theme]` attribute changes (e.g. switching between light/dark mode).

2. **Composition classes** (if needed) for layout patterns:

```css
.my-tool .flow > * + * {
  margin-top: var(--flow-space, var(--studio-space-sm, 0.5rem));
}
```

Note: spacing (`--studio-space-*`), radius (`--studio-radius-*`), and transition
(`--studio-transition-*`) vars are layout concerns and may be used directly in rules with
their fallbacks — only color, font, and background vars need to be derived.

3. **Block classes** using the local variables:

```css
.my-tool {
  background: var(--my-tool-bg);
  color: var(--my-tool-fg);
  font-family: var(--my-tool-family);
}

.my-tool .header {
  border-bottom: 1px solid var(--my-tool-border);
  color: var(--my-tool-muted);
}
```

4. **Exception rules** via data attributes:

```css
.my-tool .card[data-selected] {
  background: var(--my-tool-accent);
}

.my-tool .card[data-state="editing"] {
  outline: 2px solid var(--my-tool-accent);
}
```

### Derive your colors from the theme

**Never introduce new hex color values.** Derive all colors from the theme using
`color-mix()`:

```css
/* Good — derived from theme */
background: color-mix(in oklch, var(--studio-fill), var(--studio-line) 5%);
border-color: color-mix(in oklch, var(--studio-primary), transparent 50%);
color: color-mix(in oklch, var(--studio-line), var(--studio-fill) 40%);

/* Bad — hardcoded */
background: #f5f5f5;
border-color: rgba(53, 247, 202, 0.5);
color: #666;
```

When you need "lighter" or "darker", mix with `var(--studio-fill)` or `var(--studio-line)`
respectively — **not** literal `white`/`black` — so the derivations invert correctly in
dark themes.

### Do not handle dark mode

Never add `@media (prefers-color-scheme: dark)` blocks. The theme system handles
light/dark by swapping the CSS variable values. Your tool just uses the variables.

### Plugin type: patchwork:theme

Register a theme plugin to contribute a color scheme:

```js
{ type: "patchwork:theme", id: "my-theme", name: "My Theme",
  style: new URL("./my-theme.css", import.meta.url).href,
  async load() { return {} } }
```

The CSS file should use **only** `[theme="my-theme"]` as its selector — **not** `:root, :host`.
Theme CSS targets the specific `[theme]` attribute value so multiple themes can coexist in the
document simultaneously (the theming system includes all theme CSS files and switches by setting
`[theme]` on `<html>`). The default theme (`theme.css`) uses `:root, :host, [theme]` to provide
base values; individual themes override with `[theme="name"]` only.

### CSS cascade layers

Only **CSS custom property definitions** are wrapped in `@layer package { }`. Actual style
rules live **outside** any layer (unlayered) so they can't be overridden by unlayered resets
or normalise stylesheets.

| CSS type | Layer | Priority |
|---|---|---|
| Base system variables (`theme.css`) | `@layer patchwork` | lowest |
| Tool variable defaults | `@layer package` | middle |
| Tool style rules | unlayered | high |
| Theme CSS (lychee, gloom, custom) | unlayered | high (specificity wins) |

**Variable definitions go in `@layer package`; style rules stay unlayered:**

```css
@layer package {
:root,
:host,
[theme] {
  --my-tool-bg: var(--studio-fill, white);
}
}

.my-tool {
  background: var(--my-tool-bg);
}
```

If a tool CSS file has **no** variable definitions, it should have **no** `@layer` wrapper at all.

Theme CSS files (`lychee.css`, `gloom.css`, custom themes) must **not** be wrapped in any
layer — they stay unlayered so they reliably override everything.

## 12. Build & sync

**Bundleless (default):** no build, no TypeScript, no toolchain. From the tool dir:
`pushwork sync`. `package.json` is minimal:

```json
{ "type": "module", "main": "tic-tac-toe.js" }
```

**Bundled (only when you truly need JSX or a multi-file tree):** mark Patchwork deps external
via the bootloader, output a single ES entry, and inject CSS into the JS (because there's no
shadow DOM, styles must ship with the bundle). Keep the config and source in **plain JS** —
`vite.config.js`, a `.jsx`/`.js` entry, no `tsconfig`:

```js
// vite.config.js (Solid)
import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
  base: "./",
  plugins: [solidPlugin(), cssInjectedByJsPlugin()],
  build: {
    minify: false,
    rollupOptions: {
      external,
      input: "./src/index.jsx",
      output: { format: "es", entryFileNames: "[name].js" },
      preserveEntrySignatures: "strict",
    },
  },
})
```

The essentials are `format: es`, `external` from the bootloader, and CSS-in-JS. (Some existing
tools use `vite-plugin-react` and `.tsx` — that's the legacy path; don't replicate it for new
tools.)

`package.json`: `"main": "./dist/index.js"`, scripts `"build": "vite build"` and
`"push": "pnpm build && pushwork sync"`. After ANY change to a bundled tool:
**`cd` into the tool dir, `pnpm build`, then `pushwork sync`.** Use `pushwork sync`
(not `npx pushwork sync`). The tool's automerge url is stored in `package.json` under
`pushwork.url`.

## 13. Gotchas checklist

- **No shadow DOM.** Tools render into the light DOM. Namespace CSS classes; don't rely on
  scoped styles. Bundle CSS into the JS (`vite-plugin-css-injected-by-js`).
- **Never `stopPropagation()` on `click`.** Solid (and other frameworks) delegate `click` to
  `document`; stopping it kills their `onClick`. Only stop propagation on
  `pointerdown`/`pointerup` (what tldraw uses).
- **No `undefined` in automerge.** Use `delete d.x` (inside `change`) or `null`.
- **`repo.find`/`repo.create2` return Promises** that resolve to ready handles — no
  `whenReady()`.
- **Pin id === tool id.** Mismatched ids mean the pin won't resolve to the tool.
- **Always return a cleanup function** from the render function and actually tear down
  (listeners, roots, intervals, rAF, AudioContext, workers).
- **New tools: vanilla JS, no TypeScript.** No `.ts`/`.tsx`, no type annotations, no
  `tsconfig` — use a JSDoc `@typedef` for the doc shape if you want a note. If you need
  reactivity, use **Solid via `solid-js/html`** (no JSX/build); never React. Existing tools may
  be React/Solid/Svelte/TS — match the existing tool's style when editing one, but don't start
  new tools that way.

## 14. Minimal complete example (bundleless)

```js
// my-counter.js  →  package.json: { "type": "module", "main": "my-counter.js" }
export const CounterDatatype = {
  init(doc)            { doc.title = "Counter"; doc.count = 0 },
  getTitle(doc)        { return doc.title || "Counter" },
  setTitle(doc, t)     { doc.title = t },
  markCopy(doc)        { doc.title = "Copy of " + this.getTitle(doc) },
}

function CounterTool(handle, element) {
  const root = document.createElement("div")
  const style = document.createElement("style")
  style.textContent = `.counter-btn{font:600 2rem system-ui;padding:.5rem 1rem}`
  element.append(style, root)

  function render() {
    const { count } = handle.doc()
    root.innerHTML = `<button class="counter-btn">count: ${count}</button>`
    root.firstChild.onclick = () => handle.change(d => { d.count++ })
  }
  render()
  handle.on("change", render)
  return () => { handle.off("change", render); root.remove(); style.remove() }
}

export const plugins = [
  { type: "patchwork:datatype", id: "counter", name: "Counter", icon: "Hash",
    async load() { return CounterDatatype } },
  { type: "patchwork:tool", id: "counter", name: "Counter", icon: "Hash",
    supportedDatatypes: ["counter"], async load() { return CounterTool } },
]
```

Then from the tool's directory: `pushwork sync`. Done.

## 15. Reference tools in this repo

**Copy these patterns (vanilla JS, bundleless — the house style):**
- **Bundleless / vanilla:** `tic-tac-toe`, `catclock`, `walkies`, `sparkles`, `webtile`
- **Web Components + audio/wasm:** `bento`, `call`, `sound`
- **Headless actions:** `actions` (note: this one is TS — the shape is what matters)

**Reach for Solid only if you need reactivity:** `cache-browser`, `file`, `chat`, `paper`
(these use JSX + a bundle; for a new tool prefer `solid-js/html` bundleless instead).

**Legacy — reference for behavior, NOT for style (React/TS, don't copy the approach):**
`datagrid`, `boardgame`, `datalog`, `doc-copy-history`.

- **CodeMirror extension:** `codemirror-latex`, `file`
- **Whole-folder / inspector (`supportedDatatypes: ["*"]`):** `inspector`, `cache-browser`,
  `breadboard`, `doc-copy-history`

Each tool's directory often has its own `CLAUDE.md`/`README.md` and a `prompts/<tool>.md`
one-shot spec — read those for tool-specific detail. The repo-root `CLAUDE.md` is the source
of truth for the APIs above.
