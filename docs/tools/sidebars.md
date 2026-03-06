# Sidebar tools

The sidebar tools live in `tools/sidebars/`. They split into two categories: the **account sidebar** (left panel — document browser) and **context tools** (right panel — document-specific panels like comments and history).

## sideboard

**Package:** `@chee/patchwork-sideboard`  
**Plugin ID:** `chee/sideboard`  
**Tag:** `sidebar-account`  
**Supported datatypes:** `["patchwork:account", "folder"]`  
**Framework:** Solid JS

Sideboard is the primary left-hand document browser. It receives the account document (which contains `rootFolderUrl` and `moduleSettingsUrl`) and renders the full document library tree.

Key responsibilities:
- Loads and displays the root `FolderDoc` and all nested folders and documents
- Dispatches `patchwork:open-document` when the user clicks a document
- Supports file drag-and-drop for re-ordering documents within folders
- Shows presence indicators (which documents other users have selected) using `$selectedDocUrls` from the selection subscribable
- Provides UI for creating new documents by datatype (using `useDatatypes()` from `@patchwork/solid`)
- Handles folder creation and document renaming

The main component is `Sideboard`, which takes `{ handle, repo, element }`. It renders nested folder trees using `Item` components that recursively render `DocLink`s.

## context-sidebar

**Package:** `@tiny-patchwork/context-sidebar`  
**Plugin ID:** `context-sidebar`  
**Tag:** `sidebar-context`  
**Supported datatypes:** `["account"]`  
**Framework:** React

The context sidebar is the right-hand panel container. It receives the account document and renders a **tabbed interface** where each tab is itself a context tool (another `<patchwork-view>`).

The list of tab tool IDs comes from `accountDoc.contextToolIds` (default: `["comments-view", "history-view", "context-view"]`). The active tab's tool receives the currently selected document URL.

Each tab label is rendered using `useTool(toolId)` from `@inkandswitch/patchwork-react` to display the tool's name and icon before its implementation is loaded.

## history-view

**Package:** `@tiny-patchwork/history-view`  
**Plugin ID:** `history-view`  
**Supported datatypes:** `["account"]`  
**Framework:** React

Displays the change history timeline of the currently selected document. The user can scrub through past states by selecting a change in the list.

When the user selects a historical state, the history view publishes a `ViewHeads` annotation (from `@inkandswitch/annotations-diff`) to the global annotation context. `patchwork-frame` subscribes to this and passes a heads-pinned URL to the main document view, showing the document as it was at that point in time.

This package also registers a second plugin: **`highlight-changes-checkbox`**, a toolbar button (`forTitleBar: true`) that toggles whether diff highlights are shown in the current document.

## comments-view

**Package:** `@tiny-patchwork/comments-view`  
**Plugin ID:** `comments-view`  
**Supported datatypes:** `["account"]`  
**Framework:** React

Displays comment threads attached to the currently selected document. Comment threads are stored inside the document itself (using the `DocWithComments` type from `@inkandswitch/annotations-comments`) and are surfaced as annotations in the global annotation context by `patchwork-frame`.

The comments view shows all open threads, allows replying, and lets users resolve threads.

## context-view

**Package:** `@tiny-patchwork/context-view`  
**Plugin ID:** `context-view`  
**Supported datatypes:** `["account"]`  
**Framework:** React

A general-purpose contextual information panel for the currently selected document. Shows metadata, links, and other document-level context. Built with `toolify()`.
