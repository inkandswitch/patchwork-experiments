// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tts-import",
    name: "Tabletop Simulator import",
    icon: "PackageOpen",
    async load() {
      return (await import("./datatype.js")).TtsImportDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tts-import",
    name: "Tabletop Simulator import",
    icon: "PackageOpen",
    supportedDatatypes: ["tts-import"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
];
