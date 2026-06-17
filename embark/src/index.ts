import { plugins as canvasPlugins } from "./canvas";
import { plugins as partsBinPlugins } from "./canvas/parts-bin";
import { plugins as searchPlugins } from "./search";
import { plugins as poiPlugins } from "./poi";
import { plugins as mentionPlugins } from "./mention";

export const plugins = [
  ...canvasPlugins,
  ...partsBinPlugins,
  ...searchPlugins,
  ...poiPlugins,
  ...mentionPlugins,
];
