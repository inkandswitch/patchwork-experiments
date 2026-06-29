import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Timer source is a `patchwork:component`, not a tool+datatype: it has no
// state of its own, so it ships as a handle-less view (./component) that the
// canvas embeds directly by url.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "timer-source",
    name: "Timer",
    icon: "Timer",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
];
