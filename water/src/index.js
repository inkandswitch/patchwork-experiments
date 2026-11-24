// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Water is a scene extension (see the scene package's API.md, "Ambients"
// and "Water", and WATER.md, "Water bodies"): water is a shape, an object
// with the `water` trait. Without a size it is open water, everything below
// its origin: weather, so only the outermost doc's counts, offered as the
// world's `water` ambient. With a size it is a box hanging from its origin:
// a thing, which counts for its own doc wherever that doc is placed and is
// never offered. Open water may carry a clip: the box it keeps, as its doc's
// own, where the world it is placed in offers no open water. What floats asks the extension which water it is in. What
// makes waves (sailing's sea) and a current (`water.current`, here) are
// behaviours put on the shape. Parts: open water, and a pond.

export const plugins = [
  {
    type: "scene:extension",
    id: "water",
    name: "Water",
    traits: ["water", "water.current"],
    describes: {
      water: {
        name: "Water",
        on: "object",
        blurb: "This object is water, its origin the surface at rest. Three ways to say it: open (no size, no clip): my sea, unless the world has one; open with a clip: my sea, or this much of it, a box at this object's place kept where the world it is placed in has no open water; a box (a size): this water, always, its doc's own wherever the doc is placed. Its waves come from whatever makes them (a sea). A doc meant to be placed on a deck is best without a clip. While it is selected, its box is outlined",
        fields: [
          { key: "size", label: "Size (m: [width, depth, length]; empty: open water)", kind: "json" },
          { key: "clip", label: "Clip: keep this much where the world has no water (m: [width, depth, length]; empty: none; open water only)", kind: "json" },
        ],
        init: {},
      },
      "water.current": {
        name: "Current",
        on: "object",
        blurb: "The water drifts: a tidal stream, or a river on a box of water. What floats in it drifts with it, and its waves are carried along",
        fields: [
          { key: "speed", label: "Speed (m/s)", kind: "number", default: 0.5, min: 0, step: 0.05 },
          { key: "toward", label: "Toward (degrees from north)", kind: "number", default: 0, step: 1 },
        ],
        init: { speed: 0.5, toward: 0 },
      },
    },
    async load() {
      return (await import("./extension.js")).default;
    },
  },
  ...[
    { id: "open", name: "Water", icon: "Waves", description: "Open water, as far as the eye can see, its surface where it's put. A world linked into another floats on that world's instead. Put a sea on it for waves", traits: ["water"] },
    { id: "pond", name: "Pond", icon: "Droplets", description: "A box of water, 10 m across and 1.5 m deep, its surface where it's put: its scene's own wherever that scene is placed. Resize it in the inspector", traits: ["water"] },
  ].map(({ id, ...p }) => ({
    type: "scene:part",
    id: `water.${id}`,
    category: "Water",
    ...p,
    async load() {
      return (await import("./parts.js"))[id];
    },
  })),
];
