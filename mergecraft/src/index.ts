import type { Plugin, Tool, Datatype } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "mergecraft",
    name: "Mergecraft",
    icon: "Glasses",
    async load() {
      const { MergecraftDatatype } = await import("./datatype");
      return MergecraftDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "mergecraft",
    name: "Mergecraft",
    icon: "Glasses",
    supportedDatatypes: ["mergecraft"],
    async load() {
      const { MergecraftTool } = await import("./tool");
      return MergecraftTool;
    },
  } satisfies Tool,
];
