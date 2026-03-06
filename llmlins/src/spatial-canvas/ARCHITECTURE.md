# Spatial Canvas — Architecture

## Overview

A spatial canvas patchwork tool: an infinite, zoomable canvas where each "shape" is a
**patchwork-view element** — a live tool rendered from an `AutomergeUrl` (doc-url) and a `toolId`
(string). The canvas itself is also a patchwork document, storing the layout of those shapes.

The design is directly informed by tldraw v1's rendering architecture, adapted for:

- **No React / no MobX / no Zustand** — plain TypeScript throughout
- **Automerge as the document layer** — shape positions, sizes, and patchwork references are CRDT data
- **Camera state is ephemeral** — pan position and zoom level are never written to the Automerge document; they live in local variables only
- **Patchwork-view as the shape renderer** — we never render shape geometry ourselves; we mount/unmount patchwork-view elements and position them with CSS transforms

---

## Core Insight: Three Separate Update Paths

Inherited directly from tldraw. There are three fundamentally different kinds of change, each
handled by a completely different mechanism:

```
1. Camera pan/zoom      → direct DOM style.setProperty via plain function call (no framework)
2. Shape position/size  → direct DOM style.setProperty via plain function call (no framework)
3. Shape content        → patchwork-view mount/unmount, driven by Automerge doc changes
```

Framework code is deliberately kept out of the hot path for camera and position updates. This is
what makes smooth 60fps pan/zoom possible even with hundreds of shapes on screen.

---

## Data Model

### Automerge Document (`CanvasDoc`)

```typescript
interface CanvasShape {
  id: string
  x: number            // top-left in page coordinates
  y: number
  width: number
  height: number
  rotation: number     // radians
  zIndex: number
  docUrl: AutomergeUrl // the patchwork document to render inside this shape
  toolId: string       // which patchwork tool to use for rendering
  shapeType: 'embed' | 'token'  // controls chrome and resize behaviour
}

interface CanvasDoc {
  shapes: Record<string, CanvasShape>  // flat id→shape map, O(1) lookups
}
```

**Why flat map?** O(1) lookups, trivially mergeable Automerge patches, simple to iterate for
culling. Follows tldraw's `Record<id, TDShape>` approach exactly.

**Z-order** is encoded in a numeric `zIndex` field, not array position, so Automerge merges never
produce conflicting orderings from concurrent reorders.

### Ephemeral State (never in Automerge)

```typescript
interface Camera {
  x: number      // pan offset in page coordinates
  y: number
  zoom: number   // 1 = 100%, 0.5 = 50%, 2 = 200%
}

interface EphemeralState {
  camera: Camera
  hoveredId: string | null
  selectedIds: Set<string>
  isDragging: boolean
  performanceMode: PerformanceMode
  viewportBounds: Rect   // recomputed on camera change + resize
}
```

Camera is intentionally not synced to other peers — each user has their own independent viewport.

---

## Reactivity: Why We Don't Need a Signal System

tldraw uses MobX `autorun` to connect camera and position state to direct DOM mutations. We don't
need an equivalent reactive library because our update graph is **simple and static**:

- Camera changes when the user pans or zooms → call `updateCamera()` directly
- Automerge fires `handle.on('change', ...)` when shapes change → call `reconcileShapeTree()`
- `ResizeObserver` fires when the canvas resizes → update viewport, call `reconcileShapeTree()`

There are only two async sources of change (user input and Automerge), and neither requires
automatic dependency tracking. A signal/effect system would add indirection without benefit. Plain
callbacks are sufficient.

The key performance property — that camera and position updates bypass any framework and write
directly to `element.style` — is preserved by simply calling the update functions directly.

---

## DOM Structure

