import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "poi-provider",
    name: "Place Finder",
    icon: "MapPin",
    supportedDatatypes: ["poi-provider"],
    async load() {
      const { PoiProviderTool } = await import("./PoiProvider");
      return PoiProviderTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "poi-provider",
    name: "Place Finder",
    icon: "MapPin",
    async load() {
      const { PoiProviderDatatype } = await import("./datatype");
      return PoiProviderDatatype;
    },
  },
];
