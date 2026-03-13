# Architecture

## DOM scaffold

`CanvasView` builds a fixed DOM tree inside the `patchwork-view` element it is mounted into:

```
<patchwork-view>            ← mountPoint (PatchworkViewElement)
  <div class="sc-container">
    <div class="sc-canvas">
      <div class="sc-layer"> ← the only element that receives the camera transform
        <patchwork-view tool-id="spatial-canvas-layer-rectangles" …>
        <patchwork-view tool-id="spatial-canvas-layer-pen" …>
        <patchwork-view tool-id="spatial-canvas-layer-embed" …>
        …one per registered layer…
      </div>
    </div>
    <div class="sc-panel-overlay">  ← 3×3 CSS grid, z-index 100
      <patchwork-view tool-id="spatial-canvas-panel-toolbar" …>
      …
    </div>
  </div>
</patchwork-view>
```

Key CSS rules (see `src/core/css/canvas.css`):

| Class | Role |
|-------|------|
| `.sc-container` | fills the mount point; holds CSS camera variables (`--sc-zoom`, `--sc-x`, `--sc-y`); `touch-action:none` |
| `.sc-canvas` | viewport; `overflow:clip` so shapes can extend beyond it without causing scroll |
| `.sc-layer` | **zero-sized** (`width:0;height:0`); receives `transform: translate/scale`; `contain:layout style size` so the browser never measures its children |
| `.sc-panel-overlay` | 3×3 grid of panel slots, `pointer-events:none` (individual panels opt back in) |

`.sc-layer` being zero-sized is intentional — all shapes are positioned absolutely and overflow freely. This lets shapes from different layer `patchwork-view` elements interleave via their individual `z-index` values without any layer element creating a stacking context.

---

## Coordinate spaces

There are two coordinate spaces to keep track of:

| Space | Description | Origin |
|-------|-------------|--------|
| **Screen** (`clientX/Y`) | Raw browser coordinates | top-left of the viewport |
| **Canvas** (also called *page space*) | The infinite canvas coordinate system | camera origin |

The conversion is:

```
canvasX = (clientX - canvasRect.left) / zoom - cameraX
canvasY = (clientY - canvasRect.top)  / zoom - cameraY
```

`screenToCanvas(element, clientX, clientY)` in `src/core/inputs.ts` does this from any element inside `.sc-container` by reading the `--sc-zoom`, `--sc-x`, `--sc-y` CSS variables from `.sc-container`.

Shape `x`/`y` are always in canvas space. The layer renders them with:

```ts
el.style.transform = `translate(${shape.x}px, ${shape.y}px)`
```

…which is already in the transformed `.sc-layer` coordinate system, so no further math is needed inside a layer.

---

## Document model

```ts
interface CanvasDoc {
  shapes: Record<string, CanvasShape>   // keyed by shape id
  stateByUser: { [contactUrl: string]: UserState }
  panels: { [panelId: string]: PanelEntry }
}

interface CanvasShape {
  id: string
  type: string   // discriminator — 'rectangle' | 'pen' | 'text' | 'embed' | …
  x: number      // canvas space
  y: number
  zIndex: number
}
```

Each shape type is a plain interface that extends `CanvasShape` with its own fields (`width`, `height`, `color`, `points`, …). All shapes live in the same flat `shapes` map; layers filter by `shape.type`.

`stateByUser` is keyed by the user's `contactUrl` and stores ephemeral per-user state: current selection, active tool, color picker value, etc. It is written via `handle.change()` like any other doc mutation and is therefore synced and visible to other peers.

---

## Plugin registry

Everything is a patchwork plugin. The canvas uses two plugin types:

| Plugin type | Tag | What it is |
|-------------|-----|------------|
| `patchwork:tool` | `spatial-canvas-tool` | A toolbar button + interactive tool. Mounted as `<patchwork-view>` in the toolbar panel. Receives pointer CustomEvents from `CanvasView`. |
| `patchwork:tool` | `spatial-canvas-layer` | A render layer. Mounted as `<patchwork-view>` inside `.sc-layer`. Subscribes to `handle.on('change', …)` and keeps DOM in sync with the doc. |
| `patchwork:tool` | `spatial-canvas-panel` | A panel widget (e.g. toolbar, properties). Mounted as `<patchwork-view>` in the panel overlay. |
| `patchwork:datatype` | — | The `spatial-canvas` document type itself. |

All plugins are registered in `src/index.ts` and loaded lazily (`async load() { return import(…) }`).

`CanvasView.mountLayers()` calls `getRegistry("patchwork:tool").filter(…"spatial-canvas-layer"…)` to discover layer plugins, then creates a `<patchwork-view>` element for each. The framework calls the layer function with `(handle, element)` once the plugin module is loaded, where `element` is the `PatchworkViewElement` — a proper custom element with `element.repo` already set.

---

## Pointer event pipeline

`CanvasView` owns a single `pointerdown / pointermove / pointerup / pointercancel` listener on `.sc-canvas`. It:

1. Captures the pointer (`setPointerCapture`) on `pointerdown`.
2. Translates the raw `PointerEvent` into a `CustomEvent` with `{ canvasX, canvasY, screenX, screenY, shiftKey, metaKey, altKey }` in its `detail`.
3. Dispatches the CustomEvent (`spatial-canvas:pointerdown`, `:pointermove`, `:pointerup`) onto the **active tool's `patchwork-view` button element** — found by `querySelector('patchwork-view[tool-id="…"]')`.

This means a canvas tool only needs to add listeners to its own `element`:

```ts
element.addEventListener('spatial-canvas:pointerdown', onPointerDown)
element.addEventListener('spatial-canvas:pointermove', onPointerMove)
element.addEventListener('spatial-canvas:pointerup',   onPointerUp)
element.addEventListener('spatial-canvas:cancel',      onCancel)
```

A `spatial-canvas:cancel` event is dispatched when the active tool changes mid-gesture. Tools must clean up any preview DOM in their cancel handler.

---

## DOM navigation from a tool or layer

Because everything shares the same DOM tree, a tool or layer can navigate to sibling elements by traversing up to `.sc-container` and querying down:

```ts
// Get the transform layer (to append a preview element)
const layer = element.closest('.sc-container')?.querySelector('.sc-layer')

// Get the canvas element (to read bounding rect for coordinate math)
const canvasEl = element.closest('.sc-canvas')
```

Layers mark their shape DOM elements with `data-shape-id` so hit-testing works across layers:

```ts
el.dataset.shapeId = shape.id
```

`SelectTool` uses `document.elementsFromPoint(screenX, screenY)` and walks up each hit element looking for a `data-shape-id`.

---

## Command helpers (`src/core/commands.ts`)

All doc mutations go through `handle.change()`. The helpers in `commands.ts` cover the common cases:

| Helper | What it does |
|--------|-------------|
| `createShape(handle, shape)` | Insert a new shape into `doc.shapes` |
| `deleteShapes(handle, ids)` | Remove shapes by id |
| `translateShapes(handle, moves)` | Move a batch of shapes |
| `patchShape(handle, id, patch)` | Merge a partial update into an existing shape |
| `duplicateShapes(handle, ids, dx, dy)` | Deep-copy shapes with new ids, offset by (dx, dy) |
| `newId()` | Generate a random 8-char shape id |
| `nextZIndex(doc)` | Return `max(zIndex) + 1` across all current shapes |
