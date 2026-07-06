import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. Plugin discovery imports this module inside a
// Web Worker, which has no importmap — so this file must contain only plugin
// metadata and lazy `load()`s: no runtime import of any bare specifier (and
// none of the library re-exports in ./index, which pull in automerge-repo and
// solid-js at the top level).
export const plugins: Plugin<any>[] = [
  {
    type: "embark:context-view",
    id: "json-schema-context-view",
    name: "JSON Schema context view",
    supports: ["json-schema"],
    async load() {
      const { jsonSchemaView } = await import("./views");
      return jsonSchemaView;
    },
  },
];
