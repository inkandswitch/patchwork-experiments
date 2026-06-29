import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "unit-converter",
    name: "Unit Converter",
    icon: "Ruler",
    supportedDatatypes: ["unit-converter"],
    async load() {
      const { UnitConverterTool } = await import("./tool");
      return UnitConverterTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "unit-converter",
    name: "Unit Converter",
    icon: "Ruler",
    async load() {
      const { UnitConverterDatatype } = await import("./datatype");
      return UnitConverterDatatype;
    },
  },
];
