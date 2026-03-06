---
name: build-patchwork-tool
description: Generate a complete inline Patchwork tool as a single JavaScript file. Use when asked to build an interactive mini-app, game, tracker, editor, or any custom tool that runs in the Patchwork environment.
---

# Build Patchwork Tool Skill

A Patchwork tool is a self-contained interactive application with its own document schema and UI. When building a tool through chat, output a single JavaScript file using the `patchwork-tool` code fence. The system creates the module and pins it in the sidebar automatically.

## Output Format

Wrap the complete JS source in a `patchwork-tool` fence:

````
```patchwork-tool
// ... complete single-file module ...
```
````

The file must export three things: a `Datatype` object, a `Tool` function, and a `plugins` array.

## Required Exports

### 1. Datatype

Manages the document lifecycle. Use a named export.

```js
export const MyDatatype = {
  init(doc) {
    doc.title = "My Tool";
    // Initialize all document fields with defaults here
  },
  getTitle(doc) {
    return doc.title || "My Tool";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
```

### 2. Tool Function

Renders the UI into a DOM element and reacts to document changes. Must return a cleanup function.

```js
export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = `
    .mytool-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 16px;
      box-sizing: border-box;
    }
    /* All classes MUST use the .mytool- prefix */
  `;
  element.appendChild(style);

  const container = document.createElement("div");
  container.className = "mytool-container";
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc) return;
    container.innerHTML = "";
    // Build UI with DOM APIs
    // Mutations: handle.change(d => { d.field = value })
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

### 3. Plugins Array

Registers both datatype and tool using the inline `async load()` pattern:

```js
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "my-tool",
    name: "My Tool",
    icon: "Layers",
    async load() { return MyDatatype; },
  },
  {
    type: "patchwork:tool",
    id: "my-tool",
    name: "My Tool",
    icon: "Layers",
    supportedDatatypes: ["my-tool"],
    async load() { return Tool; },
  },
];
```

Note: this uses `async load()` (not `importPath`) because the tool lives in a single file.

## Document & Handle API

```js
handle.doc()                    // read-only snapshot of current document state
handle.change(d => { ... })     // mutate the document (syncs to all peers)
handle.on("change", fn)         // subscribe to local and remote changes
handle.off("change", fn)        // unsubscribe

// Automerge notes:
// - Never assign `undefined` — use `null` or `delete d.field`
// - Strings are collaborative text; assign directly for simple values
// - Use splice() from "@automerge/automerge" for efficient cursor-safe text edits
// - Arrays support index-based mutation: d.items[i] = value
```

## Rules

- **Vanilla DOM only** — no React, Vue, Svelte, or any framework
- **Scope all CSS** with a unique prefix (e.g. `.mytool-`, `.ttt-`) to avoid conflicts with other tools
- **Always return a cleanup function** from `Tool()` that calls `handle.off()` and removes DOM nodes
- **No `undefined`** in document fields — Automerge does not support it; use `null` or `delete`
- **Tool id and datatype id must match** in the `plugins` array
- **Icons** come from the [Lucide](https://lucide.dev/icons/) set — use PascalCase name (e.g. `"Grid3x3"`, `"CheckSquare"`, `"Activity"`)

## Updating an Existing Tool

After the Computer edits the JS source of an existing tool module via `edit_doc`, trigger a module reload by updating `lastSyncAt` on the folder doc:

```
```tool-call
tool: edit_doc
url: automerge:FOLDER_URL
field: lastSyncAt
value: CURRENT_EPOCH_MS
```
```

The folder URL is in the tool instance's `@patchwork.suggestedImportUrl` field.

## Complete Example

```js
export const CounterDatatype = {
  init(doc) {
    doc.title = "Counter";
    doc.count = 0;
  },
  getTitle(doc) { return doc.title || "Counter"; },
  setTitle(doc, title) { doc.title = title; },
};

export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = `
    .counter-root {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
      font-family: system-ui, sans-serif;
    }
    .counter-value { font-size: 4rem; font-weight: bold; }
    .counter-btn {
      padding: 8px 24px;
      font-size: 1.5rem;
      cursor: pointer;
      border: 1px solid #ccc;
      border-radius: 8px;
      background: #f5f5f5;
    }
    .counter-btn:hover { background: #e0e0e0; }
  `;
  element.appendChild(style);

  const root = document.createElement("div");
  root.className = "counter-root";
  element.appendChild(root);

  function render() {
    const doc = handle.doc();
    if (!doc) return;
    root.innerHTML = "";

    const value = document.createElement("div");
    value.className = "counter-value";
    value.textContent = doc.count;

    const btn = document.createElement("button");
    btn.className = "counter-btn";
    btn.textContent = "+1";
    btn.addEventListener("click", () => {
      handle.change(d => { d.count = (d.count || 0) + 1; });
    });

    root.appendChild(value);
    root.appendChild(btn);
  }

  render();
  handle.on("change", render);

  return () => {
    handle.off("change", render);
    root.remove();
    style.remove();
  };
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "counter",
    name: "Counter",
    icon: "Hash",
    async load() { return CounterDatatype; },
  },
  {
    type: "patchwork:tool",
    id: "counter",
    name: "Counter",
    icon: "Hash",
    supportedDatatypes: ["counter"],
    async load() { return Tool; },
  },
];
```
