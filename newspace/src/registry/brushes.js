import { plugin as shareTrayPlugin } from "../share-tray.js";
import { markerPlugin } from "../marker-brush.js";
import { inkPenPlugin } from "../ink-pen-brush.js";
import { plugin as crayonPlugin } from "../crayon-brush.js";
import { plugin as charcoalPlugin } from "../charcoal-brush.js";

export const coreBrushPlugins = [
  {
    type: "sketchy:brush",
    id: "highlighter",
    name: "Highlighter",
    icon: "Highlighter",
    async load() {
      return (await import("../highlighter.js")).HighlighterBrush;
    },
  },
  {
    type: "sketchy:brush",
    id: "constraint",
    name: "Constraint sketch",
    icon: "Ruler",
    async load() {
      return (await import("../constraint.js")).ConstraintBrush;
    },
  },
  {
    type: "sketchy:brush",
    id: "voice",
    name: "Voice note",
    icon: "Mic",
    async load() {
      return (await import("../voice.js")).VoiceBrush;
    },
  },
];

export const contributedBrushPlugins = [
  shareTrayPlugin,
  markerPlugin,
  inkPenPlugin,
  crayonPlugin,
  charcoalPlugin,
];
