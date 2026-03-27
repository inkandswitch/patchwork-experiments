---
name: paper
description: Create and manipulate shapes on the canvas—rectangles, lines, text, and embeds.
---

# Paper shapes

Every visible object on the canvas is an entry in the `shapes` map on the frame ref. To create one, write a shape record under a unique id with at least `x`, `y`, and `toolUrl`. The `toolUrl` tells the host which module renders that shape.

## Reading shapes

Get a snapshot of all shapes:

```js
const doc = element.ref.value();
const shapes = doc.shapes || {};
console.log(Object.keys(shapes));
```

Read a specific shape:

```js
const doc = element.ref.value();
const shape = doc.shapes?.['rect_1'];
console.log(shape);
```

Find all text shapes:

```js
const doc = element.ref.value();
const shapes = doc.shapes || {};
const textKeys = Object.keys(shapes).filter(id => shapes[id].text !== undefined);
console.log(textKeys);
```

## Resolving tool URLs

Tool modules live under the system tree. Build absolute URLs from the filesystem:

```js
const systemBase = filesystem.getUrlOfFile('');

function toolUrl(relativePath) {
  return new URL(relativePath, systemBase).href;
}
```

Then use `toolUrl('rectangle/tool.js')`, `toolUrl('line/tool.js')`, etc.

## Rectangle

```ts
type RectangleShape = {
  x: number;
  y: number;
  toolUrl: string;
  width: number;
  height: number;
};
```

Create:

```js
const systemBase = filesystem.getUrlOfFile('');
function toolUrl(relativePath) {
  return new URL(relativePath, systemBase).href;
}

element.ref.at('shapes', 'rect_1').change(() => ({
  x: 50,
  y: 50,
  toolUrl: toolUrl('rectangle/tool.js'),
  width: 200,
  height: 120,
}));
```

Resize or move:

```js
element.ref.at('shapes', 'rect_1').change((shape) => {
  shape.width = 180;
  shape.x += 10;
});
```

## Line (freehand stroke)

Points are `[offsetX, offsetY, pressure]` tuples relative to `(x, y)`.

```ts
type LinePoint = [offsetX: number, offsetY: number, pressure: number];

type LineShape = {
  x: number;
  y: number;
  toolUrl: string;
  points: LinePoint[];
};
```

Create:

```js
const systemBase = filesystem.getUrlOfFile('');
function toolUrl(relativePath) {
  return new URL(relativePath, systemBase).href;
}

const strokeId = `line_${Date.now()}`;
element.ref.at('shapes', strokeId).change(() => ({
  x: 100,
  y: 80,
  toolUrl: toolUrl('line/tool.js'),
  points: [
    [0, 0, 0.5],
    [12, 4, 0.55],
    [30, -6, 0.6],
  ],
}));
```

Extend a stroke:

```js
const strokeId = 'line_1';
const relX = 42, relY = 10, pressure = 0.6;
element.ref.at('shapes', strokeId).change((shape) => {
  shape.points.push([relX, relY, pressure]);
});
```

## Text

```ts
type TextShape = {
  x: number;
  y: number;
  toolUrl: string;
  text: string;
};
```

Create:

```js
const systemBase = filesystem.getUrlOfFile('');
function toolUrl(relativePath) {
  return new URL(relativePath, systemBase).href;
}

element.ref.at('shapes', 'note_1').change(() => ({
  x: 120,
  y: 40,
  toolUrl: toolUrl('text/tool.js'),
  text: 'Hello',
}));
```

Update:

```js
element.ref.at('shapes', 'note_1').change((shape) => {
  shape.text = 'Updated';
});
```

## Embed (sub-surface)

Embeds host another tool inside a bounded area. `embedToolUrl` is the inner tool; `embedDocUrl` is the document it binds to.

```ts
type EmbedShape = {
  x: number;
  y: number;
  toolUrl: string;
  embedToolUrl: string;
  width: number;
  height: number;
  embedDocUrl: string;
};
```

Create (with an LLM panel inside):

```js
const systemBase = filesystem.getUrlOfFile('');
function toolUrl(relativePath) {
  return new URL(relativePath, systemBase).href;
}

const embedDoc = repo.create({
  config: { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-4.6' },
  runs: [],
});

element.ref.at('shapes', 'embed_1').change(() => ({
  x: 20,
  y: 80,
  toolUrl: toolUrl('embed/tool.js'),
  embedToolUrl: toolUrl('llm/tool.js'),
  embedDocUrl: embedDoc.url,
  width: 320,
  height: 400,
}));
```

Resize or retarget:

```js
const newDocUrl = 'automerge:abc123';
element.ref.at('shapes', 'embed_1').change((shape) => {
  shape.width = 400;
  shape.embedDocUrl = newDocUrl;
});
```

## Removing shapes

```js
element.ref.at('shapes').change((shapes) => {
  delete shapes['rect_1'];
});
```
