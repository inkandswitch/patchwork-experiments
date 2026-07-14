import type { Extension } from "@codemirror/state";
import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. Plugin discovery imports this module inside a
// Web Worker, which has no importmap — so this file must contain only plugin
// metadata and lazy `load()`s: no runtime import of any bare specifier (the
// `CodemirrorExtensions` re-export in ./index pulls in solid-js at the top
// level via @embark/context).
export const plugins: Plugin<any>[] = [
  {
    type: "codemirror:extension",
    id: "embark-codemirror-extensions-host",
    name: "Embark codemirror extensions host",
    supportedDatatypes: ["markdown", "essay"],
    async load(): Promise<Extension> {
      const { codemirrorExtensionsHost } = await import("./host");
      return codemirrorExtensionsHost();
    },
  },
  {
    type: "embark:context-view",
    id: "codemirror-extension-context-view",
    name: "CodeMirror extension context view",
    supports: ["codemirror-extension"],
    async load() {
      const { codemirrorExtensionView } = await import("./views");
      return codemirrorExtensionView;
    },
  },
];
