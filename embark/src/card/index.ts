import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "card",
    name: "Card",
    icon: "Square",
    async load() {
      const { CardDatatype } = await import("./datatype");
      return CardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "card",
    name: "Card",
    icon: "Square",
    supportedDatatypes: ["card"],
    async load() {
      const { CardTool } = await import("./CardTool");
      return CardTool;
    },
  },
];