```
<div class="sc-container">         CSS variable host; --sc-zoom target
  <div class="sc-canvas">          pointer event target; ResizeObserver target
    <div class="sc-layer">         ← THE TRANSFORM LAYER (zero-sized; camera transform target)
      <div class="sc-shapes">
        <div class="sc-shape" />*  one per VISIBLE shape
          <div class="sc-positioned">   transform: translate + rotate; contain: layout style size
            <patchwork-view />          the actual tool content
      <div class="sc-handles" />   resize / selection handles (children of sc-layer)
      <div class="sc-brush" />     selection rectangle (child of sc-layer)
    </div>
    <div class="sc-cursors" />     multiplayer cursors — OUTSIDE sc-layer (screen space)
    <div class="sc-overlay" />     snap lines — OUTSIDE sc-layer (replicates camera transform manually)
  </div>
</div>
```

`.sc-layer` is **zero-sized** (`width: 0; height: 0`). All shape containers overflow out of it.
This is intentional — the element is a pure transform anchor, not a layout container.
`contain: size` on a zero-sized element means the browser never measures its content. The layer's
transform can be updated entirely in the compositor thread.

---

## Camera / Pan / Zoom

Camera state is a plain mutable object. `updateCamera()` writes directly to the DOM — no
framework reconciler, no reactive subscription:

```typescript
let camera: Camera = { x: 0, y: 0, zoom: 1 }

function updateCamera(next: Camera) {
  camera = next

  // 1. Update the CSS variable (flows into --sc-scale for counter-scaling)
  container.style.setProperty('--sc-zoom', camera.zoom.toString())

  // 2. Update the layer transform
  layer.style.setProperty(
    'transform',
    `scale(${camera.zoom}) translateX(${camera.x}px) translateY(${camera.y}px)`
  )

  updateViewport()
}
```

**Transform order matters.** CSS transforms compose right-to-left, so the translate is applied
first (in page coordinates) then the scale. `x` and `y` are in page coordinates, not screen
coordinates. Pan is uniform across zoom levels.

### CSS Variable Cascade

```css
:root {
  --sc-zoom: 1;
  --sc-scale: calc(1 / var(--sc-zoom));                       /* inverse of zoom */
  --sc-padding: calc(64px * max(1, var(--sc-scale)));         /* grows when zoomed out */
}
```

`--sc-scale` flows into everything that must stay constant pixel size at any zoom level:
- `stroke-width: calc(2px * var(--sc-scale))` — selection outlines
- `.sc-counter-scaled { transform: scale(var(--sc-scale)) }` — handle icons
- `border-radius: calc(4px * var(--sc-scale))` — selection box corners

One `style.setProperty` on `.sc-container` instantly propagates to every element in the canvas
through the CSS variable cascade — no per-element JS needed.

---

## Shape Positioning

Shape positions also bypass any framework. Each mounted shape exposes an `updatePosition`
function that writes directly to the DOM — called from `reconcileShapeTree()` whenever Automerge
delivers a position change:

```typescript
function mountShape(shape: CanvasShape, el: HTMLElement): MountedShape {
  function updatePosition(s: CanvasShape) {
    el.style.setProperty(
      'transform',
      `translate(
        calc(${s.x}px - var(--sc-padding)),
        calc(${s.y}px - var(--sc-padding))
      ) rotate(${s.rotation}rad)`
    )
    el.style.setProperty('width',  `calc(${Math.floor(s.width)}px  + var(--sc-padding) * 2)`)
    el.style.setProperty('height', `calc(${Math.floor(s.height)}px + var(--sc-padding) * 2)`)
  }

  updatePosition(shape)

  return { updatePosition, unmount: () => el.remove() }
}
```

**Key details borrowed from tldraw:**

- **`transform` not `top`/`left`** — transform changes are compositor-only; they never trigger
  layout or paint, and never cause sibling/parent reflow
- **`Math.floor` on width/height** — prevents sub-pixel rounding differences between frames from
  triggering unnecessary paints
- **Padding system** — every shape container is `--sc-padding` larger on all sides. The translate
  subtracts this padding. At low zoom, padding grows to ensure selection indicators and hit areas
  remain usable even when the shape renders tiny on screen

---

## Shape Types

`shapeType` controls how a shape's content area is rendered. There are two types:

### `'embed'` — framed card with chrome

