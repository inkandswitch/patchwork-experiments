import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Place Finder feature is a `patchwork:component`, not a tool+datatype: it
// has no state of its own, so it ships as a handle-less view (./component) that
// the canvas embeds directly by url. Registering it here keeps the package a
// valid patchwork module and makes the component discoverable by id.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "poi",
    name: "Place Finder",
    icon: "MapPin",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
];
