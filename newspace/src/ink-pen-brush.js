// An ink pen, defined as a `sketchy:brush` plugin (a separate export the host
// registers into the brush registry). The host reads the registry, lists
// brushes in the shape overflow, and — when one is active — draws freehand
// strokes (perfect-freehand) using the brush's `stroke` config.
//
// The brush MODULE (what `load()` resolves to) describes how its strokes look:
//   id, name, icon, stroke: { size, opacity, blend, thinning, smoothing, streamline }
// A thin, opaque, strongly-thinned (pressure-tapered) stroke reads as a crisp
// ink pen with sharp tails on its strokes.

import { paramsSchema } from "./ops.js";

export const InkPenBrush = {
  id: "ink-pen",
  name: "Ink pen",
  icon: "Feather",
  // little line icon for the toolbar (drawn as an SVG path, like the other
  // tools) — a hand-drawn quill/feather nib in a ~0..22 box
  iconPath: "M19 4c-7 1-11 5-13 11l-2 3 3-2c6-2 10-6 11-13z M14 9l-7 7 M4 20l4-4",
  stroke: { size: 4, opacity: 1, blend: "normal", thinning: 0.7, smoothing: 0.6, streamline: 0.55 },
  // editable params as a real schema (validation + the panel rows in one)
  schema: paramsSchema([
    { key: "color", label: "Colour", type: "color" },
    { key: "size", label: "Size", type: "size", default: 4 },
    { key: "thinning", label: "Thinning", type: "slider", min: -1, max: 1, step: 0.1, default: 0.7 },
  ]),
};

export const inkPenPlugin = {
  type: "sketchy:brush",
  id: "ink-pen",
  name: "Ink pen",
  icon: "Feather",
  async load() {
    return InkPenBrush;
  },
};
