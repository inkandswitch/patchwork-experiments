import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Bird Sightings package ships five plugins: the `bird-sighting` datatype +
// tool pair (the finder card that watches an open map and queries eBird — a
// document-backed view so the card has a stable url), the `bird-card` datatype
// it mints per species, a board tool that renders a bird-card full-size (also
// used in the map's hover popup), and a `"token"`-tagged tool that paints the
// compact inline chip used wherever a bird-card is embedded in text.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "bird-sighting",
    name: "Bird Sightings",
    icon: "Bird",
    supportedDatatypes: ["bird-sighting"],
    async load() {
      const { BirdSightingTool } = await import("./BirdSightingProvider");
      return BirdSightingTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "bird-sighting",
    name: "Bird Sightings",
    icon: "Bird",
    async load() {
      const { BirdSightingDatatype } = await import("./datatype");
      return BirdSightingDatatype;
    },
  },
  {
    type: "patchwork:datatype",
    id: "bird-card",
    name: "Bird",
    icon: "Bird",
    async load() {
      const { BirdCardDatatype } = await import("./datatype");
      return BirdCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "bird-card",
    name: "Bird",
    icon: "Bird",
    supportedDatatypes: ["bird-card"],
    async load() {
      const { BirdCardView } = await import("./BirdCardView");
      return BirdCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "bird-card-token",
    name: "Bird token",
    icon: "Bird",
    supportedDatatypes: ["bird-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { BirdCardToken } = await import("./token");
      return BirdCardToken;
    },
  },
];
