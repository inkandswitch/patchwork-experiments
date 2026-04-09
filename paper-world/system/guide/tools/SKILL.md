---
name: tools
description: Create, edit, and manage tools in the system tree.
---

# Tools

A **tool** is a folder in the system tree that defines how a piece of state is rendered and edited. Tools are composable modules -- they can run standalone, be embedded inside other tools, or placed on a canvas.

## Tool folder structure

Each tool folder contains:

| File           | Purpose                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| `tool.json`    | View descriptor -- JSON metadata; includes `toolUrl` (path to the implementation module)       |
| `tool.js`      | Renderer -- default export is `mount(element)`, re-exports `schema`                           |
| `schema.js`    | Data shape -- exports `schema` with `init()`, `parse(value)`, and optionally `toJSONSchema()` |
| `package.json` | Package manifest with `exports` mapping subpaths to files                                     |

## Reading tool source

```js
const source = await filesystem.readFile("rectangle/tool.js");
console.log(source);
```

List all tool folders:

```js
const entries = await filesystem.listEntries("");
const folders = entries.filter((e) => e.type === "folder").map((e) => e.name);
console.log(folders);
```

## Creating a new tool

First create the folder, then write the required files:

```js
await filesystem.createFolder("my-tool");
```

### 1. schema.js

```js
await filesystem.writeFile(
  "my-tool/schema.js",
  `
import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const MyToolSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
  // add your fields here
});

export default {
  init() {
    return { x: 0, y: 0, viewUrl: getViewUrl('./tool.json', import.meta.url) };
  },
  parse(value) {
    return MyToolSchema.parse(value);
  },
};
`,
);
```

### 2. tool.js

```js
await filesystem.writeFile(
  "my-tool/tool.js",
  `
import { from, render, html } from '../solid.js';
import myToolSchema from './schema.js';

export default function mount(element) {
  const ref = element.getOrCreate(myToolSchema);
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
`,
);
```

### 3. package.json

```js
await filesystem.writeFile(
  "my-tool/package.json",
  JSON.stringify(
    {
      name: "my-tool",
      private: true,
      type: "module",
      description: "Description of what it does",
      exports: {
        "./tool": "./tool.js",
        "./tool.json": "./tool.json",
        "./schema.json": "./schema.json",
      },
    },
    null,
    2,
  ),
);
```

### 4. tool.json

The view descriptor uses `toolUrl` to point at the implementation module (this key name is fixed):

```js
await filesystem.writeFile(
  "my-tool/tool.json",
  JSON.stringify(
    {
      type: "tool",
      name: "My Tool",
      description: "Description of what it does",
      toolUrl: "./tool.js",
      schemaUrl: "./schema.js",
    },
    null,
    2,
  ),
);
```

## Editing existing tools

Read, modify, and write back:

```js
const source = await filesystem.readFile("rectangle/tool.js");
const modified = source.replace("'#3b82f6'", "'#ef4444'");
await filesystem.writeFile("rectangle/tool.js", modified);
```

## Adding a tool to the canvas

After creating a tool, add it as a shape on the canvas. Shapes reference a **view descriptor** path (for example `my-tool/tool.json`):

```js
element.ref.at("shapes", `my_tool_${Date.now()}`).change(() => ({
  x: 100,
  y: 100,
  viewUrl: "my-tool/tool.json",
  width: 200,
  height: 100,
}));
```

Or embed it inside an embed shape with its own document:

```js
const { schema } = await filesystem.import("my-tool/schema.js");
const doc = repo.create(schema.init());

element.ref.at("shapes", `embed_${Date.now()}`).change(() => ({
  x: 50,
  y: 50,
  viewUrl: "embed/tool.json",
  embedViewUrl: "my-tool/tool.json",
  embedDocUrl: doc.url,
  width: 300,
  height: 200,
}));
```

## Filesystem API

| Method                                | Purpose                                   |
| ------------------------------------- | ----------------------------------------- |
| `filesystem.readFile(path)`           | Read a file as text                       |
| `filesystem.writeFile(path, content)` | Write (or overwrite) a text file          |
| `filesystem.createFolder(path)`       | Create a folder (and any missing parents) |
| `filesystem.listEntries(path)`        | List files and subfolders in a directory  |
| `filesystem.getUrlOfFile(path)`       | Get the service-worker URL for a file     |
| `filesystem.import(path)`             | Import a JS module by filesystem path     |

## Conventions

- Import shared Solid helpers from `'../solid.js'` (provides `from`, `render`, `html`, `For`, `createSignal`)
- Import `getViewUrl` from `'../url.js'` for resolving view-descriptor paths in schemas
- Use Zod from `'https://esm.sh/zod@4.3'` for schema validation
- `tool.js` must export `schema` and a default `mount(element)` function
- `mount` receives a ref-view element; use `element.ref.getOrCreate(schema)` to get a typed ref, `from(ref)` for reactive data
- The `mount` function should return a cleanup function (typically from `render()`)
