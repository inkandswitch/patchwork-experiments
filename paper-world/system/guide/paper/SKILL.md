---
name: paper
description: Create and manipulate shapes on the surface—rectangles, lines, text, and embeds.
---

# Paper shapes

Every visible object on the surface is an entry in the `shapes` map on the frame ref. Each shape is `{ viewUrl, data: { ... } }`. The `viewUrl` tells the host which view descriptor renders the shape, and `data` holds all positioning and tool-specific properties.

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
const textKeys = Object.keys(shapes).filter(id => shapes[id].data?.text !== undefined);
console.log(textKeys);
```

## View URLs

Shapes use paths to view descriptors under the system tree, for example `rectangle/tool.json`, `line/tool.json`, `text/tool.json`. The `viewUrl` is stored at the top level of each shape entry, separate from the tool-specific data in `data`.

## Rectangle

```ts
type RectangleShape = {
  viewUrl: string;
  data: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
```

Create:

```js
element.ref.at('shapes', 'rect_1').change(() => ({
  viewUrl: 'rectangle/tool.json',
  data: { x: 50, y: 50, width: 200, height: 120 },
}));
```

Resize or move:

```js
element.ref.at('shapes', 'rect_1').change((shape) => {
  shape.data.width = 180;
  shape.data.x += 10;
});
```

## Line (freehand stroke)

Points are `[offsetX, offsetY, pressure]` tuples relative to `(data.x, data.y)`.

```ts
type LinePoint = [offsetX: number, offsetY: number, pressure: number];

type LineShape = {
  viewUrl: string;
  data: {
    x: number;
    y: number;
    points: LinePoint[];
  };
};
```

Create:

```js
const strokeId = `line_${Date.now()}`;
element.ref.at('shapes', strokeId).change(() => ({
  viewUrl: 'line/tool.json',
  data: {
    x: 100,
    y: 80,
    points: [
      [0, 0, 0.5],
      [12, 4, 0.55],
      [30, -6, 0.6],
    ],
  },
}));
```

Extend a stroke:

```js
const strokeId = 'line_1';
const relX = 42, relY = 10, pressure = 0.6;
element.ref.at('shapes', strokeId).change((shape) => {
  shape.data.points.push([relX, relY, pressure]);
});
```

## Text

```ts
type TextShape = {
  viewUrl: string;
  data: {
    x: number;
    y: number;
    text: string;
  };
};
```

Create:

```js
element.ref.at('shapes', 'note_1').change(() => ({
  viewUrl: 'text/tool.json',
  data: { x: 120, y: 40, text: 'Hello' },
}));
```

Update:

```js
element.ref.at('shapes', 'note_1').change((shape) => {
  shape.data.text = 'Updated';
});
```

## Embed (sub-surface)

Embeds host another tool inside a bounded area. `embedToolUrl` is the inner view; `embedDocUrl` is the document it binds to. Both live in `data`.

```ts
type EmbedShape = {
  viewUrl: string;
  data: {
    x: number;
    y: number;
    width: number;
    height: number;
    embedDocUrl: string;
    embedToolUrl: string;
  };
};
```

Create (with an LLM panel inside):

```js
const embedDoc = repo.create({
  config: { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-4.6' },
  runs: [],
});

element.ref.at('shapes', 'embed_1').change(() => ({
  viewUrl: 'embed/tool.json',
  data: {
    x: 20,
    y: 80,
    width: 320,
    height: 400,
    embedDocUrl: embedDoc.url,
    embedToolUrl: 'llm/tool.json',
  },
}));
```

Resize or retarget:

```js
const newDocUrl = 'automerge:abc123';
element.ref.at('shapes', 'embed_1').change((shape) => {
  shape.data.width = 400;
  shape.data.embedDocUrl = newDocUrl;
});
```

## Removing shapes

```js
element.ref.at('shapes').change((shapes) => {
  delete shapes['rect_1'];
});
```
