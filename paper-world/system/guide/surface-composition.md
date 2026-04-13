# Surface Composition

Every visual object lives on a **surface** (a `ref-view` that manages a shapes store). Surfaces can themselves be shapes on other surfaces, forming an arbitrarily deep nesting hierarchy.

## The Surface Contract

A surface is any `ref-view` element that implements `surfaceSchema` (a key-value store of shapes) and `cameraSchema` (a set of methods for coordinate conversion). The methods are stamped directly onto the DOM element:

| Method | Purpose |
|---|---|
| `screenToPage(clientX, clientY)` | Convert browser viewport coordinates to the surface's internal page coordinates. |
| `pageToScreen(pageX, pageY)` | Convert page coordinates back to viewport coordinates. |
| `getCamera()` | Returns `{ x, y, zoom }` — current pan and zoom. |
| `setCamera(cam)` | Update the camera. |
| `subscribeCamera(fn)` | Observe camera changes. Returns an unsubscribe function. |
| `getContainerEl()` | Returns the DOM element that clips shape content. |
| `getScale()` | Returns the effective visual scale: camera zoom × ancestor CSS transforms. |

Two implementations exist today:

- **Paper** (`paper/paper.js`) — A CSS-transform-based pan+zoom surface. Camera is applied as `scale() translate()` on an inner div. Shapes are positioned with `position: absolute`.
- **Map** (`map/tool.js`) — A MapLibre geographic surface. Coordinates go through Mercator projection (`map.unproject` / `map.project`). Shapes are positioned by projecting their geographic bounds to screen pixels each frame.

Both stamp the same methods onto their `element`, so consumers can't tell them apart.

## Shape Properties

A shape is a record in a surface's `surfaceSchema` store. Each shape has two top-level fields:

```ts
type Shape = {
  viewUrl: string;
  data: {
    x: number;
    y: number;
    [key: string]: unknown;
  };
};
```

`viewUrl` determines which tool renders the shape. All positioning and tool-specific properties live in `data`:

| Property (in `data`) | Used by | Purpose |
|---|---|---|
| `x`, `y` | all shapes | Position in page coordinates. |
| `width`, `height` | rectangles, embeds | Bounding dimensions. |
| `points` | lines, markers | Array of `[offsetX, offsetY, pressure]` tuples relative to `(x, y)`. |
| `color` | lines, markers, rectangles | Stroke or fill color. |
| `scale` | any shape | Visual scale factor (default 1). Set when a shape moves between surfaces at different zoom levels to preserve its apparent size. |
| `strokeScale` | pen tools (line, rainbow-marker, sparkle-marker, eraser) | Ratio of root surface scale to draw surface scale at the time the stroke was created. Used to normalize stroke rendering so strokes look the same regardless of which surface they were drawn on. |
| `z` | any shape | Z-index for layering. |
| `isLocked` | any shape | Prevents selection, dragging, and deletion. Used for toolbar button shapes. |
| `text` | text shapes | The text content. |

## Nesting

A surface is itself a shape on another surface. The DOM looks like:

```
root paper (ref-view)
  └─ camera div (CSS transform: scale + translate)
      └─ shape wrapper div (position: absolute at shape.data.x, shape.data.y)
          └─ ref-view (viewUrl → e.g. map/tool.json)
              ├─ implements cameraSchema (its own coordinate space)
              └─ has its own surfaceSchema store
```

The outer surface sees the nested surface as a single shape record. The nested surface independently manages its own shapes, camera, and coordinate system.

This composes to any depth: a paper inside a map inside a paper, etc.

## How Tools Find Their Surface

Tools (toolbar buttons) are shapes themselves. On mount, a tool finds its owning surface by walking up the `ref-view` hierarchy:

```js
const surface = element.findParent(surfaceSchema);
```

This returns the nearest ancestor `ref-view` that manages a shapes store.

## Drawing Into Nested Surfaces

When a tool handles a pointer event, it resolves which surface the user actually clicked on using `findTargetSurface`:

```js
const targetSurface = findTargetSurface(event.target, surface);
```

This finds the innermost surface containing the click target, constrained to be the root surface or a descendant of it. The tool then creates shapes in that surface's store and uses that surface's `screenToPage` for coordinate conversion.

For pen tools (line, rainbow-marker, sparkle-marker, eraser), the stroke must look the same regardless of the target surface's zoom level. They compute:

```js
const rootScale = surface.getScale();
const drawScale = drawSurface.getScale();
const strokeScale = rootScale / drawScale;
```

This ratio is stored on the shape. The rendering tool normalizes input points by dividing by `strokeScale`, calls `getStroke` with a fixed size, then scales the outline back up.

## Selecting Across Nesting Levels

The selection tool starts from the innermost surface and walks up:

```js
let sourceSurface = findTargetSurfaceContext(event.target) ?? surface;
let shapeId = shapeIdFromEvent(event, sourceSurface);

while (!shapeId && sourceSurface !== surface) {
  sourceSurface = findTargetSurfaceContext(sourceSurface.parentElement) ?? surface;
  shapeId = shapeIdFromEvent(event, sourceSurface);
}
```

If clicking on a shape inside a nested map, it finds that shape on the map surface. If clicking on the map's empty background, it walks up and finds the map itself as a shape on the parent surface.

## Moving Shapes Between Surfaces

When a shape is dragged from one surface to another, the selection tool:

1. Converts the shape's position from the source surface's page coordinates to screen coordinates, then to the target surface's page coordinates.
2. Adjusts the shape's `data.scale` to preserve its apparent size: `shape.data.scale *= sourceSurface.getScale() / targetSurface.getScale()`.
3. Creates the shape in the target surface's store and deletes it from the source.

For surfaces that clip their content (like paper's `overflow: hidden`), the dragged shape is lifted into a fixed-position overlay using `Element.moveBefore()` so it remains visible outside the source surface bounds. For surfaces where this lift isn't possible (like maps, which use geographic projection), the shape is immediately moved to the target surface as soon as the cursor crosses the boundary.
