import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Routes package ships four plugins: the handle-less `route` component (the
// feature card + `/Drive` `/Walk` `/Transit` command contributors the canvas
// embeds by url), the `route-card` datatype it mints for each trip, a board tool
// that renders a route-card full-size, and a `"token"`-tagged tool that paints
// the compact inline chip used wherever a route-card is embedded in text.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "route",
    name: "Routes",
    icon: "Route",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
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
