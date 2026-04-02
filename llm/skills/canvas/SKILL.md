---
name: canvas
description: Place and manage items on a spatial canvas document (CanvasDoc) by Automerge URL. Use when adding embeds, text, or other shapes to a canvas — especially when you need to place multiple items without overlapping existing content. Handles smart space-finding automatically.
---

# Canvas Skill

Place and manage items on a spatial canvas document using `repo`.

## Import

```javascript
const { getCanvas, findFreePosition } = await loadSkill('canvas');
```

## API

### `getCanvas(repo, url)` — work with a canvas doc

Returns a read/write interface for the CanvasDoc at `url`.

| Method | Description |
|--------|-------------|
| `getShapes()` | Async. Returns all shapes as an array. |
| `placeEmbed(docUrl, docType, opts?)` | Async. Place a linked document embed; finds empty space automatically. Returns shape ID. |
| `placeEmbeds(items, opts?)` | Async. Place multiple embeds in one call, packed into rows. Returns shape ID array. |
| `placeText(text, opts?)` | Async. Place a text label; finds empty space automatically. Returns shape ID. |
| `removeShape(shapeId)` | Async. Remove a shape by ID. |
| `moveShape(shapeId, x, y)` | Async. Move a shape to an absolute position. |

### `findFreePosition(shapes, width, height, opts?)` — standalone placement helper

Finds the first unoccupied position for a rectangle of the given size without touching any existing shape (+ padding gap). Useful when you want to compute a position before writing to the doc.

**opts:** `startX`, `startY`, `padding` (default 24), `rowWidth` (default 3000).

Returns `{ x, y }`.

## Smart placement

`placeEmbed`, `placeEmbeds`, and `placeText` all call `findFreePosition` internally unless you pass explicit `x`/`y` coordinates. The algorithm scans left-to-right, top-to-bottom:

1. Start at `(startX, startY)` (default `(0, 0)`).
2. If the candidate position overlaps an existing shape (+ padding), jump the x cursor past that shape's right edge.
3. If x would exceed `startX + rowWidth`, wrap to a new row below the tallest shape seen so far.
4. Repeat until an empty slot is found.

## Examples

### Place a single embed

```javascript
const { getCanvas } = await loadSkill('canvas');
const canvas = getCanvas(repo, 'automerge:canvas123');

// Place a markdown document on the canvas; auto-finds empty space
const shapeId = await canvas.placeEmbed('automerge:doc456', 'markdown');
console.log('Placed at shape:', shapeId);

// Place with custom size
await canvas.placeEmbed('automerge:doc789', 'p3net', { width: 700, height: 500 });
```

### Place multiple embeds in a batch

```javascript
const { getCanvas } = await loadSkill('canvas');
const canvas = getCanvas(repo, 'automerge:canvas123');

const ids = await canvas.placeEmbeds([
  { docUrl: 'automerge:doc1', docType: 'markdown', width: 400, height: 280 },
  { docUrl: 'automerge:doc2', docType: 'markdown', width: 400, height: 280 },
  { docUrl: 'automerge:doc3', docType: 'datalog',  width: 600, height: 400 },
]);
console.log('Placed shapes:', ids);
```

Items in a batch avoid each other as well as existing shapes — each successive item sees the previously placed ones.

### Place embeds in a specific area

```javascript
// Spread items starting at (1000, 500), wrapping after 2000px of width
await canvas.placeEmbeds(items, { startX: 1000, startY: 500, padding: 32, rowWidth: 2000 });
```

### Inspect existing shapes

```javascript
const shapes = await canvas.getShapes();
const embeds = shapes.filter(s => s.type === 'embed');
console.log(embeds.map(e => ({ id: e.id, x: e.x, y: e.y, docUrl: e.docUrl })));
```

### Add a label then an embed below it

```javascript
const canvas = getCanvas(repo, 'automerge:canvas123');
const labelId = await canvas.placeText('Results', { startX: 0, startY: 0 });
const embedId = await canvas.placeEmbed('automerge:results', 'markdown', { startX: 0, startY: 40 });
```

### Remove and reposition

```javascript
await canvas.removeShape(shapeId);
await canvas.moveShape(otherId, 200, 400);
```

## Shape types

| type | Key fields |
|------|-----------|
| `embed` | `docUrl`, `docType`, `toolId`, `width`, `height` |
| `text` | `text`, `color`, `fontSize` |
| `rectangle` | `width`, `height`, `color`, `fill` |
| `image` | `fileUrl`, `width`, `height` |

All shapes share `id`, `x`, `y`, `zIndex`.

## Common docType values

- `markdown` — markdown text document
- `p3net` — Petri net simulation
- `datalog` — Datalog database
- `file` — generic file viewer

## Notes

- Canvas coordinates are in abstract canvas space (not screen pixels). Items are typically sized in the range of 300–800 units wide.
- Default embed size is 480 × 320 if not specified.
- `placeEmbeds` commits all shapes in a single Automerge change for efficiency.
- To place items relative to where existing content ends, call `getShapes()` first to see current positions, then use `startY` to aim below existing content.
