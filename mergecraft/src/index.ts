import type { Plugin } from "@patchwork/sdk";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:dataType",
    id: "mergecraft",
    name: "Mergecraft",
    icon: "Glasses",
    async load() {
      const { dataType } = await import("./datatype");
      return dataType;
    },
  },
  {
    id: "mergecraft",
    type: "patchwork:tool",
    supportedDataTypes: ["mergecraft"],
    name: "Mergecraft",
    icon: "Glasses",
    async load() {
      const { tool } = await import("./tool");
      return tool;
    },
  },
];
