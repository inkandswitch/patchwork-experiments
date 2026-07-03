import type { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as timerPlugins } from "./timer";

// The sticker renderer codemirror extension is no longer registered globally (it
// used to load into every markdown editor). It now ships as a factory the
// Stickers card publishes into the canvas `CodemirrorExtensions` channel while
// present (see @embark/stickers-card and @embark/codemirror-extensions-host).
// This package still registers the timer widget a `tool` sticker embeds, a
// context visualizer for the `stickers` channel, and exports the renderer
// factory for the card.
export const plugins: Plugin<any>[] = [
  ...timerPlugins,
  {
    type: "embark:context-visualizer",
    id: "stickers-context-visualizer",
    name: "Stickers context visualizer",
    channels: ["stickers"],
    async load() {
      const { stickersVisualizer } = await import("./visualizer");
      return stickersVisualizer;
    },
  },
];

export { stickerRenderer } from "./renderer";

// The sticker vocabulary, the shared `Stickers` context channel, and the
// scanning engine that example sources (unit/metric/currency converters, timer,
// schedule) build on. Absorbed from the old @embark/core "kitchen sink".
export * from "./sticker";
export * from "./channels";
export * from "./source-lib";
