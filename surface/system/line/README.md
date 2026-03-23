---
name: line
description: Freehand pen strokes—organic lines from drag gestures, with optional pressure along the path.
---

# Line

The line shape is for **freehand drawing**: you record a sequence of samples with optional pen pressure, and the renderer turns that into a smooth, variable-width stroke. Use it when you want hand-drawn lines rather than straight segments between two clicks.

## Types

Stroke payload (each line entry under the canvas `shapes` map). `points` are offsets relative to `(x, y)`; pressure is often `0..1` (call sites may default). First sample is usually `[0, 0, pressure]` at pointer-down; moves append `[relX, relY, pressure]`.

```ts
type LinePoint = [offsetX: number, offsetY: number, pressure: number];

type LineShape = {
  x: number;
  y: number;
  toolUrl: string;
  points: LinePoint[];
};
```

Runtime parsing lives in Zod in `shape.js`; keep types and `LineSchema` in sync when fields change.

## Programmatic usage

Write a new entry under the canvas `shapes` map with a unique id. Match `toolUrl` to this package’s `shape.js` and keep `points` in shape-local coordinates:

```js
const lineShapeUrl = new URL('./shape.js', import.meta.url).href;

const strokeId = `line_${Date.now()}`;
canvas.ref.at('shapes', strokeId).change(() => ({
  x: 100,
  y: 80,
  toolUrl: lineShapeUrl,
  points: [
    [0, 0, 0.5],
    [12, 4, 0.55],
    [30, -6, 0.6],
    [48, 2, 0.5],
  ],
}));
```

To extend a stroke as the pointer moves, append tuples on the same ref:

```js
canvas.ref.at('shapes', strokeId).change((shape) => {
  shape.points.push([relX, relY, pressure]);
});
```

`schema.init()` from `shape.js` is the empty template:

```js
// Equivalent to init() for a new line
const emptyLine = {
  x: 0,
  y: 0,
  toolUrl: new URL('./shape.js', import.meta.url).href,
  points: [],
};
```

## Model of the code

- **`shape.js`** — Turns `points` into the drawn stroke; layout keeps the stroke visible around its anchor.

## Examples

- **Adjust stroke feel:** Tweak width and smoothing parameters in `shape.js`; keep each point a three-number tuple unless you change parsing and all writers of `points` together.

## Guidelines

- Keep the line shape’s fields aligned across `init()`, `parse()`, and the renderer when you extend the model.
- Avoid letting the stroke layer capture hits that should reach the canvas for other tools.
