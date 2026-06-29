# Tiling Frame for Patchwork

A frame tool for Patchwork with a tiling-window-manager UI, inspired by
[television.run](https://television.run). Instead of the fixed
frame/sideboard metaphor, every document lives in a panel that you can split
and resize freely.

## Behaviour

- A persistent **app bar** runs across the top: a **home** button (focuses the
  root-folder panel if open, else opens it as a full-height column on the left),
  a **+** button (create-new dialog that makes a document of any registered
  datatype, inserts it into the root folder, and opens it — also accepts a pasted
  automerge URL), the **system tray**, a **shopping-bag** button that opens
  **Packages** (module settings / the app-store), a **gear** that opens
  **Settings** (the `frame-configurator` tool, bound to the account doc), and an
  **avatar** showing the logged-in contact that opens the account picker when
  clicked.
- The **system tray** mirrors the threepane frame: a row of configured
  `patchwork:component`s (tagged `system-tray`) read from the shared frame config
  doc (`account.tools["threepane"].tray`). It's the same configuration the
  threepane frame uses, edited via the gear's frame configurator, so the tray and
  settings stay in sync across frames. The config doc is created lazily if absent
  (skipped when the `threepane:config` datatype isn't installed, leaving the tray
  empty).
- On open, the account's **root folder** is shown as a narrow **navigator**
  beside a (wide) **empty content frame**, so the folder never spans the full
  width and there's always a slot ready for the first document.
- The folder navigator is stored **symbolically** (a `"root-folder"` panel with
  no document url): it resolves to the **viewer's own** `rootFolderUrl` at render
  time. So sharing a layout (by copying its URL) never carries your folder
  document — the recipient sees **their own** folders in that pane. Legacy
  url-based folder panes are migrated to the symbolic form on load.
- Documents only ever open into **content** panels — never the root-folder
  navigator or a **context** pane (comments, history, …). Opening one:
  - **fills an empty content frame** if one is waiting (the seeded slot beside
    the folder), otherwise
  - navigates the **last-focused other content panel** (so clicking an entry in
    the folder view opens it next to the folder, not in it), otherwise
  - splits an existing **content** panel — never the folder — to open a new one.

  Use a panel's **back** button to return to its previous document.
- **Split right** / **split down** tile the panel into two; the new panel
  mirrors the source so you can take each side somewhere different.
- Drag the handles between panels to **resize**.
- The whole arrangement (panels, splits, sizes, per-panel history, active
  panel) is **persisted to its own document**, so a reload restores your
  layout exactly where you left it.
- **Close** removes a panel and collapses its sibling into the freed space.
  The frame never goes empty, and there's always at least one content frame:
  closing the last content panel leaves an **empty content frame** beside the
  folder rather than letting the folder/context panes go full-width.
- Each panel's titlebar has a **tool picker** (shown when a document supports
  more than one tool). Choosing a tool re-renders just that panel's document
  with the selected tool; the default tool is marked accordingly.
- **Context tools** (comments, history, … — any tool tagged `context-tool`) are
  opened **on demand as panels**, not pinned to a fixed sidebar. A content
  panel's titlebar has a **context launcher** that spawns the chosen tool in a
  new panel beside it. Context tools describe the **selected document**: the
  most-recently-focused *content* panel (context panels are excluded, so opening
  Comments never makes Comments the subject). The selected panel shows an accent
  rail along its header, and each context panel shows a **subject chip** naming
  the document it describes — click it to reveal/focus that panel. Because
  context tools are just tools, the tabbed `context-sidebar` can also be opened
  as a panel for a compact, tabbed experience.
- The frame mounts patchwork-base's **context providers** so tools get their
  shared context via bubbling `patchwork:subscribe` events (see Architecture):
  comments authoring/listing, focus, and the current contact all work, and the
  selected document driving context tools is the active content panel.

## Architecture

