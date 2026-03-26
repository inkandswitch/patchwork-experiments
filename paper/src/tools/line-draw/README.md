---
name: paper-line-draw
description: >-
  Draw polylines on the Paper canvas by drag; creates `line` shapes with
  relative `points` in document space.
tool_id: paper-line-draw
plugin_type: patchwork:tool
entry: ./index.tsx
output_shape_type: line
---

# Line draw

Patchwork tool plugins: **`paper-line-draw`** (draw layer) and **`paper-line-draw-button`** (toolbar).

**Use:** Activate the line tool, press on the canvas, and drag. The line grows from the start point; geometry is stored as local `points` with shape `x`,`y` as origin.

**Data:** Each shape is `{ type: 'line', x, y, points, stroke, strokeWidth, zIndex, id }`.
