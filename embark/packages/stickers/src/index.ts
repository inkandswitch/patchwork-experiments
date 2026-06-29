import type { Extension } from "@codemirror/state";
import type { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as timerPlugins } from "./timer";

// The sticker system: a CodeMirror renderer (loaded into every markdown editor)
// that draws stickers targeting the doc, plus the timer widget a `tool` sticker
// embeds. The sticker *sources* (unit/currency/timer scanners) now live as
// standalone `patchwork:component` packages; this package ships the renderer and
// the timer widget.
export const plugins: Plugin<any>[] = [
  {
    type: "codemirror:extension",
    id: "embark-stickers",
    name: "Embark stickers",
    supportedDatatypes: ["markdown", "essay"],
    async load(): Promise<Extension> {
      const { stickerRenderer } = await import("./renderer");
      return stickerRenderer();
    },
  },
  ...timerPlugins,
];
