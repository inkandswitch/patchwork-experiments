import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The card package registers the *only* card datatype + tool pair. Every card
// feature ships as a `card.js` behavior module loaded by the generic card tool
// (see ./CardTool); features no longer register a datatype/tool of their own.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "card",
    name: "Card",
    icon: "SquareStack",
    async load() {
      const { CardDatatype } = await import("./datatype");
      return CardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "card",
    name: "Card",
    icon: "SquareStack",
    supportedDatatypes: ["card"],
    async load() {
      const { CardTool } = await import("./CardTool");
      return CardTool;
    },
  },
];

export type { CardDoc } from "./datatype";
export type { CardModule } from "./CardTool";
