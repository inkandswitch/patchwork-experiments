import { plugins as canvasPlugins } from "./canvas";
import { plugins as searchPlugins } from "./search";
import { plugins as poiPlugins } from "./poi";

export const plugins = [...canvasPlugins, ...searchPlugins, ...poiPlugins];
