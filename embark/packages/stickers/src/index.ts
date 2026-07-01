import type { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as timerPlugins } from "./timer";

// The sticker renderer codemirror extension is no longer registered globally (it
// used to load into every markdown editor). It now ships as a factory the
// Stickers card publishes into the canvas `CodemirrorExtensions` channel while
// present (see @embark/stickers-card and @embark/codemirror-extensions-host).
// This package still registers the timer widget a `tool` sticker embeds, and
// exports the renderer factory for the card.
export const plugins: Plugin<any>[] = [...timerPlugins];

export { stickerRenderer } from "./renderer";