```
┌─────────────────────────────────────┐
│ [doc-name]              [tool ▾]    │  ← titlebar
├─────────────────────────────────────┤
│                                     │
│   <patchwork-view>                  │
│                                     │
└─────────────────────────────────────┘
```

Implemented in `embed.ts` → `mountEmbed(container, shape, onToolChange, getTools?)`.

- The titlebar doc-name area is `pointer-events: none` so dragging it moves the shape
- The tool `<select>` is `pointer-events: auto`; choosing a value calls `onToolChange(newToolId)`,
  which writes the new toolId back to the Automerge document
- If `getTools` is provided (via `CanvasViewOptions`), the select is populated asynchronously with
  the list of tools compatible with the document; otherwise it shows only the current toolId
- Once the user clicks inside the content area, pointer/keyboard/wheel events are stopped from
  reaching the canvas so the embedded tool receives them unimpeded. Clicking outside the card
  returns event routing to the canvas.
- Embed shapes are **resizable** — resize handles are shown when selected

### `'token'` — bare patchwork-view, no chrome

Implemented in `token.ts` → `mountToken(container, shape)`.

- Mounts `<patchwork-view doc-url="..." tool-id="...">` directly filling the container
- No border, no titlebar, no background
- Token shapes are **not resizable** — resize handles are suppressed when a token is selected
  (the selection outline is still drawn)

### Content mounter dispatch

The default `ContentMounter` in `canvas.ts` dispatches on `shapeType`:

```typescript
(container, shape) => {
  if (shape.shapeType === 'token') return mountToken(container, shape)
  return mountEmbed(container, shape,
    newToolId => handle.change(doc => { doc.shapes[shape.id].toolId = newToolId }),
    options.getTools
  )
}
```

Host applications can override this entirely via `CanvasViewOptions.mountContent`.

---

## Patchwork-View Integration

Each visible shape mounts a `patchwork-view` custom element inside its `.sc-shape-content`
container. The spatial canvas controls:
1. **Whether** the element is mounted (viewport culling)
2. **Where** it appears on screen (the `.sc-positioned` transform)
3. **Which doc + tool** it renders (from the `CanvasShape` data in Automerge)

patchwork-view handles all its own internal rendering and reactivity.

When the `docUrl` or `toolId` of a shape changes in Automerge, the old content is unmounted and
new content is mounted. Position-only changes never touch the content element at all — they only
update the CSS transform of the containing `.sc-positioned` div.

---

## Viewport Culling

The visible viewport in page coordinates is derived from the camera:

```typescript
function computeViewport(camera: Camera, screenBounds: Rect): Rect {
  return {
    x: -camera.x,
    y: -camera.y,
    width:  screenBounds.width  / camera.zoom,
    height: screenBounds.height / camera.zoom,
  }
}
```

On every camera change and on ResizeObserver firing, `updateViewport()` is called directly:

```typescript
function updateViewport() {
  const viewport = computeViewport(camera, screenBounds)
  const shapes = Object.values(canvasDoc.shapes)

  const visible = shapes.filter(shape =>
    selectedIds.has(shape.id) ||       // selected shapes always rendered (drag to edge)
    rectsIntersect(viewport, shapeBounds(shape))
  )

  reconcileShapeTree(visible)
}

// Called from:
//   updateCamera(next)           → on every pan/zoom
//   resizeObserver callback      → on canvas resize
//   handle.on('change', ...)     → on Automerge shape changes
```

`reconcileShapeTree` is a lightweight keyed reconciler (a `Map<id, MountedShape>`) that:
- Mounts new shapes that entered the viewport
- Calls `updatePosition()` for shapes that stayed visible and changed position
- Unmounts shapes that left the viewport

No framework — just a `Map<id, MountedShape>` tracking what is currently in the DOM.

---

## CSS Isolation: `contain: layout style size`

Every shape container gets full CSS containment:

```css
.sc-layer     { contain: layout style size; }
.sc-shape     { contain: layout style size; }
.sc-positioned{ contain: layout style size; }
.sc-handles   { contain: layout style size; }
.sc-brush     { contain: layout style size; }
```

