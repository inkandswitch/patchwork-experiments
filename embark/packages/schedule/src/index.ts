import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Schedule card is a `patchwork:component`, not a tool+datatype: it has no
// state of its own, so it ships as a handle-less view (./component) that the
// canvas embeds directly by url — same shape as the unit/currency converters.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "schedule",
    name: "Schedule",
    icon: "Clock",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
];
