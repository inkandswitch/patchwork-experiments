# Mini Canvas tool

## Filesystem (`filesystem.js`)

**`createFilesystem(repo, rootFolderUrl)`** wraps a Patchwork **`FolderDoc`** (`@inkandswitch/patchwork-filesystem`):

- **`readFile(path)`** — read a file as string (UTF-8 if `content` is bytes). Errors if the path is a folder.
- **`writeFile(path, content)`** — write text; creates a new `file` entry if missing, otherwise replaces text with Automerge **`updateText`** on `content` (existing `content` must already be a string).
- **`listFiles(path?)`** — entries in that folder whose `type` is not `'folder'` (empty path = system root). Errors if the path is not a folder.
- **`importFile(path)`** — `import()` the handoff / service-worker URL for that path (same pattern as `/${encodeURIComponent(automergeUrl)}/…` in Patchwork).
- **`getUrlOfFile(path?)`** — handoff URL for that path (for `fetch` / debugging; `importFile` uses the same builder).

`index.js` registers the system tree with `SYSTEM_FOLDER_URL` (same id as the default `sourceFolder` / Pushwork `system` root).

## `ref-view`

Custom element **`ref-view`** (register with `registerRefView(repo, filesystem)` from `index.js`) loads a module via dynamic `import()` and calls its **default export** as `default(ref, element)`:

- **`ref`** — resolved from the **`ref-url`** attribute using `findRef` / `encodeRefToURL` (`ref.js`).
- **`element`** — the `<ref-view>` host node. Use **`element.filesystem`** (optional) for the object passed to **`registerRefView`**.

Attributes **`tool-url`** and **`ref-url`** may be set with **`encodeURIComponent(...)`** so Automerge URLs and fragments stay safe in HTML; `ref-view` decodes them before `findRef` / `import`.

## `frame.js`

Source: [`../system/frame.js`](../system/frame.js) (sync / publish to Automerge as `frame.js` on the module root). Its default export **`mountMiniCanvasFrame(ref, element)`** renders the card (hello + `sourceFolder` line) and returns a teardown function.

Published module URL used by the shell tool:

`/automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m/frame.js`

## `MiniCanvasTool`

`index.js` **`MiniCanvasTool(handle, element)`** ensures styles, appends a `<ref-view>` whose **`tool-url`** is `encodeURIComponent` of the path above and **`ref-url`** is `encodeURIComponent` of `createRef(handle).toURL()`, then returns cleanup that removes the host.
