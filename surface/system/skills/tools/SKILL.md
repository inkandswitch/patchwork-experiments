---
name: tools
description: Create, edit, and manage tools in the system tree.
---

# Tools

Every capability on the canvas is a **tool** -- a folder under the system tree. The available tools are: `rectangle`, `line`, `text`, `embed`, `llm`, `json`, `selection`, and `paper`.

## Tool folder structure

Each tool folder contains:

| File | Purpose |
|------|---------|
| `shape.js` | Renderer -- default export is `mount(element)`, re-exports `schema` |
| `schema.js` | Data shape -- exports `schema` with `init()`, `parse(value)`, and optionally `toJSONSchema()` |
| `plugins.json` | Registers the tool and its schema with the plugin system |
| `button.js` | (optional) Toolbar button for canvas tools |

## Reading tool source

Use the filesystem to read any tool's source:

```js
const source = await element.filesystem.readFile('rectangle/shape.js');
console.log(source);
```

List all tool folders:

```js
const entries = await element.filesystem.listEntries('');
const folders = entries.filter(e => e.type === 'folder').map(e => e.name);
console.log(folders);
```

## Creating a new tool

First create the folder, then write the required files:

```js
await element.filesystem.createFolder('my-tool');
```

### 1. schema.js

```js
await element.filesystem.writeFile('my-tool/schema.js', `
import { z } from 'https://esm.sh/zod@4.3';
import { getToolUrl } from '../url.js';

const MyToolSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  // add your fields here
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: getToolUrl('./shape.js', import.meta.url) };
  },
  parse(value) {
    return MyToolSchema.parse(value);
  },
};
`);
```

### 2. shape.js

```js
await element.filesystem.writeFile('my-tool/shape.js', `
import { from, render, html } from '../solid.js';
import { schema } from './schema.js';

export { schema };

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  return render(
    () => html\\\`<div style=\\\${() => ({
      width: '200px',
      height: '100px',
      background: '#e0e7ff',
      'border-radius': '6px',
      padding: '8px',
      font: '13px system-ui',
    })}>\\\${() => JSON.stringify(data())}</div>\\\`,
    element,
  );
}
`);
```

### 3. plugins.json

```js
await element.filesystem.writeFile('my-tool/plugins.json', JSON.stringify({
  plugins: [
    {
      type: 'tool',
      name: 'My Tool',
      description: 'Description of what it does',
      toolUrl: './shape.js',
      schemaUrl: './schema.js',
    },
    {
      type: 'schema',
      name: 'My Tool Schema',
      description: 'Data schema for my tool',
      source: './schema.js',
    },
  ],
}, null, 2));
```

## Editing existing tools

Read, modify, and write back:

```js
const source = await element.filesystem.readFile('rectangle/shape.js');
const modified = source.replace("'#3b82f6'", "'#ef4444'");
await element.filesystem.writeFile('rectangle/shape.js', modified);
```

## Adding a tool to the canvas

After creating a tool, add it as a shape on the canvas. Build the tool URL from the filesystem:

```js
const systemBase = element.filesystem.getUrlOfFile('');

function toolUrl(relativePath) {
  return new URL(relativePath, systemBase).href;
}
```

Then create a shape directly:

```js
element.ref.at('shapes', `my_tool_${Date.now()}`).change(() => ({
  x: 100,
  y: 100,
  toolUrl: toolUrl('my-tool/shape.js'),
  width: 200,
  height: 100,
}));
```

Or embed it inside an embed shape with its own document:

```js
const doc = repo.create({ /* initial data matching your schema */ });

element.ref.at('shapes', `embed_${Date.now()}`).change(() => ({
  x: 50,
  y: 50,
  toolUrl: toolUrl('embed/shape.js'),
  embedToolUrl: toolUrl('my-tool/shape.js'),
  embedDocUrl: doc.url,
  width: 300,
  height: 200,
}));
```

## Filesystem API

| Method | Purpose |
|--------|---------|
| `element.filesystem.readFile(path)` | Read a file as text |
| `element.filesystem.writeFile(path, content)` | Write (or overwrite) a text file |
| `element.filesystem.createFolder(path)` | Create a folder (and any missing parents) |
| `element.filesystem.listEntries(path)` | List files and subfolders in a directory |
| `element.filesystem.getUrlOfFile(path)` | Get the service-worker URL for a file |

## Conventions

- Import shared Solid helpers from `'../solid.js'` (provides `from`, `render`, `html`, `For`, `createSignal`)
- Import `getToolUrl` from `'../url.js'` for resolving tool paths in schemas
- Use Zod from `'https://esm.sh/zod@4.3'` for schema validation
- `shape.js` must export `schema` and a default `mount(element)` function
- `mount` receives a ref-view element; use `element.ref.as(schema)` to get a typed ref, `from(ref)` for reactive data
- The `mount` function should return a cleanup function (typically from `render()`)
