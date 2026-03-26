---
name: canvas-tool
description: Write a plain-JS canvas tool for an existing datatype and place it on a Paper canvas via toolUrl embed. Use when asked to create a custom view or UI for an existing document type.
---

# Canvas Tool Skill

A canvas tool is a plain JavaScript module that renders a UI for an Automerge document. It is loaded dynamically by the embed shape when a `toolUrl` is set — the element calls your `default export` function with the document handle and a container element.

## Tool contract

Your script file must have a single `default export` function:

```javascript
export default function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = `/* ... your CSS ... */`;
  element.appendChild(style);

  const container = document.createElement("div");
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc) return;
    container.innerHTML = "";
    // build DOM from doc fields
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

## Handle API

| Method | Description |
|--------|-------------|
| `handle.doc()` | Returns the current document snapshot (sync). May be `undefined` before the doc loads — always guard. |
| `handle.change(fn)` | Mutate the document. `fn` receives a mutable draft. Changes are synced to all peers. |
| `handle.on('change', fn)` | Subscribe to document changes. Called after every local or remote change. |
| `handle.off('change', fn)` | Unsubscribe. Must be called in the cleanup function. |

## Rules

- **Plain JavaScript only.** No `import` statements, no bundler, no framework (no React, Vue, Solid, etc.).
- **`export default` is the only required export.** Do not define a `datatype`, `plugins`, or any other export — this tool is for an existing datatype, not a new one.
- **Write all styles** using a `<style>` element appended to `element`, or inline on DOM nodes.
- **Guard `handle.doc()`** — it may be `undefined` on the first render call. Return early if so.
- **Always return a cleanup function** that removes all DOM nodes you created and unsubscribes from `handle`.
- **Use `document.createElement`** for DOM construction. Do not use `innerHTML` to set structured content — use it only to clear a container (`container.innerHTML = ""`).
- **Use `height: 100%; width: 100%; box-sizing: border-box`** on your outermost container — `element` fills the embed frame and has no fixed size.

## Step-by-step

### 1. Write the tool script

Write a `.js` file. The file will be served at a URL; that URL is passed as `toolUrl` when placing the embed.

### 2. Place it on the canvas

Use the `paper` skill to place an embed pointing to your file:

```javascript
const { getPaper } = await importSkillApi("paper");
const paper = getPaper(repo, paperDocUrl);

await paper.placeEmbed(docUrl, "my-datatype", {
  toolUrl: "https://example.com/path/to/my-tool.js",
  width: 480,
  height: 320,
});
```

The embed will dynamically `import()` your script and call its default export with the document handle and its container element.

### 3. Update `toolUrl` on an existing embed

```javascript
await paper.updateShape(shapeId, { toolUrl: "https://example.com/path/to/my-tool.js" });
```

## Notes

- `handle.change(fn)` triggers a `change` event on all subscribers, including your own `render` — no need to call `render()` manually after a change.
- Avoid heavy computation inside `render` — it is called on every change event.
- If you need to track transient UI state (hover, selected item, etc.) that should not be stored in the document, use plain JS variables or closures rather than `handle.change`.
