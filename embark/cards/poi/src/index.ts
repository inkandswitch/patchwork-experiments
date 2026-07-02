import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Place Finder package ships five plugins: the `place-finder` datatype +
// tool pair (the feature card + search contributor, a document-backed view so
// the card has a stable url), the `poi-card` datatype it mints for each found
// place, a board tool that renders a poi-card full-size, and a `"token"`-tagged
// tool that paints the compact inline chip used wherever a poi-card is embedded
// in text.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "place-finder",
    name: "Place Finder",
    icon: "MapPin",
    supportedDatatypes: ["place-finder"],
    async load() {
      const { PlaceFinderTool } = await import("./PoiProvider");
      return PlaceFinderTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "place-finder",
    name: "Place Finder",
    icon: "MapPin",
    async load() {
      const { PlaceFinderDatatype } = await import("./datatype");
      return PlaceFinderDatatype;
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
