---
name: paper
description: Place and manage shapes on a Paper document (PaperDoc) by Automerge URL. Use when adding embeds, text, or rectangles to a paper canvas — especially when you need to place multiple items without overlapping existing content. Handles smart space-finding automatically.
---

# Paper Skill

Place and manage shapes on a Paper document using `repo`.

## Import

```javascript
const { getPaper, findFreePosition } = await importSkillApi('paper');
```

## API

### `getPaper(repo, url)` (async) — work with a paper doc

Returns a read/write interface for the PaperDoc at `url`. Must be awaited.

| Method | Description |
|--------|-------------|
| `getShapes()` | Async. Returns all shapes as an array. |
| `placeEmbed(docUrl, docType, opts?)` | Async. Place a linked document embed; finds empty space automatically. Returns shape ID. |
| `placeEmbeds(items, opts?)` | Async. Place multiple embeds in one call, packed into rows. Returns shape ID array. |
| `placeText(text, opts?)` | Async. Place a text label; finds empty space automatically. Returns shape ID. |
| `placeRectangle(w, h, opts?)` | Async. Place a rectangle; finds empty space automatically. Returns shape ID. |
| `removeShape(shapeId)` | Async. Remove a shape by ID. |
| `moveShape(shapeId, x, y)` | Async. Move a shape to an absolute position. |
| `updateShape(shapeId, fields)` | Async. Merge arbitrary fields into an existing shape (e.g. change color, text, size). |

### `findFreePosition(shapes, width, height, opts?)` — standalone placement helper

Finds the first unoccupied position for a rectangle of the given size without touching any existing shape (+ padding gap). Useful when you want to compute a position before writing to the doc.

**opts:** `startX`, `startY`, `padding` (default 24), `rowWidth` (default 3000).

Returns `{ x, y }`.

## Shape types

| type | Key fields |
|------|-----------|
| `embed` | `docUrl`, `docType`, `toolId?`, `toolUrl?`, `width`, `height` |
| `text` | `text`, `color?`, `fontSize?` |
| `rectangle` | `w`, `h`, `fill`, `stroke`, `strokeWidth` |

All shapes share `id`, `x`, `y`, `zIndex`.

> **Important:** rectangles use `w`/`h` (not `width`/`height`). Embeds use `width`/`height`.

## Smart placement

`placeEmbed`, `placeEmbeds`, `placeText`, and `placeRectangle` all call `findFreePosition` internally unless you pass explicit `x`/`y` coordinates. The algorithm scans left-to-right, top-to-bottom:

1. Start at `(startX, startY)` (default `(0, 0)`).
2. If the candidate position overlaps an existing shape (+ padding), jump the x cursor past that shape's right edge.
3. If x would exceed `startX + rowWidth`, wrap to a new row below the tallest shape seen so far.
4. Repeat until an empty slot is found.

## Examples

### Place a single embed

```javascript
const { getPaper } = await importSkillApi('paper');
const paper = await getPaper(repo, 'automerge:paper123');

// Place a markdown document on the canvas; auto-finds empty space
const shapeId = await paper.placeEmbed('automerge:doc456', 'markdown');
console.log('Placed at shape:', shapeId);

// Place with custom size
await paper.placeEmbed('automerge:doc789', 'datalog', { width: 700, height: 500 });
```

### Place multiple embeds in a batch

```javascript
const { getPaper } = await importSkillApi('paper');
const paper = await getPaper(repo, 'automerge:paper123');

const ids = await paper.placeEmbeds([
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
await paper.placeEmbeds(items, { startX: 1000, startY: 500, padding: 32, rowWidth: 2000 });
```

### Place a rectangle

```javascript
// Default styling
const rectId = await paper.placeRectangle(200, 100);

// Custom colors
await paper.placeRectangle(300, 200, {
  fill: '#dbeafe',
  stroke: '#2563eb',
  strokeWidth: 2,
});
```

### Place a text label then an embed below it

```javascript
const paper = await getPaper(repo, 'automerge:paper123');
const labelId = await paper.placeText('Results', { startX: 0, startY: 0 });
const embedId = await paper.placeEmbed('automerge:results', 'markdown', { startX: 0, startY: 40 });
```

### Inspect existing shapes

```javascript
const shapes = await paper.getShapes();
const embeds = shapes.filter(s => s.type === 'embed');
console.log(embeds.map(e => ({ id: e.id, x: e.x, y: e.y, docUrl: e.docUrl })));

const rects = shapes.filter(s => s.type === 'rectangle');
console.log(rects.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })));
```

### Update an existing shape

```javascript
// Change the fill color of a rectangle
await paper.updateShape(rectId, { fill: '#fef9c3', stroke: '#ca8a04' });

// Update text content
await paper.updateShape(textId, { text: 'Updated label', fontSize: 24 });
```

### Remove and reposition

```javascript
await paper.removeShape(shapeId);
await paper.moveShape(otherId, 200, 400);
```

## Common docType values

- `markdown` — markdown text document
- `datalog` — Datalog database
- `llm` — LLM process result
- `llm-chat` — LLM chat session
- `file` — generic file viewer

## Notes

- Paper coordinates are in abstract canvas space (not screen pixels). Items are typically sized in the range of 300–800 units wide.
- Default embed size is 480 × 320 if not specified.
- `placeEmbeds` commits all shapes in a single Automerge change for efficiency.
- To place items relative to where existing content ends, call `getShapes()` first, then use `startY` to aim below existing content.
- Embeds support `toolUrl` (a URL pointing to a custom tool bundle) in addition to the standard `toolId`.
