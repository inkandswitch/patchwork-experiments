import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Metric Converter is a `patchwork:component`, not a tool+datatype: it has
// no state of its own, so it ships as a handle-less view (./component) that the
// canvas embeds directly by url. It's the mirror of the Unit Converter (metric →
// imperial) and is a fully standalone card — it shares no scanning code with it.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "metric-converter",
    name: "Metric Converter",
    icon: "Ruler",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
];
