# Framework bindings

**Packages:**
- `@inkandswitch/patchwork-react` — React hooks and `toolify()`
- `@patchwork/solid` — Solid JS hooks

**Source:** `packages/react/`, `packages/solid/`

These packages wrap the `PluginRegistry` with framework-specific reactive hooks so that tool UIs automatically re-render when new plugins are installed or existing ones reload.

## React — `@inkandswitch/patchwork-react`

### Registry hooks

All hooks subscribe to the registry's `"changed"` event and re-render the component when any plugin is registered, loaded, or updated.

```ts
// All plugins of a given type
usePluginDescriptions<D, I>(type: string): Plugin<D, I>[]

// Shorthand for "patchwork:datatype"
useDatatypeDescriptions(): Plugin<DatatypeDescription, DatatypeImplementation>[]

// Shorthand for "patchwork:tool"
useToolDescriptions(): Plugin<ToolDescription, ToolImplementation>[]
```

These hooks return the current snapshot of all registered plugins (both loaded and not-yet-loaded). They do not trigger loading — they are suited for list UIs (a document-type picker, a tool selector) that show what is available.

```ts
// Load and subscribe to a single plugin by ID
usePlugin<D, I>(type: string, id?: string): LoadedPlugin<D, I> | undefined
useDatatype(id?: string): LoadedPlugin<DatatypeDescription, DatatypeImplementation> | undefined
useTool(id?: string): LoadedPlugin<ToolDescription, ToolImplementation> | undefined
```

`usePlugin` (and its typed shorthands) calls `registry.load(id)` and returns the loaded plugin, or `undefined` while loading. It also subscribes to `"changed"` so it re-renders when the plugin reloads (e.g. after hot-reload).

### `toolify`

```ts
function toolify(
  editorComponent: React.FC<{ docUrl: AutomergeUrl; element: ToolElement }>
): ToolImplementation
```

Converts a React component into a `ToolImplementation`. Wraps the component in a `RepoContext.Provider` (from `@automerge/automerge-repo-react-hooks`) so the component and all its children can call `useRepo()`, `useDocument()`, etc.

```ts
// tool.ts
import { toolify } from "@inkandswitch/patchwork-react";
import { MyEditor } from "./MyEditor";

export default toolify(MyEditor);
```

```tsx
// MyEditor.tsx
import { useDocument } from "@automerge/automerge-repo-react-hooks";

function MyEditor({ docUrl, element }: { docUrl: AutomergeUrl; element: ToolElement }) {
  const [doc, changeDoc] = useDocument<MyDoc>(docUrl);
  return <div>{doc.content}</div>;
}
```

The `element` prop is the `<patchwork-view>` DOM node itself, useful for reading `element.repo` or dispatching custom events.

`toolify` returns a cleanup function that calls `root.unmount()`.

---

## Solid — `@patchwork/solid`

All hooks use Solid stores with `reconcile` for fine-grained reactivity. They subscribe to `registry.on("changed")` and clean up via `onCleanup`.

```ts
// All plugins of a given type
usePlugins<T extends PluginDescription>(type: string): Plugin<T>[]

// Shorthand helpers
useTools(): Plugin<ToolDescription>[]
useDatatypes(): Plugin<DatatypeDescription>[]

// Filtered datatypes (reactive to registry changes)
useFilteredDatatypes(
  filter: (item: DatatypeDescription) => boolean
): Plugin<DatatypeDescription>[]

// Tools that support a given datatype (reactive to both type arg and registry changes)
useSupportedToolsForType(
  type: string | (() => string),
  options?: { includeUnlisted?: boolean }
): Plugin<ToolDescription>[]

// All plugins grouped by type: [typeName, Plugin[]][]
useModules(): [string, Plugin<PluginDescription>[]][]
```

`useSupportedToolsForType` accepts both a plain string and a Solid accessor (`() => string`), so it can be used reactively when the active document type changes.

`useModules` is useful for admin/settings UIs that need to display all installed plugins across all types.
