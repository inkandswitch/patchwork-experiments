# Elements

**Package:** `@inkandswitch/patchwork-elements`  
**Source:** `core/elements/`

The elements package provides `<patchwork-view>` — the single web component that glues documents to tools. It is the universal rendering primitive: place it anywhere in the DOM with a `doc-url` attribute and it will find, load, and mount the right tool automatically.

## Registration

```ts
import { registerPatchworkViewElement } from "@inkandswitch/patchwork-elements";

registerPatchworkViewElement({ repo });
```

`registerPatchworkViewElement({ repo, hive?, name? })` calls `customElements.define` with the element class. The `repo` is captured in the closure and made available to every `<patchwork-view>` instance via `element.repo`. `name` defaults to `"patchwork-view"`.

## Attributes

| Attribute | Property | Description |
|---|---|---|
| `doc-url` | `docUrl` | The `AutomergeUrl` of the document to render |
| `tool-id` | `toolId` | Optional explicit tool ID; if omitted the best matching tool is used |

Both attributes and properties are kept in sync. Setting either triggers a teardown + re-init cycle.

## Render state machine

```
none
  │  doc-url set / connectedCallback
  ▼
initializing
  │  repo.find() resolves
  ▼
rendering ──────────────────────────────────────────────────┐
  │                                                          │
  ├── tool found + loaded ──→ rendered (tool-id given)       │ registry "loaded" event
  │                       ──→ fallback (no tool-id)          │ re-queues render
  │                                                          │
  ├── tool loading in progress ──→ unable (shows spinner) ───┘
  │
  ├── tool not found ──→ unable (shows error)
  │
  └── tool.module() throws ──→ error (shows error details)
```

Any change to `doc-url` or `tool-id`, or a `disconnectedCallback`, runs a full `#teardown()` → `#init()` cycle. Teardown calls all registered cleanup functions (the return value of `tool.module()`, registry event unsubscribers, doc handle listeners) and resets state to `none`.

## Render flow

On each render cycle:

1. Reads `@patchwork.type` from the live doc to determine the fallback tool ID
2. If `toolId` is not set: dispatches `patchwork:no-tool`, which prompts the host to load the suggested import URL
3. Looks up the tool in the `"patchwork:tool"` registry
4. If the tool has no `module` yet: calls `registry.load(toolId)` and shows a loading spinner; the `"loaded"` event will trigger a re-render
5. Calls `tool.module(handle, this)` — the tool mounts its UI into the element
6. Stores the returned cleanup function in the teardown set
7. Dispatches `patchwork:mounted`

The element also subscribes to `handle.on("change")`. If a change modifies `@patchwork.type` (the document's datatype changes), the element tears down and re-initializes to pick up a different tool.

Hot-reload is handled by listening to the `"loaded"` event on the tool registry: if a newly-loaded tool has a different `importUrl` than the currently-rendered one, the element tears down and re-renders with the fresh module.

## Custom events

All three events bubble and are `composed: true` (they cross shadow DOM boundaries).

### `patchwork:open-document`

Dispatched by tools or other code to request navigation to a document. The host app listens for this at the root element.

```ts
dispatchEvent(new CustomEvent("patchwork:open-document", {
  bubbles: true,
  composed: true,
  detail: {
    url: AutomergeUrl,
    toolId?: string,
    title?: string,
    type?: string,
  }
}));

// Helper shorthand:
openDocument(element, url, toolId?);
```

### `patchwork:mounted`

Dispatched after `tool.module()` is called successfully. Useful for showing the UI after the first render completes.

```ts
detail: { url: AutomergeUrl, toolId: string }
```

### `patchwork:no-tool`

Dispatched when no tool-id is provided and no matching loaded tool is found. The host uses this to trigger `ModuleWatcher.loadSuggestedImportUrl(url)`.

```ts
detail: { url: AutomergeUrl }
```

## TypeScript / JSX types

`elements.d.ts` augments the global JSX namespace so `<patchwork-view doc-url="..." tool-id="...">` is typed in both React and Solid without any extra imports.

## `ToolElement`

The element passed to `tool.module(handle, element)` is the `<patchwork-view>` instance itself, typed as `ToolElement`:

```ts
type ToolElement = HTMLElement & {
  repo: Repo;
  hive?: AutomergeRepoKeyhive;
};
```

Tools use `element.repo` to create sub-documents, find related documents, etc. They may also use it as a container for `<patchwork-view>` sub-elements for recursive document rendering.
