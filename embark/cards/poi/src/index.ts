import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Place Finder package ships the `poi-card` datatype it mints for each
// found place, a board tool that renders a poi-card full-size, and a
// `"token"`-tagged tool that paints the compact inline chip used wherever a
// poi-card is embedded in text. The Place Finder card itself is no longer a
// datatype/tool: it is a `card` document whose behavior module (./card) the
// shared card shell loads.
export const plugins: Plugin<any>[] = [
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
