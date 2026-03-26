---
name: paper-text-place
description: >-
  Place empty text shapes on the canvas with a click; creates `text` shapes in
  `PaperDoc.shapes` for inline editing elsewhere.
tool_id: paper-text-place
plugin_type: patchwork:tool
entry: ./index.tsx
output_shape_type: text
unlisted: true
---

# Text place

Patchwork registers one plugin **`paper-text-place`** (`unlisted: true`, tag `paper-tool-button`)—no separate canvas-layer id.

**Use:** Activate the text tool and click the canvas. A new `{ type: 'text', ... }` shape is inserted at the click position with empty `text` and a `zIndex`.

**Data:** Shape rendering/editing lives under `src/shapes/text/`.
