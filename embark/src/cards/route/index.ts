import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "route-provider",
    name: "Routes",
    icon: "Route",
    supportedDatatypes: ["route-provider"],
    async load() {
      const { RouteProviderTool } = await import("./RouteProvider");
      return RouteProviderTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "route-provider",
    name: "Routes",
    icon: "Route",
    async load() {
      const { RouteProviderDatatype } = await import("./datatype");
      return RouteProviderDatatype;
    },
  },
];