- `layout.ts` — a binary split-tree (`LeafNode` | `SplitNode`) plus **in-place
  Automerge mutators** that edit the document draft directly:
  - `navigateLeafIn`, `goBackIn`, `setLeafToolIn`, `setSizesIn` make
    **field-level** edits (set a url, push/pop a history entry, set a size),
  - `splitLeafIn` / `removeLeafIn` only rewrite the **one subtree slot** they
    touch (the rest of the tree is untouched),
  - `makeInitialLayout` seeds a new session as `[folder | empty content frame]`,
    and `ensureContentFrameIn` upholds the invariant that a content frame always
    exists (a leaf whose `view.url` is absent is an empty content frame),
  - `makeRootFolderLeaf` builds the **symbolic** folder pane (`role:
    "root-folder"`, no url) and `normalizeRootFolderIn` migrates legacy url-based
    folder leaves to it, so a shared layout resolves the folder to the viewer's
    own `rootFolderUrl` instead of embedding the author's.
- `datatype.ts` — the **`patchwork-frame-tiling:layout`** datatype. Its
  document (`TilingLayoutDoc`) is the **single source of truth**: it stores the
  layout tree, the active panel id, and the focus order. The frame derives all
  rendering from `useDocument`, and every op is a granular `handle.change(...)`
  — no React copy of the layout, and no whole-tree rewrites. The account doc
  references it via a `tilingLayoutUrl` field, kept separate from the rest of
  the config so the frame owns its own state. Panel ids carry a per-session
  random tag so ids minted after a reload never collide with restored ones.
  Resize writes are debounced per-split so a drag persists only its settled
  size; focus writes are skipped when nothing changed.
- `PatchworkFrame.tsx` — renders the tree recursively with
  [`react-resizable-panels`](https://github.com/bvaughn/react-resizable-panels);
  each leaf hosts a `<patchwork-view>`. A single frame-level listener catches
  `patchwork:open-document`, identifies the source panel via its `data-leaf-id`,
  and routes the document to the most-recently-focused *other* panel (tracked in
  a focus-order ref) — or opens a new panel beside the source if none exists.
  Because this is a `frame-tool`, the frame configurator's preview cards would
  otherwise mount it inside itself and loop forever, so `renderPatchworkFrame`
  guards against being mounted inside *any* frame: `isMountedInsideFrame` walks
  the DOM (across shadow boundaries) and bails if an ancestor is marked
  `data-patchwork-frame` (the convention this frame sets on its root) **or** is a
  `<patchwork-view>` hosting a `frame-tool`. When nested, it renders a static
  placeholder instead of the live frame.
- `ensureSubdocs.ts` — lazily creates the `rootFolderUrl`, `moduleSettingsUrl`,
  `contactUrl`, and `tilingLayoutUrl` subdocs so the frame works against a
  fresh account document.
- `FrameProviders.tsx` — the **context-provider** layer. Patchwork-base tools no
  longer read globals (`window.accountDocHandle`); they open streaming
  subscriptions by dispatching a bubbling `patchwork:subscribe` event carrying a
  `MessagePort`, and a provider mounted on an ancestor answers over that port.
  The frame mounts the base providers via `<patchwork-view component="…">`:
  - `patchwork-account-provider` (with `doc-url={account}`) answers
    `patchwork:contact`,
  - `patchwork-comments-provider` answers `patchwork:comments` (it tracks every
    mounted doc's threads via `patchwork:mounted` events),
  - `patchwork-focus-provider` answers `patchwork:focus`.

  Children are gated until each base provider fires `patchwork:mounted` (with a
  grace-period fallback) so their listeners exist before tools subscribe.
  Selection (`patchwork:selected-doc` / `patchwork:selected-view`) is answered by
  the frame's **own** `SelectionProvider` rather than the base
  `SelectedDocProvider`, so the document context tools describe is the active
  *content* panel (matching the wayfinding) instead of the last-opened doc.

## Develop

```bash
pnpm install
pnpm build      # one-off build
pnpm dev        # rebuild on change
pnpm sync       # build + pushwork sync (requires a pushwork doc)
```
