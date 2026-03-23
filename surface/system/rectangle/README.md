---
name: rectangle
description: Filled axis-aligned rectangles—position and width/height in canvas pixels.
---

# Rectangle

Use this shape for **simple blocks**: a rectangle with top-left `(x, y)` and explicit `width` / `height`. Styling in the renderer is fixed today; geometry is what persists.

## Types

Each rectangle is an entry under the canvas `shapes` map.

```ts
type RectangleShape = {
  x: number;
  y: number;
  toolUrl: string;
  width: number;
  height: number;
};
```

Runtime parsing lives in Zod in `shape.js` (`RectangleSchema`); keep types and schema in sync when fields change.

## Programmatic usage

```js
const rectShapeUrl = new URL('./shape.js', import.meta.url).href;

canvas.ref.at('shapes', 'rect_1').change(() => ({
  x: 50,
  y: 50,
  toolUrl: rectShapeUrl,
  width: 200,
  height: 120,
}));
```

Resize or move:

```js
canvas.ref.at('shapes', 'rect_1').change((shape) => {
  shape.width = 180;
  shape.x += 10;
});
```

Empty template (`schema.init()` from `shape.js`):

```js
const empty = {
  x: 0,
  y: 0,
  toolUrl: new URL('./shape.js', import.meta.url).href,
  width: 100,
  height: 100,
};
```

## Model of the code

- **`shape.js`** — Renders a sized box from `width` / `height` and the shape’s position in the paper layout.

## Examples

- **Stroke, label, or extra props:** Add fields to `RectangleSchema`, defaults in `init()`, writers that create the shape, and the renderer together.

## Guidelines

- Keep geometry fields consistent everywhere the shape is constructed or parsed.
- Prefer letting pointer routing treat nested `ref-view` targets the same way as sibling draw tools unless you intentionally handle sub-target drags.
