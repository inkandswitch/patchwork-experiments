# Folder Tree View

A Patchwork tool that renders a folder document as a filterable, navigable
tree. It is the tree viewer extracted from the
[`sideboard`](../../patchwork-base/sideboard) tool, with the surrounding
account chrome left behind.

## What it does

- **Filter** documents by title (space-separated terms, all must match).
  Matching folders auto-expand.
- **Expandable folder tree** rendered recursively, with circular-reference
  protection.
- **Click to open** — clicking an entry dispatches a bubbling
  `patchwork:open-document` event for the host frame to handle.
- **Context menu** per item: *Open with…* (any compatible tool), *Copy*
  (Automerge / Patchwork URL, optionally with a tool), *Rename*, *Remove*.
- **Drag and drop** to reorder, move items between folders (Alt to copy),
  and drop OS files into folders.
- **Inline rename** (folders rename via their `title`, links via their
  `name`, and the underlying document's title is updated when a datatype
  exposes `setTitle`).

## What was left behind

The "create new", sharing/keyhive (secure copy, share modal), the account
footer (contact, packages, settings), and the sidebar close button from the
sideboard are intentionally not included.

## Datatypes

Mounted on a `folder` document it renders that folder. Mounted on an
`account` document it follows `rootFolderUrl`. (`selectedDocUrls` is currently
always empty — wire it up if you want the host to highlight the active doc.)

## Develop

```bash
pnpm install
pnpm build      # one-off build
pnpm dev        # rebuild on change
pnpm sync       # build + pushwork sync (requires a pushwork doc)
```