`contain: layout style size` creates a fully isolated layout context — changes inside cannot
affect layout outside, and the browser doesn't need to consult children to compute the element's
size. Without this, moving any single shape could cause the browser to reflow the entire page.
With it, each shape container is fully isolated.

This is arguably the most impactful single CSS property in the implementation. It's what allows
the canvas to handle hundreds of shapes without browser jank.

---

## Performance Modes

This technique is taken directly from tldraw's `usePerformanceCss.ts` / `TLPerformanceMode`.

During active interactions, shape containers are promoted to GPU compositor layers. This is done
via two CSS custom properties on `.sc-container`, so a single `style.setProperty` call on the
root instantly promotes or demotes every shape:

```typescript
enum PerformanceMode {
  Idle,
  TranslateSelected,   // dragging selected shapes
  TranslateAll,        // panning the canvas
  TransformSelected,   // resizing selected shapes
}

function applyPerformanceMode(mode: PerformanceMode, container: HTMLElement) {
  switch (mode) {
    case PerformanceMode.TranslateSelected:
      container.style.setProperty('--sc-perf-all',      'auto')
      container.style.setProperty('--sc-perf-selected', 'transform')
      break
    case PerformanceMode.TranslateAll:
      container.style.setProperty('--sc-perf-all',      'transform')
      container.style.setProperty('--sc-perf-selected', 'transform')
      break
    case PerformanceMode.TransformSelected:
      container.style.setProperty('--sc-perf-all',      'auto')
      container.style.setProperty('--sc-perf-selected', 'transform, contents')
      break
    default:
      container.style.setProperty('--sc-perf-all',      'auto')
      container.style.setProperty('--sc-perf-selected', 'auto')
  }
}
```

```css
.sc-positioned          { will-change: var(--sc-perf-all); }
.sc-positioned-selected { will-change: var(--sc-perf-selected); }
```

`will-change: transform` — creates a compositor layer; the browser can animate the transform on
the GPU thread without consulting the main thread.

`will-change: transform, contents` — additionally signals that the element's painted content will
change; the browser may pre-rasterize it to a texture.

No `translateZ(0)` hacks. GPU promotion happens exclusively through `will-change`.

---

## Gesture & Input Handling

### Pointer Events

All pointer handling is raw `addEventListener` on `.sc-canvas`. A single `Inputs` class normalizes
browser events into typed canvas-space coordinates:

```typescript
class Inputs {
  screenToPage(screenX: number, screenY: number, camera: Camera): { x: number; y: number }
  onPointerDown(e: PointerEvent): PointerInfo
  onPointerMove(e: PointerEvent): PointerInfo
  onPointerUp(e: PointerEvent): PointerInfo
}
```

`setPointerCapture` is called on pointer-down so drags continue to deliver events even when the
pointer leaves the canvas element.

### Tool / Session Pattern

Inherited from tldraw's Tool/Session separation:

- **Tools** are persistent event routers, one active at a time: `SelectTool`, `PanTool`, `PlaceTool`
- **Sessions** are transient drag handlers: `TranslateSession` (moving shapes),
  `ResizeSession` (resizing), `PanSession` (panning the canvas), `BrushSession` (marquee select)

```typescript
interface Session {
  start(info: PointerInfo): void
  update(info: PointerInfo): void
  complete(info: PointerInfo): Command | null  // null = no undo entry
  cancel(): void
}
```

`complete()` returning a `Command` pushes onto the undo stack; returning null is for operations
like camera pan that don't belong in undo history.

### Wheel / Trackpad / Pinch

```typescript
canvas.addEventListener('wheel', handler, { passive: false })  // must be non-passive to preventDefault

// Disambiguation (same as tldraw — no explicit detection needed):
if ((e.ctrlKey || e.altKey) && e.buttons === 0) {
  // zoom: ctrl+scroll = trackpad pinch (browsers report as ctrlKey=true)
  //       alt+scroll  = explicit zoom shortcut
} else {
  // pan: trackpads produce X+Y delta, mice produce Y only — falls out naturally
  const dx = e.shiftKey ? e.deltaY : e.deltaX
  const dy = e.shiftKey ? 0        : e.deltaY
}
```

