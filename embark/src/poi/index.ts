import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "poi-provider",
    name: "POI Provider",
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
    name: "POI Provider",
    icon: "MapPin",
    async load() {
      const { PoiProviderDatatype } = await import("./datatype");
      return PoiProviderDatatype;
    },
  },
  {
    type: "patchwork:datatype",
    id: "poi-result",
    name: "POI Result",
    icon: "MapPin",
    async load() {
      const { PoiResultDatatype } = await import("./datatype");
      return PoiResultDatatype;
    },
  },
];
