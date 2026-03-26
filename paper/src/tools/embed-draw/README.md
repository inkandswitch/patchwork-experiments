---
name: paper-embed-draw
description: >-
  Place embed frames on the canvas: pick a Patchwork datatype, drag a rectangle,
  then create a new doc of that type and wire it into an `embed` shape.
tool_id: paper-embed-draw
plugin_type: patchwork:tool
entry: ./index.tsx
output_shape_type: embed
---

# Embed draw

Patchwork tool plugins: **`paper-embed-draw`** (draw layer) and **`paper-embed-draw-button`** (toolbar).

**Use:** Activating the tool opens a datatype menu (registered `patchwork:datatype` entries, excluding `unlisted`). After choosing a datatype, drag on the canvas to define frame size. Tiny drags cancel the shape; successful placement switches back to **`paper-select`**.

**Data:** Creates `{ type: 'embed', docType, toolId, width, height, ... }` and uses `createDocOfDatatype2` plus the plugin registry. Menu UI: `src/shapes/embed/menu.ts`; embed rendering: `src/shapes/embed/`.
