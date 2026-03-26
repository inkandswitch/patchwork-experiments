---
name: embed
description: Embedded sub-surfaces in the frame—boxed size, optional inner tool URL, and optional linked document URL.
---

# Embed

Use this shape when the canvas should host **another tool or document** inside a bounded area: width, height, and URLs that tell the host what to load. Extra persisted fields are allowed (`EmbedSchema` uses `passthrough`).

## Types

Each embed is an entry under the canvas `shapes` map.

```ts
type EmbedShape = {
  x: number;
  y: number;
  toolUrl: string;
  embedToolUrl: string;
  width: number;
  height: number;
  embedDocUrl: string;
} & Record<string, unknown>;
```

`embedDocUrl` defaults to `''` when missing in parse. Runtime parsing lives in Zod in `shape.js`; keep types and schema in sync when fields change.

## Programmatic usage

```js
const embedShapeUrl = getToolUrl('./shape.js', import.meta.url);
const innerToolUrl = getToolUrl('../llm/shape.js', import.meta.url);

canvas.ref.at('shapes', 'embed_1').change(() => ({
  x: 20,
  y: 80,
  toolUrl: embedShapeUrl,
  embedToolUrl: innerToolUrl,
  embedDocUrl: '', // set when you have a document URL from your repo or loader
  width: 320,
  height: 240,
}));
```

Adjust layout or targets:

```js
canvas.ref.at('shapes', 'embed_1').change((shape) => {
  shape.width = 400;
  shape.embedDocUrl = docUrl;
});
```

Empty template (`schema.init()` from `shape.js`):

```js
const empty = {
  x: 0,
  y: 0,
  toolUrl: getToolUrl('./shape.js', import.meta.url),
  embedToolUrl: '',
  width: 200,
  height: 150,
  embedDocUrl: '',
};
```

## Model of the code

- **`shape.js`** — Layout and chrome for the box; wires `embedToolUrl` / `embedDocUrl` into the nested host when set.

## Examples

- **Programmatic resize or retarget:** Mutate `width`, `height`, `embedDocUrl`, and `embedToolUrl` through the shape ref so stored documents stay valid under `parse`.

## Guidelines

- Any new persisted field must appear in `init()`, `parse()`, and every reader that depends on it.
- Code paths that create linked documents expect a repo (or equivalent) on the host; guard when that is absent instead of failing silently.
