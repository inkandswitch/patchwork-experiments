# Adding a tool & layer

This guide walks through adding a new shape type end-to-end: a shape type file, a render layer, a place-tool, and the plugin registrations. The rectangle tool (`src/rectangle/`) is the simplest reference; the pen and text tools show variations.

---

## 1. Define the shape type

Create `src/my-shape/my-shape.ts`. Extend `CanvasShape` with whatever fields your shape needs:

```ts
import type { CanvasShape } from '../core/types.js'

export interface MyShape extends CanvasShape {
  type: 'my-shape'
  width: number
  height: number
  color: string
}
```

Keep fields plain and JSON-serialisable — they go directly into the Automerge doc.

---

## 2. Write the render layer

Create `src/my-shape/layer.ts`.

A layer subscribes to `handle.on('change', render)` and keeps a `Map<id, HTMLElement>` in sync with the current doc. The render function is called on every doc change; it must be idempotent.

```ts
import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc } from '../core/types.js'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'
import type { MyShape } from './my-shape.js'

export default function MyShapeLayer(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): () => void {
  // Expand the layer element to fill the canvas viewport.
  // pointer-events:none so the canvas itself still receives clicks/drags.
  // Override to 'auto' only on specific child elements that need interaction.
  element.style.cssText = 'position:absolute;inset:0;pointer-events:none;'

  const mounted = new Map<string, HTMLElement>()

  function render({ doc }: { doc: CanvasDoc }) {
    // Collect the current set of my-shape ids
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === 'my-shape') currentIds.add(shape.id)
    }

    // Remove DOM elements for deleted shapes
    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove()
        mounted.delete(id)
      }
    }

    // Create or update DOM elements
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== 'my-shape') continue
      const s = shape as MyShape

      let el = mounted.get(s.id)
      if (!el) {
        el = document.createElement('div')
        el.style.cssText = 'position:absolute;top:0;left:0;'
        // Mark with data-shape-id so SelectTool hit-testing can find this shape
        el.dataset.shapeId = s.id
        element.appendChild(el)
        mounted.set(s.id, el)
      }

      // Position via transform — coords are already in canvas space
      el.style.transform = `translate(${s.x}px, ${s.y}px)`
      el.style.width     = `${s.width}px`
      el.style.height    = `${s.height}px`
      el.style.zIndex    = String(s.zIndex)
      el.style.background = s.color
    }
  }

  handle.on('change', render)
  const initial = handle.doc()
  if (initial) render({ doc: initial })

  // Return a disposer — called when the layer patchwork-view is torn down
  return () => {
    handle.off('change', render)
    for (const el of mounted.values()) el.remove()
    mounted.clear()
  }
}
```

**Patterns to follow:**
- Always `position:absolute;top:0;left:0` on shape elements and position via `transform:translate(x,y)` — never via `top`/`left`. This matches how the camera transform works.
- Set `data-shape-id` on every shape element so `SelectTool` can hit-test it.
- Set `zIndex` from `shape.zIndex` (not a hardcoded value).
- Keep the render function pure with respect to DOM: compute what should exist, diff against `mounted`, create/remove/update.
- Do **not** read `element.repo` outside of the layer function body — it is set by the framework before the function is called and doesn't change.

---

## 3. Write the place-tool

Create `src/my-shape/place-tool.ts`.

A place-tool renders the toolbar button icon, responds to the `spatial-canvas:pointer*` CustomEvents dispatched to its element, and writes a new shape to the doc on pointer-up.

```ts
import { createElement, Box } from 'lucide'   // any Lucide icon
import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc, Disposer } from '../core/types.js'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'
import { createShape, nextZIndex, newId } from '../core/commands.js'
import type { MyShape } from './my-shape.js'

interface PointerDetail {
  canvasX: number
  canvasY: number
}

export default function PlaceMyShapeTool(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  // Render the toolbar button icon
  const icon = createElement(Box, { width: 22, height: 22, style: 'pointer-events:none' })
  element.appendChild(icon)

  let origin: { x: number; y: number } | null = null

  function onPointerDown(e: Event) {
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    origin = { x: canvasX, y: canvasY }
  }

  function onPointerUp(e: Event) {
    if (!origin) return
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail

    const x = Math.min(origin.x, canvasX)
    const y = Math.min(origin.y, canvasY)
    const width  = Math.abs(canvasX - origin.x)
    const height = Math.abs(canvasY - origin.y)

    if (width > 4 && height > 4) {
      const doc = handle.doc()
      const shape: MyShape = {
        id: newId(),
        type: 'my-shape',
        x, y, width, height,
        zIndex: doc ? nextZIndex(doc) : 0,
        color: '#e84393',
      }
      createShape(handle, shape)
    }

    origin = null
  }

  function onCancel() {
    origin = null
  }

  element.addEventListener('spatial-canvas:pointerdown', onPointerDown)
  element.addEventListener('spatial-canvas:pointermove', () => {})  // optional
  element.addEventListener('spatial-canvas:pointerup',   onPointerUp)
  element.addEventListener('spatial-canvas:cancel',      onCancel)

  return () => {
    element.removeEventListener('spatial-canvas:pointerdown', onPointerDown)
    element.removeEventListener('spatial-canvas:pointerup',   onPointerUp)
    element.removeEventListener('spatial-canvas:cancel',      onCancel)
    icon.remove()
  }
}
```