Touch pinch is handled via `pointermove` with two active pointers (no dependency on
`@use-gesture/react`).

Zoom is clamped to `[0.05, 8]`.

### CSS: Prevent Browser Interference

```css
.sc-container {
  touch-action: none;           /* disable native pan/zoom/tap-delay */
  overscroll-behavior: none;    /* disable rubber-band scroll on iOS/Android */
  user-select: none;
}

.sc-canvas {
  overflow: clip;               /* clip without creating a scroll container */
                                /* (overflow: hidden creates a scroll container, breaks fixed) */
}
```

---

## Undo / Redo

Follows tldraw's patch-based command pattern, but applied over Automerge:

```typescript
interface Command {
  before: Partial<Record<string, CanvasShape | null>>  // shape states before the action
  after:  Partial<Record<string, CanvasShape | null>>  // shape states after
}
```

`null` means "this shape did not exist" (for create/delete commands). Applying a patch:

```typescript
function applyPatch(handle: DocHandle<CanvasDoc>, patch: Command['after']) {
  handle.change(doc => {
    for (const [id, shape] of Object.entries(patch)) {
      if (shape === null) delete doc.shapes[id]
      else doc.shapes[id] = shape
    }
  })
}
```

Undo is instantaneous — it re-applies the `before` patch. No action replay.

Ephemeral operations (camera pan, hover, selection) are never put on the undo stack. In-progress
drag operations use a "shadow" in-memory state for live preview, only committing to Automerge on
pointer-up.

---

## Multiplayer via Automerge

All shape mutations go through `handle.change(...)`. Automerge's CRDT semantics handle concurrent
edits:

- **Concurrent move** — last-writer-wins on `x`/`y` (Automerge scalar merge)
- **Concurrent create** — both shapes appear (unique IDs prevent conflicts)
- **Concurrent delete + move** — delete wins (shape is absent from one peer's doc; the moving peer
  will receive the delete on sync and reconcile)

Remote changes arrive via `handle.on('change', ...)`. The renderer subscribes to this and calls
`updateViewport()` to diff the incoming shapes against the current DOM state. Position-only
diffs call `updatePosition()` directly on the mounted shape; content diffs (docUrl/toolId change)
remount the patchwork-view element.

Multiplayer cursors are transmitted via Automerge ephemeral data (not the main document), rendered
in `.sc-cursors` which sits **outside** `.sc-layer` (in screen space). Each cursor position is
converted from the remote peer's page coordinates to screen coordinates using the local camera
before rendering — each user sees remote cursors at the correct screen position regardless of their
own zoom/pan.

---

## Shape AABB Computation

The bounds of a shape (for culling, hit testing, selection box computation) are computed as:

```typescript
function shapeBounds(shape: CanvasShape): Rect {
  // Axis-aligned bounding box of the rotated shape
  if (!shape.rotation) {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
  }
  // For rotated shapes, compute AABB of the four rotated corners
  const corners = rotatedCorners(shape)
  return aabbFromPoints(corners)
}
```

For viewport culling only the AABB is needed. For precise hit testing (is a pointer inside the
shape?), the point is inverse-rotated into the shape's local frame and tested against the
unrotated rectangle.

---

## Selection & Handles

Selection state is ephemeral (a local `Set<string>`) — not stored in Automerge.

Selection handles (resize corners, rotate handle) are rendered in `.sc-handles` which is inside
`.sc-layer` and therefore in page coordinates. Handle sizes are divided by zoom to remain
constant pixel size on screen:

```typescript
const handleSize = 8 / camera.zoom         // visible square
const hitSize    = 16 / camera.zoom         // invisible hit area

// Progressive disclosure — hide handles when shape is too small on screen
const screenMin = Math.min(shape.width, shape.height) * camera.zoom
const showRotate  = screenMin > 32
const showEdges   = screenMin > 24
const showCorners = screenMin > 20
```

