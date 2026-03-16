# Spatial Canvas: DOM-Only Implementation Notes

Based on analysis of tldraw's source. Goal: a spatial canvas using SolidJS + Automerge,
rendered purely with the DOM (no Canvas API, no WebGL). Starting point: a static renderer
for rectangles and lines.

---

## DOM Structure

tldraw's DOM structure is the key insight. The entire canvas is a single `div` that uses
CSS `transform: scale(z) translate(x, y)` to move all shapes at once:

```
.canvas  (touch-action: none; contain: strict; overflow: hidden)
  .html-layer  (width: 1px; height: 1px; contain: layout style size)
    .shape  (position: absolute; transform: matrix(a,b,c,d,e,f))
    .shape  (position: absolute; transform: matrix(a,b,c,d,e,f))
    ...
```

The `.html-layer` is intentionally `1px × 1px`. Shapes overflow out of it via
`position: absolute`. The tiny size means the layer contributes zero layout cost, and the
camera `scale + translate` transform applies from a consistent top-left origin.

Each shape div gets `position: absolute` with a CSS matrix transform encoding its full
affine transform (position + rotation). These are written **directly to `style`** —
never through framework state — so camera movement and shape movement are both O(1) DOM
writes with zero framework overhead.

**For our implementation:**

```
.canvas  (touch-action: none; contain: strict; overflow: hidden; width: 100%; height: 100%)
  .world  (width: 1px; height: 1px; contain: layout style size; transform-origin: 0 0)
    <For each shape>
      .shape  (position: absolute; transform-origin: top left)
```

---

## Camera / Coordinate System

### State

```ts
type Camera = { x: number; y: number; z: number }  // z = zoom level (1.0 = 100%)
```

### Transforms

```
// page → screen
screenX = (pageX + camera.x) * camera.z
screenY = (pageY + camera.y) * camera.z

// screen → page
pageX = screenX / camera.z - camera.x
pageY = screenY / camera.z - camera.y
```

The camera transform applied to `.world`:

```
transform: scale(${z}) translate(${x}px, ${y}px)
```

This is **written imperatively to the DOM** in a reactive effect — never as a prop/signal
that triggers a component re-render. In SolidJS, use `createEffect` with direct
`element.style.setProperty(...)`:

```ts
createEffect(() => {
  const { x, y, z } = camera()
  worldEl.style.setProperty('transform', `scale(${z}) translate(${x}px, ${y}px)`)
})
```

Because SolidJS's `createEffect` is synchronous when dependencies change, this is
effectively the same as tldraw's `useQuickReactor` pattern.

### Sub-pixel alignment

At non-integer zoom levels, the CSS matrix can place shapes at fractional pixel coordinates,
causing blurry rendering. tldraw addresses this by clamping all CSS values to 4 decimal
places via a `toDomPrecision` helper:

```ts
function toDomPrecision(v: number): string {
  return +v.toFixed(4) + ''
}
```

Truncating (not rounding) avoids creep. Apply to all `px` values in shape transforms.

### Shape transforms

Each shape has a local-space origin at its top-left corner. Its position in the world is
encoded as a CSS matrix:

```ts
// For a non-rotated shape:
// matrix(1, 0, 0, 1, tx, ty)  →  translate(tx, ty)

// For a rotated shape (angle in radians):
// matrix(cos, sin, -sin, cos, tx, ty)
function shapeToCss(x: number, y: number, rotation = 0): string {
  if (rotation === 0) return `translate(${toDomPrecision(x)}px, ${toDomPrecision(y)}px)`
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return `matrix(${toDomPrecision(cos)},${toDomPrecision(sin)},${toDomPrecision(-sin)},${toDomPrecision(cos)},${toDomPrecision(x)},${toDomPrecision(y)})`
}
```

Shape width/height are set as explicit `px` values on the container div — **rounded up to
the nearest device pixel** to prevent subpixel rendering artifacts:

```ts
function toDevicePixelSize(v: number, dpr: number): string {
  const multiple = 1 / dpr
  return Math.ceil(v / multiple) * multiple + 'px'
}
```

---

## Performance Patterns

### 1. Decouple camera from framework rendering

The single most important optimization. Camera movement (pan/zoom) must never trigger
framework re-renders. Every framework re-render during a pan causes a frame drop.

