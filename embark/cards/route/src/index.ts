import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Routes package ships the `route-card` datatype it mints for each trip, a
// board tool that renders a route-card full-size, and a `"token"`-tagged tool
// that paints the compact inline chip used wherever a route-card is embedded in
// text. The Routes card itself (the `/Drive` `/Walk` `/Transit` command
// contributors) is no longer a component: it is a `card` document whose behavior
// module (./card) the shared card shell loads.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "route-card",
    name: "Route",
    icon: "Route",
    async load() {
      const { RouteCardDatatype } = await import("./datatype");
      return RouteCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "route-card",
    name: "Route",
    icon: "Route",
    supportedDatatypes: ["route-card"],
    async load() {
      const { RouteCardView } = await import("./RouteCardView");
      return RouteCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "route-card-token",
    name: "Route token",
    icon: "Route",
    supportedDatatypes: ["route-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { RouteCardToken } = await import("./token");
      return RouteCardToken;
    },
  },
];
