import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Unit Converter is a `patchwork:component`, not a tool+datatype: it has no
// state of its own, so it ships as a handle-less view (./component) that the
// canvas embeds directly by url.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "unit-converter",
    name: "Unit Converter",
    icon: "Ruler",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
];
