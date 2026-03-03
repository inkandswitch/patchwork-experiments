---
name: create-patchwork-tool
description: Create a custom Patchwork tool — an interactive mini-app that lives inside the Patchwork environment. Use this skill whenever you need to build a new tool type (game, editor, tracker, etc.) with its own document schema and UI.
---

# Create Patchwork Tool Skill

A Patchwork tool is a self-contained interactive application that runs inside the Patchwork collaborative environment. Each tool consists of:

1. **A document (data)** — an Automerge CRDT document with a specific schema and a `@patchwork` metadata block.
2. **A module (code)** — a folder containing an entry file that defines plugins (plugin declarations with `importPath` references) and separate files for each datatype and tool implementation.
   - A plugin can be a tool or a datatype.
   - You may define only a datatype, or only a tool for an existing datatype.
   - A single module can contain multiple tools and datatypes.

## Architecture Overview

```
┌─────────────────────────────┐
│  Document (Automerge CRDT)  │  ← The data: JSON-like structure, collaboratively editable
│  {                          │
│    title: "My Game",        │
│    ...app state...,         │
│    "@patchwork": {          │
│      type: "my-tool",       │  ← Links document to its tool type
│      suggestedImportUrl:    │  ← Points to the module
│        "automerge:..."      │
│    }                        │
│  }                          │
└─────────────┬───────────────┘
              │ opened by
┌─────────────▼───────────────┐
│  Module (folder)            │
│  ├── running-tracker.js     │  ← Entry file: plugins[] with importPath refs
│  ├── tracker-datatype.js    │  ← Datatype: default export (init, getTitle, …)
│  ├── tracker-tool.js        │  ← Tool: default export (handle, element) → cleanup
│  └── package.json           │  ← main points to entry file
└─────────────────────────────┘
```

## Step-by-Step Guide

### Step 1: Design Your Document Schema

Decide what state your tool needs. This is a plain JSON-like object that will be stored in an Automerge CRDT document. Keep it simple and flat where possible.

**Example** (tic-tac-toe):

```json
{
  "title": "Tic Tac Toe",
  "board": [null, null, null, null, null, null, null, null, null],
  "currentPlayer": "X",
  "status": "playing",
  "winner": null
}
```

### Step 2: Write the Module Files

A module has three kinds of files. Pick a descriptive module name (e.g., `running-tracker`) and use it as the entry file name.

#### 2a. The Entry File (`running-tracker.js`)

The entry file exports a `plugins` array. Each plugin is a plain object with an `importPath` that points to the file containing the implementation. No `load()` functions, no SDK imports.

```javascript
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "running-tracker",
    name: "Running Tracker",
    icon: "Activity",
    importPath: "./tracker-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "running-tracker",
    name: "Running Tracker",
    icon: "Activity",
    supportedDatatypes: ["running-tracker"],
    importPath: "./tracker-tool.js",
  },
];
```

A single module can define multiple datatypes and tools — just add more entries to the `plugins` array.

#### 2b. The Datatype File (`tracker-datatype.js`)

The datatype file has a **default export** that manages the document lifecycle. It **must** have these methods:

```javascript
export default {
  init(doc) {
    doc.title = "My Runs";
    doc.runs = [];
  },

  getTitle(doc) {
    return doc.title || "Running Tracker";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + (doc.title || "Running Tracker");
  },
};
```

#### 2c. The Tool File (`tracker-tool.js`)

The tool file has a **default export** — a function that renders the UI into a DOM element and reacts to document changes. It receives:

- `handle` — an Automerge DocHandle for reading/writing the document
- `element` — a DOM element to render into

Key handle methods:

- `handle.doc()` — get current document state (read-only snapshot)
- `handle.change(callback)` — mutate the document: `handle.change(d => { d.field = value })`
- `handle.on("change", fn)` — listen for document changes (including from other peers)
- `handle.off("change", fn)` — remove listener

The tool function must **return a cleanup function** that removes event listeners and DOM elements.

```javascript
export default function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = \`
    .tracker-container { /* ... */ }
  \`;
  element.appendChild(style);

  const container = document.createElement("div");
  container.className = "tracker-container";
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc) return;

    container.innerHTML = "";
    // ... build your UI using DOM APIs ...
    // ... attach event listeners that call handle.change() ...
  }

  render();
  handle.on("change", render);

  return () => {
    handle.off("change", render);
    container.remove();
    style.remove();
  };
}
```

### Step 3: Create the package.json

The `main` field must point to the entry file (the one that exports `plugins`):

```json
{
  "name": "@patchwork/running-tracker",
  "version": "0.0.1",
  "description": "Track your runs",
  "type": "module",
  "main": "running-tracker.js",
  "exports": {
    ".": "running-tracker.js"
  },
  "keywords": [],
  "author": ""
}
```

