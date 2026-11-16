// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Water is a scene extension (see the scene package's STAGE.md, "Ambients"
// and "Water", and WATER.md, "Water bodies"): water is a shape, an object
// with the `water` trait. Without a size it is open water, everything below
// its origin: weather, offered as the `water` ambient, so a doc floats on the
// open water of the outermost doc on its path that has some (its own where
// no host offers any). With a size it is a box hanging from its origin:
// a thing, which counts for its own doc wherever that doc is placed and is
// never offered. What floats asks the extension which water it is in. What
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
        blurb: "This object is water, its origin the surface at rest. With a size (width, depth, length) it is a box hanging from its origin, its doc's own wherever the doc is placed; without one it is open water below its origin, and a world linked into another that has open water floats on that water instead (in a host with none, it keeps its own). Its waves come from whatever makes them (a sea)",
        fields: [{ key: "size", label: "Size (m: [width, depth, length]; empty: open water)", kind: "json" }],
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
