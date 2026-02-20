---
name: create-patchwork-tool
description: Create a custom Patchwork tool — an interactive mini-app that lives inside the Patchwork environment. Use this skill whenever you need to build a new tool type (game, editor, tracker, etc.) with its own document schema and UI.
---

# Create Patchwork Tool Skill

A Patchwork tool is a self-contained interactive application that runs inside the Patchwork collaborative environment. Each tool consists of:

1. **A document (data)** — an Automerge CRDT document with a specific schema and a `@patchwork` metadata block.
2. **A tool package (code)** — a JavaScript module that defines a `Datatype` (schema lifecycle), a `Tool` (UI renderer), and a `plugins` array that registers them.

## Architecture Overview

```
┌─────────────────────────────┐
│  Document (Automerge CRDT)  │  ← The data: JSON-like structure, collaboratively editable
│  {                          │
│    title: "My Game",        │
│    ...app state...,         │
│    "@patchwork": {          │
│      type: "my-tool",       │  ← Links document to its tool type
│      suggestedImportUrl:    │  ← Points to the tool package
│        "automerge:..."      │
│    }                        │
│  }                          │
└─────────────┬───────────────┘
              │ opened by
┌─────────────▼───────────────┐
│  Tool Package (JS module)   │  ← The code: renders UI, handles interaction
│  - Datatype (init, title)   │
│  - Tool (render, events)    │
│  - plugins[] (registration) │
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

### Step 2: Write the Tool Module

Create a single JavaScript file (ES module) with three exports:

#### 2a. The Datatype Object

The Datatype manages the document lifecycle. It **must** have these methods:

```javascript
export const MyDatatype = {
  // Called when a new document of this type is created.
  // Initialize all fields with default values.
  init(doc) {
    doc.title = 'My Tool';
    doc.someField = 'default';
    // ... set all your schema fields
  },

  // Return the display title for this document.
  getTitle(doc) {
    return doc.title || 'My Tool';
  },

  // Set the title.
  setTitle(doc, title) {
    doc.title = title;
  },

  // Called when the document is duplicated.
  markCopy(doc) {
    doc.title = 'Copy of ' + this.getTitle(doc);
  },
};
```

#### 2b. The Tool Function

The Tool function renders the UI into a DOM element and reacts to document changes. It receives:

- `handle` — an Automerge DocHandle for reading/writing the document
- `element` — a DOM element to render into

Key handle methods:

- `handle.doc()` — get current document state (read-only snapshot)
- `handle.change(callback)` — mutate the document: `handle.change(d => { d.field = value })`
- `handle.on("change", fn)` — listen for document changes (including from other peers)
- `handle.off("change", fn)` — remove listener

The Tool function must **return a cleanup function** that removes event listeners and DOM elements.

```javascript
export function Tool(handle, element) {
  // 1. Add styles
  const style = document.createElement("style");
  style.textContent = \`
    .my-container { /* ... */ }
  \`;
  element.appendChild(style);

  // 2. Create root container
  const container = document.createElement("div");
  container.className = "my-container";
  element.appendChild(container);

  // 3. Define render function
  function render() {
    const doc = handle.doc();
    if (!doc) return;

    container.innerHTML = "";

    // ... build your UI using DOM APIs ...
    // ... attach event listeners that call handle.change() ...
  }

  // 4. Initial render + subscribe to changes
  render();
  handle.on("change", render);

  // 5. Return cleanup function
  return () => {
    handle.off("change", render);
    container.remove();
    style.remove();
  };
}
```

#### 2c. The Plugins Array

Register your datatype and tool with Patchwork via a `plugins` export:

```javascript
export const plugins = [
  {
    type: 'patchwork:datatype',
    id: 'my-tool-type', // Unique identifier, must match @patchwork.type in documents
    name: 'My Tool', // Human-readable name
    icon: 'SomeIconName', // Icon name (from Lucide icons)
    async load() {
      return MyDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'my-tool-type', // Same identifier
    name: 'My Tool',
    icon: 'SomeIconName',
    supportedDatatypes: ['my-tool-type'], // Which datatype(s) this tool can render
    async load() {
      return Tool;
    },
  },
];
```

### Step 3: Create the package.json

```json
{
  "name": "@patchwork/my-tool",
  "version": "0.0.1",
  "description": "Description of your tool",
  "type": "module",
  "main": "my-tool.js",
  "exports": {
    ".": "my-tool.js"
  },
  "keywords": [],
  "author": ""
}
```

### Step 4: Create a Document Instance

Tool documents have custom schemas beyond a simple text `content` field. Use `fs.writeFile()` to create a placeholder, then `fs.createOrGetDocHandle()` to get the Automerge handle and set the fields directly with `handle.change()`:

```javascript
// Get the original automerge URL of the tool folder
const toolUrl = await fs.getDocUrl("/my-tool");

await fs.writeFile("/my-tool/instance.json", "");
const handle = await fs.createOrGetDocHandle("/my-tool/instance.json");
handle.change(d => {
  d.title = "My Tool Instance";
  // ... set your schema fields ...
  d["@patchwork"] = {
    type: "my-tool-type",
    suggestedImportUrl: toolUrl,
  };
});
```

### Step 5: Generate an Example Document

After creating the tool package, generate an example document instance pre-populated with realistic sample data. This lets the user immediately see the tool in action without having to manually set up state.

- Fill the document fields with plausible, non-trivial content (not just empty defaults).
- The example should demonstrate the tool's key features and give a sense of how it looks when actively in use.
- Include the `@patchwork` metadata block pointing to the tool package.

To create the example document, first create a placeholder file, then use `fs.createOrGetDocHandle()` to get the Automerge handle and set the document fields directly with `handle.change()`. This is necessary because tool documents have custom schemas (not just a `content` string field).

**Example** (tic-tac-toe — a game mid-progress):

```javascript
// Get the original automerge URL of the tool folder (for suggestedImportUrl)
const toolUrl = await fs.getDocUrl("/my-tool");

// Create a placeholder file, then get its handle to set custom fields
await fs.writeFile("/my-tool/example.json", "");
const handle = await fs.createOrGetDocHandle("/my-tool/example.json");
handle.change(d => {
  d.title = "Tic Tac Toe — Example Game";
  d.board = ["X", "O", "X", null, "O", null, null, null, null];
  d.currentPlayer = "X";
  d.status = "playing";
  d.winner = null;
  d["@patchwork"] = {
    type: "tic-tac-toe",
    suggestedImportUrl: toolUrl,
  };
});
```

## Complete Example: Tic Tac Toe

Here is a full working example for reference:

**Document schema** (created via `createOrGetDocHandle` + `handle.change()`):

```javascript
const toolUrl = await fs.getDocUrl("/tic-tac-toe");

await fs.writeFile("/tic-tac-toe/example.json", "");
const handle = await fs.createOrGetDocHandle("/tic-tac-toe/example.json");
handle.change(d => {
  d.title = "Tic Tac Toe";
  d.board = [null, null, null, null, null, null, null, null, null];
  d.currentPlayer = "X";
  d.status = "playing";
  d.winner = null;
  d["@patchwork"] = {
    type: "tic-tac-toe",
    suggestedImportUrl: toolUrl,
  };
});
```

**Tool module** (`tic-tac-toe.js`): see the reference implementation at `automerge:442qEMJubfbNtu8bEikzX2j3Yyps`.

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
- **Package name**: use `@patchwork/your-tool-name`.
- **File name**: match the tool id (e.g., `tic-tac-toe.js`).

### Icons

Icons come from the [Lucide](https://lucide.dev/icons/) icon set. Use the PascalCase name of the icon (e.g., `"Grid3x3"`, `"CheckSquare"`, `"FileText"`).

## File Structure

A minimal tool package looks like:

```
my-tool/
├── package.json          # Package metadata
└── my-tool.js            # Datatype + Tool + plugins exports
```

## Template

Use this as a starting point for a new tool:

```javascript
/**
 * {{TOOL_NAME}} - Patchwork Tool
 *
 * @typedef {Object} {{TOOL_NAME}}Doc
 * @property {string} title
 * // ... your fields
 */

// ============================================================================
// Datatype
// ============================================================================

export const {{DATATYPE_NAME}} = {
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
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ============================================================================
// Tool
// ============================================================================

function createStyles() {
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
  return style;
}

export function Tool(handle, element) {
  const style = createStyles();
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

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "{{TOOL_ID}}",
    name: "{{TOOL_NAME}}",
    icon: "{{ICON_NAME}}",
    async load() {
      return {{DATATYPE_NAME}};
    },
  },
  {
    type: "patchwork:tool",
    id: "{{TOOL_ID}}",
    name: "{{TOOL_NAME}}",
    icon: "{{ICON_NAME}}",
    supportedDatatypes: ["{{TOOL_ID}}"],
    async load() {
      return Tool;
    },
  },
];
```

Replace all `{{PLACEHOLDERS}}`:

- `{{TOOL_NAME}}` — Human-readable name (e.g., "Kanban Board")
- `{{DATATYPE_NAME}}` — JS export name (e.g., `KanbanDatatype`)
- `{{DEFAULT_TITLE}}` — Default document title
- `{{PREFIX}}` — CSS class prefix (e.g., `kanban`)
- `{{TOOL_ID}}` — Kebab-case identifier (e.g., `kanban-board`)
- `{{ICON_NAME}}` — Lucide icon name (e.g., `"Columns"`)
