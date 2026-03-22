# Mini Canvas — system

Files in this folder are the **source modules** that run inside the mini-canvas tool. The default entry point is [`frame.js`](frame.js).

## Writing a mount function

Every file loaded by `ref-view` must have a **default export** with this signature:

```js
export default function mount(element) {
  // render UI into element
  return () => { /* optional teardown */ };
}
```

The **`element`** is the `<ref-view>` DOM node. Access data through `element.ref`.

### Data access via `element.ref`

- `element.ref.value()` — read the current value at this ref's path.
- `element.ref.at('fieldName')` — navigate to a sub-field, returning a new `Ref`.
- `element.ref.change(fn)` — mutate: called as `fn(current)` to mutate in place, or `fn(() => newValue)` to replace a scalar. String fields are diffed with `updateText` automatically.
- `element.ref.toURL()` — serialise this ref to a string (useful for passing to another `<ref-view>`).

### Schema validation

Use `element.ref.as(schema)` to get a typed, validated `Ref<T>`:

```js
export const schema = {
  init() { return { title: '', count: 0 }; },
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new Error('expected object');
    return value;
  },
};

export default function mount(element) {
  const ref = element.ref.as(schema);
  ref.value();  // validated on every read
  ref.change((current) => { current.count += 1; });
}
```

If the data doesn't match the schema, `.value()` throws.

### Schema export

Modules can export a `schema` object alongside the default mount function:

```js
export const schema = {
  init()  { return { /* initial state */ }; },
  parse(value) { /* validate & return, or throw */ },
};
```

- **`init()`** — returns the initial value for new documents. Used by the tool when creating a world doc.
- **`parse(value)`** — validates a value against the schema. Returns the value if valid, throws if not.

### Parent traversal

`element.parent` returns the closest ancestor `<ref-view>` element, or `null` if there is none.

### Additional properties

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