In SolidJS this is natural: write directly to the DOM element in a `createEffect`.
The effect subscribes to the camera signal and runs synchronously, bypassing the vDOM
diffing cycle entirely (SolidJS has no vDOM, but component re-renders still have overhead).

### 2. Decouple shape position/size from shape content

Shape containers (position, size, rotation, clip) should be updated via direct DOM writes
separate from the inner shape content. This means a shape moving never re-renders its SVG
or HTML content.

In SolidJS:

```tsx
// Container transform: fine-grained effect, writes directly to DOM
function Shape(props: { id: string }) {
  let el!: HTMLDivElement
  const shape = () => doc().shapes[props.id]

  createEffect(() => {
    el.style.setProperty('transform', shapeToCss(shape().x, shape().y, shape().rotation))
    el.style.setProperty('width', shape().w + 'px')
    el.style.setProperty('height', shape().h + 'px')
  })

  // Inner content: only re-renders when shape props change
  return (
    <div ref={el} class="shape">
      <ShapeContent shape={shape()} />
    </div>
  )
}
```

Since SolidJS's `<For>` is already fine-grained (it doesn't re-render all children when
one changes), this pattern naturally emerges when using Automerge as the source.

### 3. Viewport culling

Off-screen shapes should not render their content. tldraw replaces them with tiny empty
placeholder divs. The culling check runs only when the camera **stops moving** (after a
~64ms settling delay), not on every pan frame — remounting DOM content during a pan would
cause jank.

Implementation sketch:

```ts
// In page coordinates (no zoom applied)
function isInViewport(shape: Shape, camera: Camera, screenW: number, screenH: number): boolean {
  const margin = 100 / camera.z  // expand by 100px screen-space
  const vpLeft   = -camera.x - margin
  const vpTop    = -camera.y - margin
  const vpRight  = -camera.x + screenW / camera.z + margin
  const vpBottom = -camera.y + screenH / camera.z + margin
  return shape.x + shape.w >= vpLeft &&
         shape.x <= vpRight &&
         shape.y + shape.h >= vpTop &&
         shape.y <= vpBottom
}
```

Use a separate signal for "rendering set" that only updates after a debounce:

```ts
const [renderingSet, setRenderingSet] = createSignal(new Set(allShapeIds))

// Update culling only when camera settles
let cullingTimeout: ReturnType<typeof setTimeout>
createEffect(() => {
  camera()  // subscribe
  clearTimeout(cullingTimeout)
  cullingTimeout = setTimeout(() => {
    setRenderingSet(new Set(visibleShapeIds()))
  }, 64)
})
```

### 4. CSS containment

Add `contain: strict` to the canvas root and `contain: size layout` to each shape
container. This tells the browser that layout changes inside a shape cannot affect
anything outside it, enabling independent compositing:

```css
.canvas {
  contain: strict;
  overflow: hidden;
  touch-action: none;
}

.world {
  contain: layout style size;
  width: 1px;
  height: 1px;
  transform-origin: 0 0;
}

.shape {
  contain: size layout;
  position: absolute;
  transform-origin: top left;
}
```

### 5. z-index as data

tldraw assigns integer z-indices to shapes from their position in the document's ordered
shape array. Since z-index is only needed for stacking order (not layout), it can be set
as a `style.zIndex` write rather than as a prop. This means reordering shapes never
triggers content re-renders.

### 6. CSS zoom variable

A `--canvas-zoom` CSS custom property set on the canvas root lets shapes define
zoom-invariant stroke widths:

```css
.canvas { --canvas-zoom: 1; }
.shape-line { stroke-width: calc(2px / var(--canvas-zoom)); }
```

