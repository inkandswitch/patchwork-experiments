import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Bird Sightings package ships the `bird-card` datatype it mints per
// species, a board tool that renders a bird-card full-size (also used in the
// map's hover popup), and a `"token"`-tagged tool that paints the compact inline
// chip used wherever a bird-card is embedded in text. The finder card itself is
// no longer a datatype/tool: it is a `card` document whose behavior module
// (./card) the shared card shell loads.
export const plugins: Plugin<any>[] = [
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
