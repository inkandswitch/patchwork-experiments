# patchwork-frame

**Package:** `@tiny-patchwork/patchwork-frame`  
**Source:** `tools/tiny-patchwork/patchwork-frame/`  
**Plugin ID:** `patchwork-frame`  
**Supported datatypes:** `["account"]`

`patchwork-frame` is the application shell for Tiny Patchwork. It is itself a tool — a `ToolImplementation` that receives the user's account (`TinyPatchworkConfigDoc`) document and renders the entire surrounding UI: left sidebar, document area, toolbar, and right context sidebar. All other tools run inside it.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  left sidebar  │  toolbar (doc-title, back-link, ...)    │
│  (account      ├──────────────────────────────────────── │
│   sidebar      │                                          │
│   tool)        │   main document area                     │
│                │   <patchwork-view doc-url={selectedDoc}> │
│                │                                          │
│                │                          │ right sidebar │
│                │                          │ (context      │
│                │                          │  sidebar tool)│
└──────────────────────────────────────────────────────────┘
```

Every region is another `<patchwork-view>` element. The frame does not know anything about the specific tools that render each region — it only knows the tool IDs stored in the account document:

```ts
type TinyPatchworkConfigDoc = {
  rootFolderUrl: AutomergeUrl;
  accountSidebarToolId: string;      // default: "chee/sideboard"
  contextSidebarToolId: string;      // default: "context-sidebar"
  contextToolIds: string[];
  documentToolbarToolIds: string[];  // rendered one per item in the toolbar
};
```

## Document selection

The frame maintains a single piece of local state: `selectedView: { url: AutomergeUrl; toolId?: string }`. This is updated by listening to `patchwork:open-document` events that bubble up from any nested `<patchwork-view>`. The frame stops propagation so the event does not reach the host app's global listener.

When a document is selected:
- The toolbar renders each tool in `documentToolbarToolIds` with `doc-url={selectedDocUrl}` (one `<patchwork-view>` per toolbar tool ID)
- The main area renders `<patchwork-view doc-url={selectedDocUrl} tool-id={selectedView.toolId}>`

## Sidebars

Both sidebars are collapsible and resizable. Width and collapsed state are persisted to `localStorage` (`patchwork:leftSidebarCollapsed`, `patchwork:leftSidebarWidth`, etc.). The drag handle doubles as the toggle button: a short click toggles, a drag resizes (with a 3px threshold to distinguish them).

The left sidebar always receives the account document URL (`accountDocUrl`) — so the sidebar tool (typically sideboard) can read the `rootFolderUrl` and render the document list.

The right sidebar (context sidebar) also receives the account document URL, letting it read `contextToolIds` and `contextSidebarToolId`.

## Time-travel (ViewHeads)

The frame subscribes to `ViewHeads` annotations on the selected document via the global annotation context. When a `ViewHeads` annotation is present (set by the history view when the user scrubs through history), the frame passes a heads-pinned URL to the main document view:

```ts
const selectedDocUrl = viewHeads
  ? stringifyAutomergeUrl({ documentId, heads: encodeHeads(viewHeads.afterHeads) })
  : selectedView.url;
```

This means the entire document view — including all toolbar tools — automatically shows the historical state when the user is browsing history.

## Registration

```ts
// tools/tiny-patchwork/patchwork-frame/src/index.ts
export const plugins = [
  {
    id: "patchwork-frame",
    type: "patchwork:tool",
    name: "Patchwork Frame",
    supportedDatatypes: ["account"],
    unlisted: true,
    async load() {
      return (await import("./tool")).default;
    },
  },
];
```

The tool is loaded via `toolify(PatchworkFrame)`, which wraps the React component with a `RepoContext.Provider`.
