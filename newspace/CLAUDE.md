# New Space

A themed spatial canvas for Patchwork folders — **no tldraw**. Built with Solid
(JSX, bundled with vite), it renders folder contents as draggable HTML windows on
an infinite pan/zoom canvas and lets you draw **on top of the tools** with
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) (pressure
ink) and [rough.js](https://roughjs.com) (sketchy rectangles, ellipses, lines,
arrows — excalidraw style).

## Interaction

- **Bottom toolbar** (a System-7 palette): select, hand/pan, pen, rectangle,
  ellipse, line, arrow, eraser, and **+** (new doc).
- **New doc = "draw the tool you want":** click **+**, pick a datatype, then drag
  a box on the canvas — the doc is created at those bounds.
- **Select & move:** in select mode, click a stroke/shape to select it (dashed
  box), drag to move, Backspace/Delete to remove.
- **Properties panel** (left): edits the active brush, or — when something is
  selected — that mark's own properties, including **stroke colour, fill colour +
  fill style, perfect-freehand thinning/smoothing/streamline, and rough.js
  roughness/bowing**.
- Ink renders in an always-on-top SVG layer (`pointer-events: none`), so you can
  draw over live embedded tools without blocking them.
- Keyboard tool shortcuts (`v h p r o l a e`) are suppressed while typing inside
  an embedded patchwork tool.

## Theming

Theme-aware: derives `--ns-ink`/`--ns-chrome`/`--ns-paper` from the Patchwork
theme vars (`--studio-line`, `--studio-fill`, `--editor-fill-offset-10`) so it
follows the host's dark/light switch, with System-7 cream fallbacks when run
unthemed. The riso accent colours (chee-rabbit / Mimi-Reyburn character) stay
constant. Visual register: System 7 chrome (bevels, pinstripe title bars, close
boxes) warmed into a risograph palette.

## Build & deploy

```sh
pnpm build      # vite build  →  dist/index.js (+ chunks)
pushwork sync   # publish dist + source to automerge
```

Published at `automerge:3EoRD6Adef8TitsP2SX3peY5bWxq`.

## Architecture

- **`src/index.jsx`** — registers a `newspace` datatype and a `newspace` tool
  (`supportedDatatypes: ["newspace", "folder"]`, so it opens any folder).
- **`src/datatype.js`** — the doc model + `ensureCanvasFields` migration.
- **`src/tool.jsx`** — `NewspaceTool(handle, element)` render contract. Holds the
  camera, active tool, pointer gestures, eraser hit-testing, doc creation, and
  image paste. Reactivity comes from `makeDocumentProjection(handle)` of
  `automerge-repo-solid-primitives`.
- **`src/draw.js`** — perfect-freehand → SVG path, and rough.js → declarative
  `<path>` data (via `generator.toPaths`, deterministic per stored `seed`).
- **`src/style.css`** — dark glassy neon theme, injected into the JS bundle.

## Document model (one ordered `items` array — arrays only, on purpose)

```
{ title, docs: DocLink[],           // the folder contract
  items: Item[] }                   // array ORDER = drawing/z order

Item kinds:
  stroke { id, kind, points:[[x,y,pressure]], color, size,
           thinning, smoothing, streamline, rotation, parent? }
  shape  { id, kind, type, x, y, w, h, color, fill, strokeWidth,
           roughness, bowing, fillStyle, seed, rotation, parent? }
  doc    { id, kind, url, x, y, w, h, rotation, toolId, parent? }   // patchwork-view shape
  frame  { id, kind, url, x, y, w, h, title, rotation?, parent? }   // a sub-space
```

Everything is a regular shape sharing the same rules: select (shift / marquee
multi-select), move, resize (8 handles), rotate (knob), reorder (front/back),
configure via the draggable palette. `fill` is a colour or `"none"`. The two
mono palette colours are theme tokens (`var(--studio-line)` / `var(--studio-fill)`)
so black/white flip with dark mode.

**Frames** are sub-spaces (placing the `newspace` datatype makes one). A frame is
a container: items dropped inside get `parent: frameId`, store FRAME-LOCAL coords,
and render nested + clipped — so they move/rotate/clip with the frame. Frames
rotate too. No frame-in-frame.

`ensureCanvasFields` migrates the older `windows`/`strokes`/`shapes` model into
`items` (emptying the old arrays via splice — never `delete` a top-level key, that
crashes the projection). Arrays only, never deletable map keys.

Everything canvas-related is a flat **array**, never a keyed map. Automerge list
deletions are index splices, which the Solid document projection applies
cleanly; map-key deletion is the one patch the upstream projection trips on, so
we never model anything deletable as a map.

## Bundling notes

`vite.config.js` externalizes everything the **host importmap** provides
(solid-js + subpaths, all `@automerge/*`, the patchwork packages) and bundles
only our own deps (perfect-freehand, roughjs, automerge-repo-solid-primitives).
The installed `@inkandswitch/patchwork-bootloader/externals` list lags the live
host (it predates solid-js being host-provided), so the config augments it — if
solid-js were bundled we'd get a second reactive runtime and every signal would
break.
