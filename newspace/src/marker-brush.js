// A felt-tip marker, defined as a `sketchy:brush` plugin (a separate export the
// host registers into the brush registry). The host reads the registry, lists
// brushes in the shape overflow, and — when one is active — draws freehand
// strokes using the brush's `stroke` config (perfect-freehand).
//
// The brush MODULE (what `load()` resolves to) describes how its strokes look:
//   id, name, icon, stroke: { size, opacity, blend, thinning, smoothing, streamline }
// A fat, fully-opaque, uniform-width stroke reads as a felt marker — no pressure
// taper (thinning ~0), just a confident solid band of ink.
import { paramsSchema } from "./ops.js";

export const MarkerBrush = {
  id: "marker",
  name: "Marker",
  icon: "PenLine",
  // little hand-drawn marker icon for the toolbar (SVG path in a ~0..22 box)
  iconPath: "M14 3l5 5-9 9-5 1 1-5 8-9z M12 5l5 5 M5 21h14",
  stroke: { size: 10, opacity: 1, blend: "normal", thinning: 0, smoothing: 0.5, streamline: 0.4 },
  // editable params declared as a REAL schema (validation + the panel rows in ONE source):
  // the panel reads `schema.fields`, param resolution reads `schema.defaults`.
  schema: paramsSchema([
    { key: "color", label: "Colour", type: "color" },
    { key: "size", label: "Size", type: "size", default: 10 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05, default: 1 },
    { key: "blend", label: "Blend", type: "select", default: "normal", options: [
      { value: "normal", label: "Normal" },
      { value: "multiply", label: "Multiply" },
    ] },
  ]),
};

export const markerPlugin = {
  type: "sketchy:brush",
  id: "marker",
  name: "Marker",
  icon: "PenLine",
  async load() {
    return MarkerBrush;
  },
};
