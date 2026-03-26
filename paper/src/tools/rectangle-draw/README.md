---
name: paper-rectangle-draw
description: >-
  Draw rectangles on the Paper canvas by drag; creates `rectangle` shapes in
  `PaperDoc.shapes` with default fill/stroke.
tool_id: paper-rectangle-draw
plugin_type: patchwork:tool
entry: ./index.tsx
output_shape_type: rectangle
---

# Rectangle draw

Patchwork tool plugins: **`paper-rectangle-draw`** (draw layer) and **`paper-rectangle-draw-button`** (toolbar).

**Use:** Activate the rectangle tool, press on the canvas, and drag to size. A new shape is created on pointer down and updated until pointer up.

**Data:** Each shape is `{ type: 'rectangle', x, y, w, h, fill, stroke, strokeWidth, zIndex, id }`.
