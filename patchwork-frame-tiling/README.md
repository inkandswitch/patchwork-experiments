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
- The **system tray** is registry-driven: a row of every registered
  `patchwork:component` tagged `"system-tray"`, rendered as bare components (no
  document). There's nothing to configure — a component just declares the tag
  and shows up here, in threepane's tray too.
- On open, the account's **root folder** is shown as a narrow **navigator**
  beside a (wide) **empty content frame**, so the folder never spans the full
  width and there's always a slot ready for the first document.
- The folder navigator is stored **symbolically** (a `"root-folder"` panel with
  no document url): it resolves to the **viewer's own** `rootFolderUrl` at render
  time. So sharing a layout (by copying its URL) never carries your folder
  document — the recipient sees **their own** folders in that pane.
- Documents only ever open into **content** panels — never the root-folder
  navigator. Where one goes:
  - opened from **inside a document** (a link, a folder shown in a panel),
    it opens **in that same panel**, over the document it came from;
  - opened from the **folder navigator**, it **fills an empty content frame**
    if one is waiting (the seeded slot beside the folder), else goes to the
    **last-focused content panel**;
  - opened from the **URL** — the address bar edited, back/forward, a plain
    `#doc=…` link, a deep link on load — it's a link followed from the
    **focused document panel**, and opens there by the same rule. A new browser tab clones the
    layout of the tab you were last looking at along with its focus, so a link
    opened into it lands in the panel you were last in;
  - opened from nowhere in particular (an overlay, say), it splits an
    existing **content** panel — never the folder — into a new one.

  **Quick Open** (⌘P; Ctrl-P off a Mac) finds a document by name: every
  open tab, the focused panel's first, then everything in your folder tree,
  nearest first. Letters match in order, anywhere; a run at the start of a
  name or word ranks first, then initials ("sp" for "Sail plan"). Enter opens
  the choice as a folder click would (Shift keeps the tab it would replace,
  Alt opens beside), and a document already open is only shown. With nothing
  typed it starts on the one before the document in front of you, so ⌘P,
  Enter goes back. Keys in an iframe-isolated tool don't reach the frame, so
  ⌘P there prints. See `quickOpenItems.ts`.

  **Tab keys.** The browser keeps ⌘W/Ctrl-W and its next/previous-tab keys
  (Ctrl-Tab, ⌘⇧[ ]), so the frame uses the stand-ins editors in a browser
  use: **⌥W / Alt+W** closes the tab showing (a panel's last tab closes the
  panel, as its × does), **Ctrl+Shift+] / [** shows the next or previous tab
  (Ctrl on a Mac too), and **⌃1–9** on a Mac (**Alt+1–9** elsewhere) shows
  tab N, 9 the last. They act on the focused panel, or, with focus in the
  folder, on the selected document's. A tool that takes one of these keys
  (calls `preventDefault`) keeps it; Quick Open's keys are its own while it's
  up. Like Quick Open's, they don't reach the frame from an iframe-isolated
  tool. These keys, Quick Open's, Back and Forward, and a modifier held on
  its own aren't engagement: stepping past a preview doesn't keep it. See
  `tabKeys.ts`.

  **Finding the keys.** **?** (anywhere but a text field) or the top bar's
  keyboard button opens a sheet of every key and modified click the frame
  answers to, spelled for your platform; Escape, ?, × or a click elsewhere
  closes it. The buttons that do the same name their keys in their
  tooltips: the showing tab's × (⌥W), a lone document's panel × (⌥W), each
  tab its number (⌃1–8, ⌃9 for the last), the tab list ⌃⇧[ ]. All of it
  comes from one table, `shortcuts.ts`, whose tests press every key it lists
  through the frame's own matchers, so it can't name a key the frame doesn't
  answer to.

  **Closing the browser tab** (⌘W, which pages can't intercept) asks
  first, while the frame is mounted: tools hold things outside their
  documents (a call, unsent text, undo). It doesn't ask when the page itself
  sent it: a reload key (⌘R, Ctrl-R, F5), or a click on a button or link just
  before (the host's Reload for a new build, a link out). The layout itself
  is never at risk: ⌘⇧T reopens the tab as it was. See `unloadGuard.ts`.

  **Back and Forward** are the browser's. Each open you make (the folder, a
  link, Shift, Alt, the top bar) is one history entry, recording the panel it
  landed in; nothing else is one. Focusing another panel or switching tabs
  rewrites the current entry, since the URL always names the selected
  document. Back to a document still open shows it; Back to one replaced or
  closed since reopens it as a preview in the panel it was in (or the focused
  one, if that's gone). The frame makes the entry itself and keeps the open
  from the host's router, then tells the host what's showing so it retitles
  the page; the host's hash write is then the hash already there, which by
  the spec is no navigation.

  A document opens as a **preview**, its name in *italic*: until you engage
  with it — a click or a key in the document, renaming it, or dragging it
  somewhere — the next open in its panel **replaces** it. Once engaged, the
  next open **stacks** over it as a new tab. So clicking through the folder
  looking for something leaves one tab, while opening something after working
  in a document starts a second. Scrolling isn't engaging. Nor is the click
  that follows a link: following links from a preview replaces it each time,
  so a chain of links you only skimmed also leaves one tab. A panel holds at
  most one preview; one left behind another tab goes when the panel next
  opens something.

  **Shift-click** keeps the tab that would be replaced and stacks over it.
  **Alt-click** opens beside the panel instead (Alt+Shift-click: below), as a
  preview of its own. Both work for anything a tool opens from a click, and
  for `#doc=…` links. Tools isolated in an iframe don't share the frame's
  clicks, so there they're ordinary clicks (clicking into one does engage it).
- A content panel can hold a **stack** of documents, one showing. The header
  lists them as plain text, the showing one in full ink; click one to show it,
  middle-click or its × to remove it. Every stacked document stays mounted, so
  its tool keeps its state behind the others. Drag a tab onto another panel's
  **middle** to stack it there, or an **edge** to split it off. A panel's
  **header is its handle**: drag it (its title, or any bare part of it) to move
  the whole panel to another's edge, or onto its middle to stack all of its
  documents there, so a single document moves in and out of stacks the way a
  tab does. Dropping onto a panel's **header** puts them in its strip at the
  position marked between tabs (before or after a lone document's title), and
  dragging a tab along its own strip reorders it. Opening a document that's
  stacked somewhere shows its tab. A stack too long for its header scrolls
  sideways (a mouse wheel scrolls it too), fades at an edge with more beyond
  it, and keeps the showing tab in view; a count at its end lists every tab.
- Drag the handles between panels to **resize**.
- The whole arrangement (panels, splits, sizes, stacks, active
  panel) is **persisted to its own document**, so a reload restores your
  layout exactly where you left it.
- **Close** removes a panel and collapses its sibling into the freed space.
  The frame never goes empty, and there's always at least one content frame:
  closing the last content panel leaves an **empty content frame** beside the
  folder rather than letting the folder pane go full-width.
- **Double-click a document's name** — a lone document's title, or any tab —
  to rename it in place (Enter or leaving the field saves, Escape cancels),
  through its datatype's `setTitle`; datatypes that can't set a title aren't
  offered it.
- A document panel's **datatype icon** opens a **View as…** menu when the
  document supports more than one tool: the datatype's own tools first, then,
  under their own rule, tools that render *any* document (Raw, say). The header
  names the tool only when it isn't the default. Choosing one of the
  datatype's tools is remembered for the document and the datatype; a generic
  tool is a peek, for that panel only.
- The folder navigator starts about **260px** wide (converted to a percentage
  of the window when the column is made).
- **Context tools** (comments, history, …) are registry-driven too: every
  registered `patchwork:component` tagged `"context-tool"` is available, with
  nothing configured — the same set threepane's context sidebar shows. They
  live in a document panel's **drawer**, along its right edge: a sheet a
  shade off the documents' white, so it reads as a layer over the panel
  without a shadow. Its spine is a **rail** of every context tool's icon,
  naming each on hover. The drawer button in the panel header (a panel with
  its right strip, faint until the header is hovered, lit while open) opens
  and closes it, on the tool it last showed. Nothing of the frame's lies over
  the document's right edge while the drawer is closed: that edge belongs to
  the document (its scrollbar, its own toolbars). Open, the rail runs down the
  drawer's outer edge with the shown tool lit; pick another to switch, or the
  lit one to close the drawer. The drawer shows
  one tool at a time, under
  its name; a tool mounts the first time it's shown and stays mounted while
  the drawer is open. A drawer describes **its own panel's**
  document — the showing one, if the panel is stacked — whichever panel has
  focus: the frame answers its tools' `patchwork:selected-doc` /
  `selected-view` with that panel's document, and the drawer sits inside that
  document's own providers (see below), so everything else its tools ask for
  is that document's too. Closed, a drawer remembers its tool and width,
  so it reopens as it was. Drag its left hairline to resize it (capped at 60%
  of the panel). It stays with its panel when the panel moves.
- **Overlays** are registry-driven as well: every `patchwork:component` tagged
  `"overlay"` is mounted once, in a full-frame layer above the panels that lets
  pointer events through (the component's own surface opts back in), and each
  gets a **top-bar button** beside the tray. The button sends
  `patchwork:toggle-overlay` to the overlay's `<patchwork-view>`; the overlay
  answers with a bubbling `patchwork:overlay-state` `{ open }`, which shows the
  button pressed. The ambient agent's floating box is one.
- Besides the selection, the frame answers **`patchwork:open-views`** with
  every content panel's document — `[{ url, toolId, selected }]` — for tools
  whose context is everything on screen.
- The frame mounts patchwork-base's **context providers** so tools get their
  shared context via bubbling `patchwork:subscribe` events (see Architecture):
  comments authoring/listing, focus, and the current contact all work. The
  frame-wide selection (for overlays such as the agent, and the URL) is the
  active content panel, marked by a rule under its header; a drawer answers
  with its own panel's document instead.
- **Every document has its own providers**, as threepane's one document does
  (`DocScope`, in `docScope.tsx`): the draft state (bound to the document) and
  draft overlay, any components tagged `"document-provider"`, then comments
  and focus. Its view and — for the showing tab — the panel's drawer render
  inside them, once they've all mounted. The providers are mounted in order,
  each once the one outside it has, and the view only after the last, with no
  time-out: a view that asked for its document before the overlay was
  listening would get the root's pass-through and keep it, so no draft or
  history scrub would ever reach it. A different provider list (drafts
  registering after the panel opened) rebuilds the scope rather than turning
  its elements into other providers in place. So the drawer's tools talk to *their*
  document: **History** and **Drafts** see its checked-out draft and
  checkpoint through the overlay and move them through the draft state;
  **Comments** shares the document's focus doc with its editor, and the panel
  registers there as a comments-view opener (`CommentsOpener`), so a comment
  clicked in the document opens the drawer on Comments. Like threepane's
  sidebar, the drawer's tools remount when the panel shows another tab.
  Overlays, outside every document, reach the selected document's draft state
  through the frame's `DraftRelay`.
- **On a narrow screen** (under 700px) the panes become an accordion, in CSS
  alone: every split is laid out as one column, in reading order, and only
  the active pane is open — the rest fold to their headers, so their tabs are
  a tap away, and a tap there opens that pane. The tab strip scrolls
  sideways, the rail of context tools stands beside the document, and an open
  drawer covers it (tap the lit tool to close it). Nothing is written to the
  layout, so the splits are still there on a wide screen.

## Architecture

- `layout.ts` — a binary split-tree (`LeafNode` | `SplitNode`) plus **in-place
  Automerge mutators** that edit the document draft directly:
  - `navigateLeafIn`, `goBackIn`, `setLeafToolIn`, `setSizesIn` make
    **field-level** edits (set a url, show a tab, set a size),
  - `splitLeafIn` / `removeLeafIn` only rewrite the **one subtree slot** they
    touch (the rest of the tree is untouched),
  - `makeInitialLayout` seeds a new session as `[folder | empty content frame]`,
    and `ensureContentFrameIn` upholds the invariant that a content frame always
    exists (a leaf whose `view.url` is absent is an empty content frame),
  - `makeRootFolderLeaf` builds the **symbolic** folder pane (`role:
    "root-folder"`, no url), so a shared layout resolves the folder to the
    viewer's own `rootFolderUrl` instead of embedding the author's.
- `datatype.ts` — the **`patchwork-frame-tiling:layout`** datatype. Its
  document (`TilingLayoutDoc`) is the **single source of truth** for the
  layout tree. Focus is this browser tab's own: it lives in `sessionStorage`,
  and the visible tab also leaves it in one `localStorage` slot for a new tab
  that clones its layout to pick up. The frame derives all
  rendering from `useDocument`, and every op is a granular `handle.change(...)`
  — no React copy of the layout, and no whole-tree rewrites. Each tab has its
  own layout document, named in the URL (`layout=`); the account's
  `currentLayoutUrl` points at the latest, which a new tab clones. Panel ids carry a per-session
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
- `ensureSubdocs.ts` — lazily creates the `rootFolderUrl`, `moduleSettingsUrl`
  and `contactUrl` subdocs so the frame works against a
  fresh account document. Nothing to create for context tools or the tray —
  `useTaggedComponents` (in `useDocTitle.ts`) resolves both directly from the
  `patchwork:component` registry, with no shared config doc involved.
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
  `SelectedDocProvider`, so the selection is the active *content* panel
  (matching the wayfinding) instead of the last-opened doc. Each drawer nests
  another `SelectionProvider`, answering with its own panel's document, and
  each document its own comments and focus providers (and drafts); since
  `accept` stops a subscription's propagation, the nearest provider wins. The
  frame-wide comments and focus providers serve what's outside any document.

## Develop

```bash
pnpm install
pnpm build      # one-off build
pnpm dev        # rebuild on change
pnpm sync       # build + pushwork sync (requires a pushwork doc)
```