Update it in the camera effect. When there are many shapes, debounce 100ms during fast
zoom (tldraw's threshold is 300 shapes).

---

## Browser Workarounds

### Prevent native pan/zoom

The #1 source of bugs. Every browser wants to handle scroll/zoom on its own terms.

**`touch-action: none`** on the canvas is mandatory. Without it, the browser intercepts
pointer events for its own scrolling and the custom pan implementation fights it.

**Block Ctrl+scroll zoom** at the document level:

```ts
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault()
}, { passive: false })
```

Must be `passive: false` — passive listeners cannot call `preventDefault`.

**Block browser keyboard zoom** (Ctrl+`=`/`-`/`0`):

```ts
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && ['=', '-', '0'].includes(e.key)) {
    e.preventDefault()
  }
})
```

**Safari multi-touch gestures**: Safari fires non-standard `gesturestart`/`gesturechange`/
`gestureend` events. Without blocking them, Safari's native pinch zoom fires on top of
the custom handler:

```ts
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}
```

**iOS edge swipe navigation**: `touchstart` events within 10px of the left/right screen
edge trigger iOS back/forward navigation. Block them:

```ts
document.addEventListener('touchstart', (e) => {
  const touch = e.touches[0]
  if (touch.clientX < 10 || touch.clientX > window.innerWidth - 10) {
    e.preventDefault()
  }
}, { passive: false })
```

**iOS font-size zoom**: Any `<input>` or `<textarea>` with `font-size < 16px` causes iOS
to zoom the page. Always use `font-size: 16px` minimum for text inputs on the canvas.

### Wheel normalization

Trackpad, mouse wheel, and browser-synthesized wheel events have wildly different delta
magnitudes. Apply a clamp for zoom gestures:

```ts
function normalizeWheelDelta(e: WheelEvent): { dx: number; dy: number } {
  let dx = e.deltaX
  let dy = e.deltaY

  // Normalize units (some browsers send pixels, some lines, some pages)
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    dx *= 16; dy *= 16
  } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    dx *= window.innerWidth; dy *= window.innerHeight
  }

  // Shift key swaps axes (standard on non-Mac for horizontal scroll)
  if (e.shiftKey && !isMac()) {
    [dx, dy] = [dy, dx]
  }

  // Clamp zoom step to prevent huge jumps on high-res trackpads
  if (e.ctrlKey || e.metaKey) {
    const MAX_STEP = 10
    dy = Math.max(-MAX_STEP, Math.min(MAX_STEP, dy))
  }

  return { dx, dy }
}
```

### Pointer capture

When a pointer-down starts a drag, capture the pointer so events continue firing even if
the pointer leaves the canvas element:

```ts
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId)
})
```

### Touch event double-handling

When the browser fires both `touch*` and `pointer*` events for the same gesture (which
it does on touch screens), only handle one. Set `touch-action: none` and use only
`pointer*` events. Optionally, `preventDefault` on `touchstart` to suppress the touch path:

```ts
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
canvas.addEventListener('touchend',   (e) => e.preventDefault(), { passive: false })
```

### Firefox coarse-pointer misreport

Firefox on desktop can report `(pointer: coarse)` incorrectly. If you use this media
query to adjust hit targets, detect `userAgent.includes('Firefox')` and override to
`fine` on non-mobile platforms.

### `pointerleave` on SVG elements

`setPointerCapture` does not work on SVG elements in most browsers. If any shape uses
`<svg>` as its root, walk up the DOM to the nearest HTML element to call
`setPointerCapture` on it.

---

## Automerge Schema

For the initial static renderer, a flat record structure keyed by shape ID works well
with Automerge's CRDT semantics:

```ts
type RectangleShape = {
  type: 'rectangle'
  x: number; y: number
  w: number; h: number
  rotation?: number
  fill: string
  stroke: string
  strokeWidth: number
}

type LineShape = {
  type: 'line'
  x1: number; y1: number
  x2: number; y2: number
  stroke: string
  strokeWidth: number
}

type Shape = RectangleShape | LineShape

type CanvasDoc = {
  shapes: Record<string, Shape>  // keyed by UUID
  order: string[]                // z-order; array of shape IDs
  camera: { x: number; y: number; z: number }
}
```

Camera state does **not** need to be in Automerge — it's local-only UI state (different
users pan to different places). Keep camera in a SolidJS signal.

Shapes should be in Automerge (collaborative). The `order` array being an Automerge
list means concurrent reordering operations are resolved by Automerge's list CRDT.

**Important**: Never assign an Automerge proxy object to another Automerge field.
Reconstruct plain objects when copying shape data:

```ts
repo.change(handle, (doc) => {
  doc.shapes[newId] = { type: 'rectangle', x: p.x, y: p.y, w: 100, h: 100, ... }
  //                                        ^ plain object literal, not from doc
})
```

---

## SolidJS Rendering Architecture

