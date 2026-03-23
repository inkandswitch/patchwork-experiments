---
name: line
description: Freehand line strokes—`selectedTool` `line`, pointer drag records `[x, y, pressure]` points; SVG path from perfect-freehand `getStroke`. Schema and how to create strokes.
---

# Line

The line shape is for **freehand drawing**: users (or code) record a polyline of samples with optional pen pressure, and the renderer turns that into a smooth, variable-width stroke using [perfect-freehand](https://github.com/steveruizok/perfect-freehand). It is the right tool when you want organic, hand-drawn lines rather than straight segments between two clicks.

## Schema (`LineSchema`)

Each line is a ref-backed object validated by Zod in `shape.js`:

| Field     | Type | Meaning |
|-----------|------|---------|
| `x`       | `number` | Canvas X of the stroke **origin** (top-left anchor of the shape). |
| `y`       | `number` | Canvas Y of the same origin. |
| `toolUrl` | `string` | Absolute URL of `shape.js` for this package (used to load the renderer). |
| `points`  | `Array<[number, number, number]>` | Samples **relative to** `(x, y)`. Each tuple is `[offsetX, offsetY, pressure]`. Pressure is typically `0..1`; missing pressure can be defaulted (e.g. `0.5`). |

The first sample is usually `[0, 0, pressure]` at the pointer-down position; move events append `[relX, relY, pressure]` where `relX` / `relY` are cursor position minus the shape’s `x` / `y`.

Minimum useful length: the UI discards strokes with fewer than **3** points (see `button.js`).

## Creating a line

### In the UI

1. Set the canvas `selectedTool` ref to `'line'` (the line toolbar button does this).
2. Pointer **down** on the canvas `ref-view` (not on chrome) starts a shape; **move** appends to `points`; **up** finalizes. Strokes with fewer than three points are removed.

### Programmatically

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

To mirror the interactive tool, extend the same ref on move (append tuples):

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

- `button.js`: When `selectedTool` is `line`, pointer down on the canvas starts a new shape; move/up append/update `points` on that shape’s ref.
- `shape.js`: Maps `points` through `getStroke` and fills an SVG `path`. Layout uses a minimal absolute SVG box with `overflow: visible`.

## Examples

- **Adjust stroke feel:** Change `getStroke` options (`size`, `thinning`, `smoothing`, `streamline`) or `path` `fill` in `shape.js`; do not change tuple arity without updating `LineSchema` and any migration.
- **Fix accidental strokes from toolbar:** Ensure pointer handlers return early unless the hit target is the canvas `ref-view`, matching sibling tools.

## Guidelines

- Preserve `LineSchema` shape when editing; if you add fields, update `init()`, `parse()`, button creation, and renderer together.
- Keep `TOOL_NAME` as `line` and consistent with `paper/paper.js` registration semantics for `selectedTool`.
- Avoid enabling pointer events on the SVG if hits should pass through to the canvas for other tools.
