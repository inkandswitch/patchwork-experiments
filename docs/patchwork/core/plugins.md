# Plugins

**Package:** `@inkandswitch/patchwork-plugins`  
**Source:** `core/plugins/`

The plugins package provides the central registry that connects documents to the tools and datatypes that know how to work with them. It is intentionally framework-agnostic — the registry stores plain objects and emits events; framework bindings (React, Solid) live in separate packages.

## Plugin types

There are two kinds of plugins:

### Datatypes

A **datatype** describes a document schema and how to work with documents of that type.

```ts
interface DatatypeDescription extends PluginDescription {
  type: "patchwork:datatype";
  icon: string;
  unlisted?: boolean;
}

type DatatypeImplementation<D = unknown> = {
  init(doc: D, repo: Repo): void;
  getTitle(doc: D): string;
  setTitle?(doc: D, title: string): void;
};
```

- `init` — called when creating a new document; sets up any required initial structure
- `getTitle` — returns a human-readable title for display in the UI; must be synchronous
- `setTitle` — optional; allows renaming a document

### Tools

A **tool** renders a document into a DOM element.

```ts
type ToolDescription = PluginDescription & {
  type: "patchwork:tool";
  supportedDatatypes: "*" | string[]; // datatype IDs this tool can render
  tags?: string[];
  unlisted?: boolean;
  forTitleBar?: boolean;
};

type ToolImplementation<T = unknown> = (
  handle: DocHandle<T>,
  element: ToolElement
) => () => void;
```

The tool function receives the doc handle and a `ToolElement` (an `HTMLElement` with `repo` and optional `hive` properties attached). It mounts its UI and returns a cleanup function. The cleanup is called whenever the element is torn down (attribute change, disconnection, or hot-reload).

`forTitleBar: true` marks a tool as a titlebar button rather than a document renderer. Tools tagged as such are rendered by the frame in the toolbar area.

### Base plugin shape

```ts
interface PluginDescription {
  id: string;
  type: string;
  name: string;
  icon?: string;
  importUrl?: string; // set automatically when registering
}

// Not yet loaded — has a load() function
type LoadablePlugin<D, I> = D & { load: () => Promise<I> }

// Fully loaded — has the implementation module
type LoadedPlugin<D, I> = D & { module: I }

// Either state
type Plugin<D, I> = LoadedPlugin<D, I> | D
```

## `PluginRegistry<D, I>`

The registry is a generic class backed by `EventEmitter3`. There is one singleton registry per plugin type (keyed by `type` string).

```ts
class PluginRegistry<D extends PluginDescription, I = any> {
  register(plugin: LoadablePlugin<D, I>, importUrl: string): void
  get(id: string): Plugin<D, I> | undefined
  all(): Plugin<D, I>[]
  filter(fn): Plugin<D, I>[]
  load(id: string): Promise<LoadedPlugin<D, I> | undefined>
  loadAll(plugins): Promise<LoadedPlugin<D, I>[]>
  has(id: string): boolean
  on(event, callback): () => void
  off(event, callback): void
  loading: Set<string>
}
```

### `register`

Stores the plugin description plus its `load()` function. If a plugin with the same `id` already exists, it is overwritten (with a console warning if the `importUrl` differs). This supports hot-reload: a re-imported module re-registers its plugins under the same IDs with a new `importUrl`, and any listening `<patchwork-view>` elements detect the URL change and re-render.

### `load`

Calls `plugin.load()` (the dynamic import bundled with the plugin package), then merges the result as `{ ...description, module: implementation }`. The `load` function is removed from the stored object. Concurrent calls for the same ID share a single in-flight promise.

### Events

| Event | Payload | When |
|---|---|---|
| `"registered"` | `Plugin<D, I>` | A plugin description is stored (before loading) |
| `"loaded"` | `LoadedPlugin<D, I>` | A plugin's implementation has been fetched |
| `"removed"` | `string` (id) | A plugin is removed |
| `"changed"` | — | Any of the above; convenience event for re-rendering |

All `on()` calls return an unsubscribe function.

## Global registry store

```ts
function getRegistry<T extends PluginDescription>(type: string): PluginRegistry<T>
function registerPlugins(plugins: LoadablePlugin[], importUrl: string): void
function getAllRegistries(): Map<string, PluginRegistry<any>>
```

`getRegistry(type)` lazily creates and caches a `PluginRegistry` keyed by `type`. The two standard types are `"patchwork:tool"` and `"patchwork:datatype"`. New types can be added via TypeScript module augmentation of `RegistryTypeMap`.

`registerPlugins` is what tool modules call on import:

```ts
// inside a tool module
export const plugins = [
  {
    id: "my-editor",
    type: "patchwork:tool",
    name: "My Editor",
    supportedDatatypes: ["my-datatype"],
    load: () => import("./tool.js").then(m => m.default),
  },
  {
    id: "my-datatype",
    type: "patchwork:datatype",
    icon: "📝",
    name: "My Datatype",
    load: () => import("./datatype.js").then(m => m.default),
  },
];

// called by ModuleWatcher's callback
registerPlugins(plugins, importUrl);
```

## Tool resolution

### `getSupportedToolsForType(type: string): LoadedTool[]`

Returns all tools from the registry whose `supportedDatatypes` includes the given type string or `"*"`. Returns only tools that are already loaded (have a `module`).

### `getSupportedTools(doc: HasPatchworkMetadata): LoadedTool[]`

Reads `@patchwork.type` from the document and calls `getSupportedToolsForType`.

### `getFallbackTool(doc: HasPatchworkMetadata): LoadedTool | undefined`

Returns the single best tool for a document, used when no explicit `tool-id` is specified. Selection priority:

1. Tools that specifically list the document's datatype (not wildcard `"*"`) come first
2. Wildcard tools come last
3. Within each group, tools are sorted alphabetically by `id`
4. Tools with `unlisted: true` are excluded

## Document creation helper

```ts
createDocOfDatatype2<D>(
  datatype: LoadedDatatype<D>,
  repo: Repo,
  change?: (doc: D) => void
): Promise<DocHandle<D & HasPatchworkMetadata>>
```

Creates a new Automerge document, calls `datatype.module.init(doc, repo)`, and sets `@patchwork.type` and `@patchwork.suggestedImportUrl`. The `suggestedImportUrl` is set to the datatype's `importUrl` so the document carries a self-contained pointer to the module that can render it.
