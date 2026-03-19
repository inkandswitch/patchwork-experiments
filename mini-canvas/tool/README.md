# Mini Canvas tool

## `ref-view`

Custom element **`ref-view`** (register with `registerRefView(repo)` from `index.js`) loads a module via dynamic `import()` and calls its **default export** as `default(ref, element)`:

- **`ref`** — resolved from the **`ref-url`** attribute using `findRef` / `encodeRefToURL` (`ref.js`).
- **`element`** — the `<ref-view>` host node.

Attributes **`tool-url`** and **`ref-url`** may be set with **`encodeURIComponent(...)`** so Automerge URLs and fragments stay safe in HTML; `ref-view` decodes them before `findRef` / `import`.

## `frame.js`

Source: [`../system/frame.js`](../system/frame.js) (sync / publish to Automerge as `frame.js` on the module root). Its default export **`mountMiniCanvasFrame(ref, element)`** renders the card (hello + `sourceFolder` line) and returns a teardown function.

Published module URL used by the shell tool:

`/automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m/frame.js`

## `MiniCanvasTool`

`index.js` **`MiniCanvasTool(handle, element)`** ensures styles, appends a `<ref-view>` whose **`tool-url`** is `encodeURIComponent` of the path above and **`ref-url`** is `encodeURIComponent` of `createRef(handle).toURL()`, then returns cleanup that removes the host.
