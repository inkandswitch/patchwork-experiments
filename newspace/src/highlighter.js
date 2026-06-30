// A highlighter, defined as a `newspace:brush` plugin (a separate export the
// host registers into the `newspace:brush` registry). newspace reads the
// registry, lists brushes in the shape overflow, and — when one is active —
// draws freehand strokes using the brush's `stroke` config.
//
// The brush MODULE (what `load()` resolves to) describes how its strokes look:
//   id, name, icon, stroke: { size, opacity, blend, thinning }
// A fat, translucent, multiply-blended, untapered stroke reads as a highlighter.
import { paramsSchema } from "./ops.js";

export const HighlighterBrush = {
  id: "highlighter",
  name: "Highlighter",
  icon: "Highlighter",
  // little line icon for the toolbar (drawn as an SVG path, like the other tools)
  iconPath: "M4 17l8-8 4 4-8 8H4v-4z M14 7l3-3 3 3-3 3z M3 21h7",
  stroke: { size: 22, opacity: 0.38, blend: "multiply", thinning: 0, smoothing: 0.6, streamline: 0.5 },
  // editable params as a real schema (validation + the panel rows in one)
  schema: paramsSchema([
    { key: "color", label: "Colour", type: "color" },
    { key: "size", label: "Size", type: "size", default: 22 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05, default: 0.38 },
  ]),
};

export const highlighterPlugin = {
  type: "newspace:brush",
  id: "highlighter",
  name: "Highlighter",
  icon: "Highlighter",
  async load() {
    return HighlighterBrush;
  },
};
