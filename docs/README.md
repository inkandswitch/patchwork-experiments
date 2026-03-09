# Patchwork

Patchwork is a document-centric application platform built on [Automerge](https://automerge.org/) CRDTs. Every piece of data — a text document, a drawing, a folder, even the user's configuration — lives as an Automerge document that syncs automatically across devices and collaborators. Tools (UI renderers) are also stored as Automerge documents and loaded on demand, making the system fully extensible at runtime without a deploy step.

## Core concepts

### Documents

Everything is an Automerge document with a stable `AutomergeUrl` (e.g. `automerge:2LZBb891v37vggWYQPJRbYdyBGGE`). Documents are content-addressed and can be pinned to a specific set of heads for time-travel reads. A `DocHandle` is the live, mutable reference to a document within a `Repo`.

Every document that participates in Patchwork carries a `@patchwork` metadata field:

```ts
type HasPatchworkMetadata = {
  "@patchwork": {
    type: string;             // identifies the datatype, e.g. "essay", "tldraw", "folder"
    suggestedImportUrl?: string; // where to load the tool module for this doc
    copies?: AutomergeUrl[];
    copyOf?: AutomergeUrl;
  };
};
```

> **Important — Automerge does not allow `undefined` values.**  
> Every field written inside `handle.change()` must be a valid JSON type (`string`, `number`, `boolean`, `null`, object, or array). Setting a property to `undefined` throws at runtime. Either omit the key entirely (use a conditional assignment or `delete`) or use `null` as an explicit "no value" sentinel.

### Datatypes

A **datatype** is a named schema for a document kind. It provides:

- `init(doc, repo)` — initializes a blank document with default structure
- `getTitle(doc)` — reads the document's human-readable title
- `setTitle?(doc, title)` — optionally sets the title

Datatypes are registered as plugins with the id string that appears in `@patchwork.type`.

### Tools

A **tool** is a UI renderer for one or more datatypes. Its implementation is a single function:

```ts
type ToolImplementation = (handle: DocHandle<T>, element: HTMLElement) => () => void;
```

It receives a doc handle and a DOM element, mounts its UI into that element, and returns a cleanup function. Tools declare which datatypes they support via `supportedDatatypes: "*" | string[]`.

### The virtual filesystem

Plugin modules (bundles of tools and datatypes) are themselves stored as Automerge folder documents — trees of named files. A Service Worker intercepts requests to `automerge:...` URLs and delegates them to the main thread, which walks the folder tree and returns the file contents. This means `import('/automerge:XYZ.../index.js')` works as a standard ES module import.

## How pieces fit together

```
Automerge Repo (CRDT store)
    ↕ sync
SharedWorker ←→ WebSocket server
    ↕ MessageChannel
Main tab
  ├── Service Worker  (serves automerge: URLs as HTTP)
  ├── ModuleWatcher   (imports tool bundles from automerge folders)
  ├── PluginRegistry  (holds loaded tools + datatypes)
  └── <patchwork-view> (renders a doc with the right tool)
```

See [architecture.md](./architecture.md) for the full end-to-end data flow.

## Sections

| Section | Contents |
|---|---|
| [architecture.md](./architecture.md) | End-to-end data flow and system diagrams |
| [core/](./core/README.md) | The four foundational packages |
| [packages/](./packages/README.md) | Shared libraries for building tools |
| [tools/](./tools/README.md) | The built-in tool plugins |
| [app/tiny-patchwork.md](./app/tiny-patchwork.md) | The Tiny Patchwork host application |

## Quick glossary

| Term | Meaning |
|---|---|
| `AutomergeUrl` | Stable content-addressed identifier for a document, optionally with heads: `automerge:<id>#<heads>` |
| `DocHandle<T>` | Live mutable reference to an Automerge document |
| `Repo` | The local Automerge document store and sync engine |
| `FolderDoc` | An Automerge document that acts as a directory, holding a list of `DocLink`s |
| `ToolImplementation` | `(handle, element) => cleanup` — the function signature every tool exports |
| `<patchwork-view>` | The web component that finds and mounts the right tool for a given doc URL |
| `HandoffHandler` | The main-thread callback the Service Worker delegates `automerge:` URL fetches to |
| `PluginRegistry` | Event-emitting map of registered plugins (tools or datatypes) |
| `ModuleWatcher` | Watches a `ModuleSettingsDoc` and dynamically imports tool bundles |
