---
name: selection
description: Highlights which canvas shapes are selected—frame-level map from shape id to a truthy flag.
---

# Selection

This package drives **selection state** on the paper frame: which shape ids are considered selected for highlighting and tool behavior. It does not define a drawable shape payload; it reads pointer hits and updates shared frame fields.

## Types

Selection state lives on the **canvas / frame** ref, not on a per-shape record:

```ts
type SelectedShapes = Record<string, boolean>;
```

`selectedTool` is a separate string on the same ref (convention: tool name `selection` when this mode is active). Parsing for `selectedShapes` accepts any object and normalizes to `{}` when invalid (`button.js`).

## Programmatic usage

Highlight one shape by id (pattern used by the built-in tool):

```js
const shapeId = 'line_123';
canvas.ref.at('selectedShapes').change(() => ({ [shapeId]: true }));
```

Clear:

```js
canvas.ref.at('selectedShapes').change(() => ({}));
```

## Model of the code

- **`button.js`** — Resolves shape id from pointer targets under the canvas, toggles `selectedTool`, and reads/writes `selectedShapes`.

## Examples

- **Multi-select:** Extend parsing and pointer logic together, and update any UI (e.g. paper chrome) that interprets `selectedShapes` keys.

## Guidelines

- Keep the active tool string aligned with other packages that compare `selectedTool`.
- Only treat child `ref-view` elements under the canvas as selectable targets; do not use toolbar `ref-view` nodes as shape hits.
