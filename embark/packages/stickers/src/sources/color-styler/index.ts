import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "color-styler",
    name: "Color Styler",
    icon: "Palette",
    supportedDatatypes: ["color-styler"],
    async load() {
      const { ColorStylerTool } = await import("./tool");
      return ColorStylerTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "color-styler",
    name: "Color Styler",
    icon: "Palette",
    async load() {
      const { ColorStylerDatatype } = await import("./datatype");
      return ColorStylerDatatype;
    },
  },
];
