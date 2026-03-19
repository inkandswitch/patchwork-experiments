# Mini Canvas — system

Files in this folder are the **source modules** that run inside the mini-canvas tool. The default entry point is [`frame.js`](frame.js).

## Writing a mount function

Every file loaded by `ref-view` must have a **default export** with this signature:

```js
export default function mount(ref, element) {
  // render UI into element
  return () => { /* optional teardown */ };
}
```

- **`ref`** — a pointer into the tool's Automerge document. Use these methods:
  - `ref.get()` — read the current value at this path.
  - `ref.ref('fieldName')` — navigate to a sub-field, returning a new ref.
  - `ref.change(fn)` — mutate: called as `fn(value)` to mutate in place, or `fn(() => newValue)` to replace a scalar. String fields are diffed with `updateText` automatically.
  - `ref.toURL()` — serialise this ref to a string (useful for passing to another `<ref-view>`).

- **`element`** — the `<ref-view>` DOM node. Append UI directly into it. Also carries:
  - `element.filesystem` — filesystem rooted at this system folder (see below).

Return a **cleanup function** if you need to tear down subscriptions, timers, or child nodes when the view is unmounted.

## Filesystem (`element.filesystem`)

All paths are relative to this system folder.

```js
const fs = element.filesystem;

await fs.readFile('notes.md')              // → string
await fs.writeFile('notes.md', newText)    // create or overwrite
await fs.listFiles()                       // → [{ name, type, url }, …]
await fs.listFiles('subfolder')            // same, for a subdirectory
await fs.importFile('other-module.js')     // → ES module (dynamic import)
fs.getUrlOfFile('image.svg')               // → fetch-able URL string
```

`writeFile` creates the file if it does not exist. `listFiles` only returns files, not subdirectories.
