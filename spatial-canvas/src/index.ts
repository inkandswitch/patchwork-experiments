import { rectanglePlugins } from "./rectangle/rectangle.js";
import { penPlugins } from "./pen/plugins.js";
import { textPlugins } from "./text/plugins.js";
import { embedPlugins } from "./embed/plugins.js";
import { selectPlugins } from "./select/plugins.js";
import { deletePlugins } from "./delete/plugins.js";
import { resizePlugins } from "./resize/plugins.js";
import { dropPlugins } from "./drop/plugins.js";
import { canvasPlugins } from "./canvas/index.js";
import { propertiesPlugins } from "./properties/plugins.js";
import { buildPlugins } from "./build/plugins.js";
import { toolbarPlugins } from "./toolbar/plugins.js";
import { keyboardPlugins } from "./keyboard/plugins.js";

export type { CanvasDoc, CanvasShape } from "./canvas/index.js";

export const plugins = [
  ...canvasPlugins,
  ...rectanglePlugins,
  ...penPlugins,
  ...textPlugins,
  ...embedPlugins,
  ...selectPlugins,
  ...deletePlugins,
  ...resizePlugins,
  ...dropPlugins,
  ...propertiesPlugins,
  ...buildPlugins,
  ...toolbarPlugins,
  ...keyboardPlugins,
];
