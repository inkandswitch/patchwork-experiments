import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Stickers card: a document whose tool, while on a canvas, publishes the
// sticker renderer codemirror extension into the shared `CodemirrorExtensions`
// channel (see @embark/codemirror-extensions-host). Drop it on a canvas to draw
// stickers in every editor there; remove it to stop.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "stickers-card",
    name: "Stickers",
    icon: "Sticker",
    async load() {
      const { StickersCardDatatype } = await import("./datatype");
      return StickersCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "stickers-card",
    name: "Stickers",
    icon: "Sticker",
    supportedDatatypes: ["stickers-card"],
    async load() {
      const { StickersCardTool } = await import("./StickersCardTool");
      return StickersCardTool;
    },
  },
];
