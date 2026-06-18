import type { Extension } from "@codemirror/state";
import type { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as colorStylerPlugins } from "./sources/color-styler";
import { plugins as unitConverterPlugins } from "./sources/unit-converter";
import { plugins as timerSourcePlugins } from "./sources/timer-source";
import { plugins as timerPlugins } from "./timer";

// The sticker system: a CodeMirror renderer (loaded into every markdown editor)
// that draws stickers targeting the doc, plus the example sources that publish
// them and the timer widget a `tool` sticker embeds.
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
  ...colorStylerPlugins,
  ...unitConverterPlugins,
  ...timerSourcePlugins,
  ...timerPlugins,
];
