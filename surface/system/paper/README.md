---
name: paper
description: Interactive surface—toolbar shape layout, active tool id, and which shapes are highlighted.
---

# Paper

`paper.js` is a **surface module** you can mount on any `ref-view` whose ref should carry a `shapes` map plus `selectedTool` and `selectedShapes`. It lays out each `shapes` entry and reflects selection highlights; draw tools on the same ref read and write those paths.

## Types

Toolbar entries and user shapes share one map; each value must include position and `toolUrl`. Built-in toolbar defaults may add fields such as `isLocked`.

```ts
type PaperShapeEntry = {
  x: number;
  y: number;
  toolUrl: string;
} & Record<string, unknown>;

type PaperShapesMap = Record<string, PaperShapeEntry>;

type SelectedShapes = Record<string, boolean>;
```

`selectedTool` is a string (`''` when none). Runtime parsing: `shapes` values go through Zod in `paper.js` (`ShapeSchema.passthrough()` per entry, wrapped in `z.record`); `selectedTool` and `selectedShapes` use small inline `{ init, parse }` schemas in the same file.

## Programmatic usage

Read and write `shapes`, `selectedTool`, and `selectedShapes` on the **same ref** the `ref-view` uses (same pattern other system tools use).

Add a toolbar control (paths relative to `paper/paper.js`):

```js
ref.at('shapes', 'myButton').change(() => ({
  x: 210,
  y: 10,
  isLocked: true,
  toolUrl: getToolUrl('../mytool/button.js', import.meta.url),
}));
```

For extra fields on that ref, define `{ init, parse }` and use `ref.at('myKey').as(mySchema)` from the code that owns those reads and writes.

## Model of the code

- **`paper.js`** — Renders each `shapes` entry as a positioned `ref-view`; applies selection styling from `selectedShapes`.

## Examples

- **New toolbar tool:** Register a stable `shapes` key with `toolUrl` pointing at that tool’s `button.js` (see default keys in `shapesSchema.init()` for path style).

## Guidelines

- Keep `selectedTool` string values aligned with `TOOL_NAME` constants in sibling `*/button.js` files.
- After changing `shapes` parsing, ensure older documents still parse or widen `parse` tolerantly.
- `selectedShapes[id]` drives highlight; changing its meaning requires updating the selection tool and this renderer together.
