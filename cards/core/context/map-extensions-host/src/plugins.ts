import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. Plugin discovery imports this module inside a
// Web Worker, which has no importmap — so this file must contain only plugin
// metadata and lazy `load()`s. The host itself registers nothing: the map tool
// imports and installs it directly (there is exactly one map tool, so no
// per-editor plugin discovery is needed) — only the context view for the
// channel's opaque values is registered here.
export const plugins: Plugin<any>[] = [
  {
    type: "embark:context-view",
    id: "map-extension-context-view",
    name: "Map extension context view",
    supports: ["map-extension"],
    async load() {
      const { mapExtensionView } = await import("./views");
      return mapExtensionView;
    },
  },
];