### Folder & File Conventions

Tools are stored as flat Automerge folder documents. A folder doc has a `docs[]` array of file links — no nested folders.

```
Folder doc: { docs: [{ name: "tool.js", type: "file", url: "automerge:..." }, ...] }
File doc:   { content: "..." }
```

**Heads-in-URL convention:** URLs stored in `docs[]` entries include Automerge heads (e.g., `automerge:docId#heads=hash1,hash2`). When you need to **read or write** a file, strip the heads from its URL to get a bare URL, then use `repo.find(bareUrl)` to obtain a writable `DocHandle`.

### The `getEditableModule()` Helper

You MUST use `getEditableModule(repo, url)` when editing code modules.

Import it from `./getEditableModule.js` (located alongside this skill file):

```javascript
import { getEditableModule } from "./getEditableModule.js";

const tool = getEditableModule(repo, folderUrl);
```

The implementation is in [`getEditableModule.js`](./getEditableModule.js). Always import it — do not copy the implementation inline.

**Returned interface:**

| Method | Description |
|---|---|
| `folderUrl` | The bare (writable) folder URL |
| `folderHandle` | The writable `DocHandle` for the folder doc |
| `listFiles()` | List files: `[{name, type, url}]` |
| `readFile(name)` | Read a file's `content` as a string |
| `addFile(name, content)` | Create a new file doc and add it to the folder |
| `updateFile(name, content)` | Update an existing file's content |
| `getDocHandle(name)` | Get a writable `DocHandle` for direct manipulation |

### Step 4: Create a Document Instance

Tool documents have custom schemas beyond a simple text `content` field. Use `getEditableModule()` to get the folder interface, add the file, then get its handle to set custom fields:

```javascript
import { getEditableModule } from "./getEditableModule.js";

const tool = getEditableModule(repo, folderUrl);

const fileHandle = await tool.addFile("instance", "");
fileHandle.change(d => {
  d.title = "My Tool Instance";
  // ... set your schema fields ...
  d["@patchwork"] = {
    type: "my-tool-type",
    suggestedImportUrl: tool.folderUrl,
  };
});
```

### Step 5: Generate an Example Document

After creating the module, generate an example document instance pre-populated with realistic sample data. This lets the user immediately see the tool in action without having to manually set up state.

- If there is an existing example doc keep it unless the schema has changed. In that case, edit the existing example document.
- Fill the document fields with plausible, non-trivial content (not just empty defaults).
- The example should demonstrate the tool's key features and give a sense of how it looks when actively in use.
- Include the `@patchwork` metadata block pointing to the module.

Use `addFile()` to create the file, then set custom fields via the returned handle:

**Example** (tic-tac-toe — a game mid-progress):

```javascript
import { getEditableModule } from "./getEditableModule.js";

const tool = getEditableModule(repo, folderUrl);

const handle = await tool.addFile("example", "");
handle.change(d => {
  d.title = "Tic Tac Toe — Example Game";
  d.board = ["X", "O", "X", null, "O", null, null, null, null];
  d.currentPlayer = "X";
  d.status = "playing";
  d.winner = null;
  d["@patchwork"] = {
    type: "tic-tac-toe",
    suggestedImportUrl: tool.folderUrl,
  };
});
```

## Complete Example: Tic Tac Toe

Here is a full working example for reference.

**Entry file** (`tic-tac-toe.js`):

```javascript
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tic-tac-toe",
    name: "Tic Tac Toe",
    icon: "Grid3x3",
    importPath: "./ttt-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "tic-tac-toe",
    name: "Tic Tac Toe",
    icon: "Grid3x3",
    supportedDatatypes: ["tic-tac-toe"],
    importPath: "./ttt-tool.js",
  },
];
```

**Datatype file** (`ttt-datatype.js`):

```javascript
export default {
  init(doc) {
    doc.title = "Tic Tac Toe";
    doc.board = [null, null, null, null, null, null, null, null, null];
    doc.currentPlayer = "X";
    doc.status = "playing";
    doc.winner = null;
  },
  getTitle(doc) { return doc.title || "Tic Tac Toe"; },
  setTitle(doc, title) { doc.title = title; },
  markCopy(doc) { doc.title = "Copy of " + (doc.title || "Tic Tac Toe"); },
};
```

**Tool file** (`ttt-tool.js`): see the reference implementation at `automerge:442qEMJubfbNtu8bEikzX2j3Yyps`.

**Creating an example document** (via build script):

```javascript
import { getEditableModule } from "./getEditableModule.js";

const pkg = getEditableModule(repo, folderUrl);

const handle = await pkg.addFile("example", "");
handle.change(d => {
  d.title = "Tic Tac Toe — Example Game";
  d.board = ["X", "O", "X", null, "O", null, null, null, null];
  d.currentPlayer = "X";
  d.status = "playing";
  d.winner = null;
  d["@patchwork"] = {
    type: "tic-tac-toe",
    suggestedImportUrl: pkg.folderUrl,
  };
});
```

