import { plugins as canvasPlugins } from "./canvas";
import { plugins as partsBinPlugins } from "./canvas/parts-bin";
import { plugins as searchPlugins } from "./search";
import { plugins as poiPlugins } from "./poi";
import { plugins as cardPlugins } from "./card";
import { plugins as mapPlugins } from "./map";
import { plugins as mentionPlugins } from "./mention";
import { plugins as stickerPlugins } from "./stickers";

export const plugins = [
  ...canvasPlugins,
  ...partsBinPlugins,
  ...searchPlugins,
  ...poiPlugins,
  ...cardPlugins,
  ...mapPlugins,
  ...mentionPlugins,
  ...stickerPlugins,
];
