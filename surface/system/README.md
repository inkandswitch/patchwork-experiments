# Surface system

This tree is the **surface system**: the collaborative layer where people work in **shared documents** and where the **tools themselves** also live as ordinary source files you can open, read, and change. Nothing here is a black box behind a separate app server—the behavior you see is implemented in these modules, loaded by URL when the UI needs them.

## What you are looking at

You work in an environment where you can **create and edit documents** (persistent, mergeable state) and **evolve the system** (how those documents are shown and edited) in the same spirit: the implementation is part of the same world you inspect. To understand a feature, **read the source** next to this README—typically `shape.js` for how a piece of state is drawn, `button.js` when there is a toolbar tool, and the package `README.md` for the data shape and usage.

## Folder layout

| Area                                                               | Role                                                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`bootstrap.js`**                                                 | Default entry: mounts the paper surface on the frame’s ref (nested `ref-view` so the document ref stays the frame).                                                                |
| **`paper/`**                                                       | Lays out the `shapes` map, active tool, and selection highlights—see `paper/README.md`.                                                                                            |
| **`line/`, `rectangle/`, `text/`, `embed/`, `selection/`, `llm/`** | One folder per capability: renderer (`shape.js`), optional toolbar wiring (`button.js`), small `package.json` metadata, and a `README.md` describing types and programmatic usage. |
| **`solid.js`**                                                     | Shared Solid helpers (`render`, `html`, `useRef`, …) used across tools.                                                                                                            |
| **`doc/`**                                                         | Conventions for writing those package READMEs (`documenting-code.md`).                                                                                                             |

Paths are normal files on disk (or in your checkout). **Access** them like any other repo tree: open the file, follow imports, and use each package’s README as the contract for what gets stored in the document.

## Documents and refs

Collaboration centers on **refs**—handles into **one logical document** (a big JSON-like tree you can navigate with paths such as `shapes`, `selectedTool`, nested keys under `shapes`, and so on). Tools read and write **values through the ref**; those updates sync with other participants working on the same document.

When something should be **its own artifact**—standalone, **shareable on its own**, or loaded in isolation—it belongs in a **separate document** with its own ref. Keep one document when state is naturally part of the same canvas or frame; **split into a new document** when the boundary matches how you would link, fork, or embed that thing elsewhere. (Embeds in this system often point at another document URL plus a tool URL so the host knows how to render it.)

## Rendering a ref: `ref-view`

To **show** a slice of document state, the host uses a **`ref-view`** element. You give it:

- **`ref-url`** — Which document path (which ref) to bind.
- **`tool-url`** — Which **tool module** should mount there (JavaScript that receives the element, subscribes to `element.ref`, and renders UI).

The tool is responsible for interpreting that ref’s shape (validation, defaults, Solid UI). Different paths can use different tools; the same ref can be nested (e.g. bootstrap pointing at paper on the frame ref) so the outer and inner surfaces share one underlying document when that is what you want.

## LLM panel script bindings

Scripts run inside a `with` scope (not as globals on `globalThis`) with:

- **`element`** — the outermost frame `ref-view`; `element.ref` is the frame document (shapes, `selectedTool`, etc.). The LLM panel’s own `ref-view` is not exposed to scripts.
- **`readDoc`** — load markdown from the hosted `docs/` tree (see below).
- **`repo`** — Automerge repo when present (see below).
- **`console`** — captured logger for panel output.

## Bundled documentation

Scripts in the LLM panel can load markdown with `readDoc` from the hosted `docs/` tree:

- `await readDoc('user-guide.md')` and `await readDoc('builder-guide.md')` — paths are always single filenames under `docs/`.

## Working with Automerge

When `repo` is available in the script environment:

- `repo.find(url)` is async — always `await` it.
- Read a document with `await handle.doc()`.
- Mutate with `handle.change((doc) => { ... })`.
- Never assign `undefined` — delete the property instead: `handle.change((doc) => { delete doc.foo; });`.
