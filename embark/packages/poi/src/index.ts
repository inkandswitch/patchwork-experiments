import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Place Finder package ships four plugins: the handle-less `poi` component
// (the feature card + search contributor the canvas embeds by url), the
// `poi-card` datatype it mints for each found place, a board tool that renders a
// poi-card full-size, and a `"token"`-tagged tool that paints the compact inline
// chip used wherever a poi-card is embedded in text.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "poi",
    name: "Place Finder",
    icon: "MapPin",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
  {
    type: "patchwork:datatype",
    id: "poi-card",
    name: "Place",
    icon: "MapPin",
    async load() {
      const { PoiCardDatatype } = await import("./datatype");
      return PoiCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "poi-card",
    name: "Place",
    icon: "MapPin",
    supportedDatatypes: ["poi-card"],
    async load() {
      const { PoiCardView } = await import("./PoiCardView");
      return PoiCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "poi-card-token",
    name: "Place token",
    icon: "MapPin",
    supportedDatatypes: ["poi-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { PoiCardToken } = await import("./token");
      return PoiCardToken;
    },
  },
];