The `.sc-handles` element is counter-scaled to keep handle rendering sharp regardless of the
layer's CSS zoom transform.

**Token shapes suppress resize handles.** When the single selected shape has
`shapeType === 'token'`, `refreshHandles()` renders the selection outline but returns before
adding corner or edge handles. The shape's position and zIndex can still be changed; only resizing
is disabled.

---

## Module Structure

```
src/
  index.ts             — package entry point: re-exports all plugins and public API
  spatial-canvas/
    index.ts           — plugin exports: SpatialCanvasDatatype, Tool, plugins
    canvas.ts          — main entry: CanvasView class, mounts/unmounts everything
    inputs.ts          — Inputs class: event normalization, screen↔page coordinate transform
    camera.ts          — camera state + updateCamera(); viewport computation
    shape-tree.ts      — viewport culling + keyed DOM reconciler
    shape-mount.ts     — mounts a single shape: updatePosition() + content lifecycle
    embed.ts           — mountEmbed(): framed card with titlebar + tool <select> + patchwork-view
    token.ts           — mountToken(): bare patchwork-view, no chrome
    types.ts           — shared TypeScript types: CanvasDoc, CanvasShape, Camera, Disposer, etc.
    performance.ts     — PerformanceMode enum + applyPerformanceMode(); GPU layer promotion
    commands.ts        — Command factories: createShape, deleteShapes, translateShapes, resizeShape
    tools/
      select.ts        — SelectTool: pointer routing for move/resize/rotate/brush
      pan.ts           — PanTool: middle-click and space+drag panning
      place.ts         — PlaceTool: drag to place a new embed shape
    sessions/
      translate.ts     — TranslateSession: drag to move selected shapes
      resize.ts        — ResizeSession: drag corner/edge handles to resize
      pan.ts           — PanSession: drag to pan the camera (ephemeral, no undo)
      brush.ts         — BrushSession: drag to marquee-select shapes
    math/
      vec.ts           — 2D vector math (add, sub, scale, dist, rotate, lerp)
      rect.ts          — Rect utilities (intersect, contain, AABB from points)
    css/
      canvas.css       — .sc-container, .sc-canvas, .sc-layer, contain rules, CSS variables
      shapes.css       — .sc-shape, .sc-positioned, will-change rules
      handles.css      — .sc-handles, counter-scale, handle sizing
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **DOM + CSS transforms, not `<canvas>`** | patchwork-view elements are HTML; native input, focus, and scroll work inside shapes |
| **Camera not in Automerge** | Each peer has an independent viewport; syncing it would create conflicts with no benefit |
| **Flat shape store** (`Record<id, CanvasShape>`) | O(1) lookups, trivially mergeable Automerge patches, simple culling iteration |
| **Patch-based undo** (`{before, after}`) | Instantaneous undo, no action replay, serializable; same as tldraw's approach |
| **No signal/reactive library** | Update graph is static; direct function calls are simpler and sufficient |
| **`contain: layout style size` everywhere** | Each shape container is a fully isolated layout context; prevents cross-shape reflow |
| **`will-change` via CSS variables** | One `setProperty` on `.sc-container` promotes/demotes every shape simultaneously |
| **`overflow: clip` not `overflow: hidden`** | Avoids creating a scroll container, which breaks compositing and `position: fixed` |
| **Tool/Session separation** | Tools are persistent event routers; sessions own transient drag state |
| **Content remount only on docUrl/toolId change** | Position changes never touch the content element — only its CSS transform wrapper |
| **`shapeType` field drives chrome and resize behaviour** | Embed shapes get a titlebar + tool picker and are resizable; token shapes are chrome-free and non-resizable |
| **Tool picker is a plain `<select>`** | No dependency on patchwork-plugins; tools supplied via optional `getTools` callback on `CanvasViewOptions`; falls back to showing the current toolId |