```tsx
function Canvas(props: { doc: Accessor<CanvasDoc> }) {
  let worldEl!: HTMLDivElement
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, z: 1 })

  // Camera transform: direct DOM write, never re-renders shapes
  createEffect(() => {
    const { x, y, z } = camera()
    worldEl.style.setProperty(
      'transform',
      `scale(${toDomPrecision(z)}) translate(${toDomPrecision(x)}px, ${toDomPrecision(y)}px)`
    )
    worldEl.style.setProperty('--canvas-zoom', String(z))
  })

  return (
    <div class="canvas" onWheel={handleWheel} onPointerDown={handlePointerDown}>
      <div ref={worldEl} class="world">
        <For each={props.doc().order}>
          {(id) => <Shape id={id} shape={() => props.doc().shapes[id]} />}
        </For>
      </div>
    </div>
  )
}

function Shape(props: { id: string; shape: Accessor<Shape> }) {
  let el!: HTMLDivElement

  // Position/size: direct DOM write
  createEffect(() => {
    const s = props.shape()
    el.style.setProperty('transform', shapeToCss(s.x, s.y, s.rotation ?? 0))
    el.style.setProperty('width', toDomPrecision(s.w) + 'px')
    el.style.setProperty('height', toDomPrecision(s.h) + 'px')
  })

  return (
    <div ref={el} class="shape">
      <Switch>
        <Match when={props.shape().type === 'rectangle'}>
          <RectangleShape shape={props.shape as Accessor<RectangleShape>} />
        </Match>
        <Match when={props.shape().type === 'line'}>
          <LineShape shape={props.shape as Accessor<LineShape>} />
        </Match>
      </Switch>
    </div>
  )
}
```

`<For>` in SolidJS keys by value and only mounts/unmounts components when IDs are
added/removed — moving a shape (changing its x/y in Automerge) never remounts the
component, it just triggers the `createEffect` that writes the new transform.

---

## Static Renderer: Shape Components

Rectangles and lines use `<svg>` as their root, sized to match the shape container:

```tsx
function RectangleShape(props: { shape: Accessor<RectangleShape> }) {
  return (
    <svg
      width={props.shape().w}
      height={props.shape().h}
      style={{ overflow: 'visible' }}
    >
      <rect
        x={0} y={0}
        width={props.shape().w}
        height={props.shape().h}
        fill={props.shape().fill}
        stroke={props.shape().stroke}
        stroke-width={props.shape().strokeWidth}
      />
    </svg>
  )
}

function LineShape(props: { shape: Accessor<LineShape> }) {
  // The shape div is positioned at the line's bounding box origin.
  // Line coords are relative to that origin.
  const s = props.shape
  const x = () => Math.min(s().x1, s().x2)
  const y = () => Math.min(s().y1, s().y2)
  const w = () => Math.abs(s().x2 - s().x1)
  const h = () => Math.abs(s().y2 - s().y1)

  return (
    <svg
      width={w()} height={h()}
      style={{ overflow: 'visible', position: 'absolute', top: 0, left: 0 }}
    >
      <line
        x1={s().x1 - x()} y1={s().y1 - y()}
        x2={s().x2 - x()} y2={s().y2 - y()}
        stroke={s().stroke}
        stroke-width={s().strokeWidth}
        stroke-linecap="round"
      />
    </svg>
  )
}
```

---

## What We're Skipping (for now)

tldraw has significant complexity that is not needed for a static renderer:

- **Geometry system** (`Geometry2d`, `Rectangle2d`, `Polyline2d`, etc.) — needed for hit
  testing, snapping, and selection handles. Implement when adding interaction.
- **Affine matrix class** (`Matrix2d`) — needed for rotated shape transforms and
  coordinate space conversions. For axis-aligned shapes, simple x/y is enough.
- **Viewport culling** — worthwhile at ~500+ shapes. Start simple and add when needed.
- **Camera animation** (`TickManager`, RAF loop) — only needed for animated pan/zoom.
  For programmatic camera updates, direct signal writes are fine.
- **SVG defs layer** — useful for shared patterns (fills, arrowheads). Add when shapes
  need shared SVG resources.
- **`@use-gesture`** — a solid library for normalizing wheel/pinch/drag. Worth adding
  once interaction is more complex; for MVP, a raw `onWheel` handler works.