## Key Patterns & Best Practices

### UI Rendering

- Use **vanilla DOM APIs** (createElement, innerHTML, etc.) — no React/Vue/framework dependencies.
- The Tool function renders into the provided `element`. Treat it as your root.
- Re-render the full UI on each `change` event for simplicity. For performance-critical tools, consider diffing.
- Scope all CSS classes with a prefix (e.g., `ttt-`, `my-tool-`) to avoid conflicts.

### State Management

- **All persistent state lives in the Automerge document.** Use `handle.change(d => { ... })` to mutate it.
- The document is a CRDT — multiple users can edit simultaneously without conflicts on different fields.
- Avoid storing transient UI state (hover, animation) in the document. Use local JS variables or DOM state for ephemeral UI state.
- Arrays in Automerge support index-based access: `d.board[i] = value`.

### Collaboration

- Documents are automatically synced across peers via Automerge.
- Listen to `handle.on("change", render)` to react to remote changes.
- Design your schema to minimize conflicts (e.g., separate fields rather than one big string).

### Cleanup

- Always return a cleanup function from `Tool()` that removes event listeners and DOM nodes.
- Use `handle.off("change", render)` in cleanup.

### Naming Conventions

- **Datatype id** and **Tool id**: use kebab-case (e.g., `tic-tac-toe`, `kanban-board`).
- **Module NPM package name**: use `@patchwork/your-tool-name`.
- **Entry file**: a descriptive name matching the module (e.g., `running-tracker.js`, `tic-tac-toe.js`).
- **Implementation files**: use a short prefix + `-datatype.js` / `-tool.js` (e.g., `tracker-datatype.js`, `ttt-tool.js`).

### Icons

Icons come from the [Lucide](https://lucide.dev/icons/) icon set. Use the PascalCase name of the icon (e.g., `"Grid3x3"`, `"CheckSquare"`, `"FileText"`).

## File Structure

A module folder contains an entry file, separate implementation files, and a package.json:

```
running-tracker/
├── package.json              # main points to the entry file
├── running-tracker.js        # Entry file: exports plugins[] with importPath refs
├── tracker-datatype.js       # Datatype: default export (init, getTitle, …)
└── tracker-tool.js           # Tool: default export (handle, element) → cleanup
```

For modules with multiple tools/datatypes, add more implementation files and reference them via `importPath` in the entry file's `plugins` array.

## Templates

Use these as a starting point. Replace all `{{PLACEHOLDERS}}`.

### Entry file (`{{PACKAGE_NAME}}.js`)

```javascript
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "{{TOOL_ID}}",
    name: "{{TOOL_NAME}}",
    icon: "{{ICON_NAME}}",
    importPath: "./{{TOOL_ID}}-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "{{TOOL_ID}}",
    name: "{{TOOL_NAME}}",
    icon: "{{ICON_NAME}}",
    supportedDatatypes: ["{{TOOL_ID}}"],
    importPath: "./{{TOOL_ID}}-tool.js",
  },
];
```

### Datatype file (`{{TOOL_ID}}-datatype.js`)

```javascript
export default {
  init(doc) {
    doc.title = "{{DEFAULT_TITLE}}";
    // ... initialize your fields
  },

  getTitle(doc) {
    return doc.title || "{{DEFAULT_TITLE}}";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + (doc.title || "{{DEFAULT_TITLE}}");
  },
};
```

### Tool file (`{{TOOL_ID}}-tool.js`)

```javascript
export default function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = \`
    .{{PREFIX}}-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      box-sizing: border-box;
    }
    /* ... your styles ... */
  \`;
  element.appendChild(style);

  const container = document.createElement("div");
  container.className = "{{PREFIX}}-container";
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc) return;

    container.innerHTML = "";
    // ... build your UI ...
    // Use handle.change(d => { ... }) for mutations
  }

  render();
  handle.on("change", render);

  return () => {
    handle.off("change", render);
    container.remove();
    style.remove();
  };
}
```

### Placeholders

- `{{PACKAGE_NAME}}` — Descriptive file name for the entry file (e.g., `running-tracker`)
- `{{TOOL_NAME}}` — Human-readable name (e.g., "Running Tracker")
- `{{TOOL_ID}}` — Kebab-case identifier (e.g., `running-tracker`)
- `{{DEFAULT_TITLE}}` — Default document title
- `{{PREFIX}}` — CSS class prefix (e.g., `tracker`)
- `{{ICON_NAME}}` — Lucide icon name (e.g., `"Activity"`)

