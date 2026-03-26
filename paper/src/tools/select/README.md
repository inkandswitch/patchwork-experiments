---
name: paper-select
description: >-
  Selection and move tool for the Paper canvas: marquee-select shapes, drag
  selection, and per-user highlight via `userState[contactUrl].selection`.
tool_id: paper-select
plugin_type: patchwork:tool
entry: ./index.tsx
---

# Select

Patchwork tool plugins: **`paper-select`** (canvas layer) and **`paper-select-button`** (toolbar). Activation is stored per collaborator in `PaperDoc.userState[contactUrl].selectedTool`.

**Use:** Choose the pointer tool in the toolbar, then click shapes or drag a marquee on empty canvas to select. Drag selected shapes to move them. Works with `paper:pointerdown` / move / up events on the viewport.

**Related:** Shape DOM nodes use `data-shape-id` for hit-testing and filter styling.
