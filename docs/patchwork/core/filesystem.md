# Filesystem

**Package:** `@inkandswitch/patchwork-filesystem`  
**Source:** `core/filesystem/`

The filesystem package has two responsibilities:

1. **Data model** — defines the document types that form the virtual filesystem and the `@patchwork` metadata contract all documents must carry.
2. **Runtime services** — provides the handoff handler (main-thread side of the Service Worker bridge) and the `ModuleWatcher` (dynamic module importer).

## Data types

### `HasPatchworkMetadata`

Every document that participates in Patchwork must have a `@patchwork` field:

```ts
type HasPatchworkMetadata<Type extends string = string> = {
  "@patchwork": {
    type: Type;                  // datatype id, e.g. "essay", "tldraw", "folder"
    suggestedImportUrl?: string; // automerge URL of the module that can render this doc
    copies?: AutomergeUrl[];     // URLs of documents forked from this one
    copyOf?: AutomergeUrl;       // URL of the original this was forked from
  };
};
```

Helper accessors are exported for reading these fields without unsafe property access:

```ts
getType(doc)               // → string | undefined
getSuggestedImportUrl(doc) // → string | undefined
getCopies(doc)             // → AutomergeUrl[]
getCopyOf(doc)             // → AutomergeUrl | undefined
```

### `FolderDoc`

A folder is an Automerge document that acts as a directory:

```ts
type FolderDoc = {
  title: string;
  docs: DocLink[];
  lastSyncAt?: number; // set by pushwork CLI to trigger hot-reload
};

type DocLink = {
  name: string;       // filename within the folder (e.g. "dist", "index.js")
  type: string;       // datatype id of the linked document
  url: AutomergeUrl;
  icon?: string;
  copyOf?: AutomergeUrl;
};
```

Folders are recursive: a `DocLink` whose linked document is itself a `FolderDoc` acts as a subdirectory. Tool module packages are stored as folder trees — `dist/index.js`, `package.json`, etc. — where each file is a `UnixFileEntry` document.

### `UnixFileEntry`

A leaf file within a folder:

```ts
type UnixFileEntry = {
  content: string | Uint8Array | ImmutableString;
  extension: string;
  mimeType: string;
  name: string;
};
```

`ImmutableString` is an Automerge text type. The filesystem handler transparently handles all three content variants when building the HTTP response.

### `ModuleSettingsDoc`

A document that holds a user's list of installed module packages:

```ts
type ModuleSettingsDoc = {
  modules: AutomergeUrl[];
} & HasPatchworkMetadata & {
  "@patchwork": { type: "patchwork:module-settings" };
};
```

Each `AutomergeUrl` in `modules` points to a `FolderDoc` root of an installed tool package.

## `createFilesystemHandoffHandler`

```ts
function createFilesystemHandoffHandler(repo: Repo): HandoffHandler
```

Creates the `HandoffHandler` registered with `setupServiceWorker`. When the Service Worker receives a request for an `automerge:` URL, this handler:

1. Parses the URL into an Automerge document ID and a path (`dist/index.js`, `package.json`, etc.)
2. Calls `repo.find(docId)` to get the root `FolderDoc` handle
3. If the URL has no `#heads` (not pinned to a specific version), issues a **307 redirect** to the same URL with the current heads appended — ensuring every cached response is content-addressed
4. Traverses the folder tree via `findFileHandleInFolderHandle`, following `DocLink.name` entries for each path segment
5. Returns the file's `content` and `mimeType`

On any error (document not found, path resolution failure), the handler clears the broken document from the cache and from the repo, preventing stale bad data from being served on the next request.

### URL format

Automerge URLs cannot appear directly in HTTP paths because of their colons and other characters. They are percent-encoded:

```
/automerge%3A2LZBb891v37vggWYQPJRbYdyBGGE%23abc123.../dist/index.js
 ↑ forward slash prefix
  ↑ URI-encoded automerge URL (with optional #heads)
                                              ↑ path within the folder
```

The helper `automergeUrlToServiceWorkerUrl(url)` performs the encoding.

## `ModuleWatcher`

```ts
class ModuleWatcher {
  constructor(
    repo: Repo,
    urls: AutomergeUrl | AutomergeUrl[],
    callback: (name: string, mod: any) => void
  )
  loadSuggestedImportUrl(docUrl: AutomergeUrl): Promise<void>
}
```

`ModuleWatcher` watches one or more `ModuleSettingsDoc` handles and dynamically imports every module listed in their `modules` arrays. On construction it immediately imports all current modules, then subscribes to changes to pick up additions or removals.

The `callback` is called with the module name (import URL) and the loaded ES module object for every successful import. The caller is responsible for calling `registerPlugins` on `mod.plugins`.

### Hot-reload

For each module URL, `ModuleWatcher` also watches the corresponding `FolderDoc` for changes to `lastSyncAt`. When the `pushwork` CLI syncs a new build into an Automerge folder, it bumps this field. The watcher detects the bump, pins the current heads into a versioned URL, and re-imports at that URL. Since the versioned URL is different from the previous one, the Service Worker cache does not interfere — the new bundle is fetched fresh.

### Loading a suggested import URL

```ts
moduleWatcher.loadSuggestedImportUrl(docUrl)
```

Used in response to a `patchwork:no-tool` event. It reads the `@patchwork.suggestedImportUrl` from the document at `docUrl` and imports that module. This is how the system lazily loads tool modules the first time a document of an unfamiliar type is opened.

## `importModuleFromFolderDocUrl`

```ts
function importModuleFromFolderDocUrl(folderDocUrl: AutomergeUrl): Promise<any>
```

Lower-level than `ModuleWatcher`. Fetches `package.json` from the folder via the Service Worker, resolves the entry point using the `exports` field (preferring `"import"` and `"patchwork"` conditions), and calls `import()` on the resolved path. Used internally by `ModuleWatcher`.
