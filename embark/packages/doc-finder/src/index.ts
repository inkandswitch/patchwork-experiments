import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "doc-finder-provider",
    name: "Mention Finder",
    icon: "AtSign",
    supportedDatatypes: ["doc-finder-provider"],
    async load() {
      const { DocFinderProviderTool } = await import("./DocFinderProvider");
      return DocFinderProviderTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "doc-finder-provider",
    name: "Mention Finder",
    icon: "AtSign",
    async load() {
      const { DocFinderProviderDatatype } = await import("./datatype");
      return DocFinderProviderDatatype;
    },
  },
];
