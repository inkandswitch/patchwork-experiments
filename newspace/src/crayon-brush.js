// A waxy crayon, defined as a `sketchy:brush` plugin (a separate export the
// host registers into the brush registry). The freehand renderer draws strokes
// using the brush's `stroke` config (perfect-freehand).
//
// The brush MODULE (what `load()` resolves to) describes how its strokes look:
//   id, name, icon, stroke: { size, opacity, blend, thinning, smoothing, streamline }
// A chunky, slightly-translucent, multiply-blended stroke with gentle pressure
// taper reads as a waxy crayon laid down on textured paper.

import { paramsSchema } from "./ops.js";

export const CrayonBrush = {
  id: "crayon",
  name: "Crayon",
  icon: "Pencil",
  // hand-drawn crayon icon (a tapered barrel with a pointed tip), in a ~0..22 box
  iconPath: "M3 19l4 1 11-11-5-5L2 15l1 4z M14 4l5 5 2-2a2 2 0 0 0 0-3l-2-2a2 2 0 0 0-3 0l-2 2z M3 19l3-1",
  stroke: { size: 12, opacity: 0.85, blend: "multiply", thinning: 0.2, smoothing: 0.3, streamline: 0.3 },
  // editable params as a real schema (validation + the panel rows in one)
  schema: paramsSchema([
    { key: "color", label: "Colour", type: "color" },
    { key: "size", label: "Size", type: "size", default: 12 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05, default: 0.85 },
  ]),
};

export const plugin = {
  type: "sketchy:brush",
  id: "crayon",
  name: "Crayon",
  icon: "Pencil",
  async load() {
    return CrayonBrush;
  },
};
