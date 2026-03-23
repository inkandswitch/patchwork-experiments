---
name: text
description: Plain text on the canvas—anchored position and a single editable string synced with the document.
---

# Text

Use this shape when you need **labels or notes** as plain text: one string field, positioned on the frame. The editor keeps the document as source of truth while the user types.

## Types

Each text shape lives under the canvas `shapes` map.

```ts
type TextShape = {
  x: number;
  y: number;
  toolUrl: string;
  text: string;
};
```

Runtime parsing lives in Zod in `shape.js` (`TextSchema`); keep types and schema in sync when fields change.

## Programmatic usage

```js
const textShapeUrl = new URL('./shape.js', import.meta.url).href;

canvas.ref.at('shapes', 'note_1').change(() => ({
  x: 120,
  y: 40,
  toolUrl: textShapeUrl,
  text: 'Hello',
}));
```

Update copy:

```js
canvas.ref.at('shapes', 'note_1').change((shape) => {
  shape.text = 'Updated';
});
```

Empty template (`schema.init()` from `shape.js`):

```js
const empty = {
  x: 0,
  y: 0,
  toolUrl: new URL('./shape.js', import.meta.url).href,
  text: '',
};
```

## Model of the code

- **`shape.js`** — Binds the `text` ref to a textarea; applies remote updates without clobbering the field while it is focused; sizes the control when the host cannot rely on content-based field sizing.

## Examples

- **Rich text or markdown:** Extend `TextSchema`, migrations, and rendering together; the current contract is a single plain string.

## Guidelines

- Keep `init()`, `parse()`, and any code that creates shapes aligned on the same fields.
- When adding async work or subscriptions, tear them down on unmount the same way as existing Solid cleanup in `shape.js`.