**Patterns to follow:**
- **Always** remove event listeners in the disposer. The framework calls it when the tool is unloaded.
- **Always** remove any DOM added to `element` in the disposer (the icon, etc.).
- Handle `spatial-canvas:cancel` — it fires when the user switches tools mid-gesture. Clean up any transient preview state there too.
- For a live drag preview, append a temporary element to `.sc-layer` in `onPointerDown` and remove it in `onPointerUp`/`onCancel`. Look up the layer with:
  ```ts
  element.closest('.sc-container')?.querySelector('.sc-layer')
  ```
  See `PlaceRectangleTool` for a full preview example.
- Coordinates in the CustomEvent `detail` are already in **canvas space** — use them directly as shape `x`/`y`.
- `canvasX/Y` come from `spatial-canvas:pointerdown` and `:pointermove`. You do **not** need to call `screenToCanvas` inside a tool (that is done for you by `CanvasView`).

---

## 4. Register the plugins

In `src/index.ts`, add one entry to the `plugins` array for the place-tool and one for the layer:

```ts
// In the "Canvas tools" section
{
  type: 'patchwork:tool' as const,
  id: 'spatial-canvas-tool-my-shape',
  name: 'My Shape',
  icon: 'Box',
  tags: ['spatial-canvas-tool'],
  supportedDatatypes: ['spatial-canvas'],
  async load() {
    return (await import('./my-shape/place-tool.js')).default
  },
},

// In the "Render layers" section
{
  type: 'patchwork:tool' as const,
  id: 'spatial-canvas-layer-my-shape',
  name: 'My Shape Layer',
  icon: 'Box',
  tags: ['spatial-canvas-layer'],
  supportedDatatypes: ['spatial-canvas'],
  async load() {
    return (await import('./my-shape/layer.js')).default
  },
},
```

Tag `spatial-canvas-tool` makes it appear in the toolbar. Tag `spatial-canvas-layer` makes `CanvasView` mount it as a render layer.

---

## Common variations

### Shape with no drag (click to place)

Like `PlaceTextTool`: record position in `onPointerDown`, commit on `onPointerUp` only if the pointer didn't move more than ~4 px.

### Free-form / stroke shape

Like `PenTool`: accumulate `[x, y, pressure]` points in `onPointerMove`, show an SVG preview appended to `.sc-layer`, commit the full points array on `onPointerUp`.

### Layer that needs pointer interaction

Like `ResizeLayer` or `EmbedLayer`: set `element.style.cssText = 'position:absolute;inset:0;'` (no `pointer-events:none`), then gate interaction on specific child elements with `pointer-events:auto`. Attach native `pointerdown/move/up` listeners to those children — **not** the canvas CustomEvents, which only go to the active tool.

### Reading per-user state

```ts
const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'
const color = handle.doc()?.stateByUser?.[contactUrl]?.color ?? '#000'
```

### Writing per-user state (e.g. switching back to select after placing)

```ts
handle.change(d => {
  if (!d.stateByUser[contactUrl]) d.stateByUser[contactUrl] = { selection: {}, color: '#1a1a1a' }
  d.stateByUser[contactUrl].selectedTool = 'spatial-canvas-tool-select'
})
```

### Keyboard shortcut

Add an entry to the `toolKeys` map in `CanvasView.bindEvents()` in `src/core/canvas.ts`:

```ts
const toolKeys: Record<string, string> = {
  v: 'spatial-canvas-tool-select',
  r: 'spatial-canvas-tool-place-rectangle',
  m: 'spatial-canvas-tool-my-shape',   // ← add
  …
}
```
