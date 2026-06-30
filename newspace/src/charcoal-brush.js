// A charcoal stick, defined as a `sketchy:brush` plugin (a separate export the
// host registers into the brush registry). The renderer reads the MODULE's
// `stroke` config and draws freehand strokes (perfect-freehand) with it.
//
// Charcoal = a dark, rough, translucent mark. A moderately fat stroke with low
// opacity and a "darken" blend builds up where strokes overlap (like dragging a
// charcoal stick over tooth), with a touch of pressure thinning for tapered ends
// and just enough smoothing/streamline to keep the line gritty rather than slick.

import { paramsSchema } from "./ops.js";

export const CharcoalBrush = {
  id: "charcoal",
  name: "Charcoal",
  icon: "Brush",
  // hand-drawn charcoal stick in a ~0..22 box (a chunky angled bar with a worn tip)
  iconPath: "M5 19l3 1 10-12-4-4L4 16l1 3z M14 4l4 4 1-1a2 2 0 0 0-3-3l-2 0z M5 19l3-2",
  stroke: { size: 16, opacity: 0.55, blend: "darken", thinning: 0.35, smoothing: 0.2, streamline: 0.25 },
  // editable params as a real schema (validation + the panel rows in one)
  schema: paramsSchema([
    { key: "color", label: "Colour", type: "color" },
    { key: "size", label: "Size", type: "size", default: 16 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05, default: 0.55 },
  ]),
};

export const plugin = {
  type: "sketchy:brush",
  id: "charcoal",
  name: "Charcoal",
  icon: "Brush",
  async load() {
    return CharcoalBrush;
  },
};
