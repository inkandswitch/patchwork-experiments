import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. Plugin discovery imports this module inside a
// Web Worker, which has no importmap — so this file must contain only plugin
// metadata and lazy `load()`s: no runtime import of any bare specifier (the
// channel re-exports in ./index pull in solid-js at the top level via
// @embark/context).
export const plugins: Plugin<any>[] = [
  {
    type: "embark:context-view",
    id: "doc-url-context-view",
    name: "Document token context view",
    supports: ["doc-url"],
    async load() {
      const { docUrlView } = await import("./views");
      return docUrlView;
    },
  },
];
