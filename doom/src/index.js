// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Doom-format maps in a scene (README.md):
// - scene:source "doom-map": a part of a map in a .wad file doc, as a GLB
//   (source.js). A map is a static part and a part per door, each one
//   object, each the same file doc.
// - scene:extension "doom": lays out a dropped .wad file doc's first map as
//   those objects (layout.js). It has no traits and never runs: it is here
//   for its drop.

export const plugins = [
  {
    type: "scene:source",
    id: "doom-map",
    name: "Doom map",
    icon: "Map",
    supportedDatatypes: ["file"],
    extensions: ["wad"],
    params: [
      // the map's name ("E1M1", "MAP01"): there is no default map, so a render doc names one
      { key: "map", label: "Map", kind: "string", default: "" },
      // which part: a door, by its sector; none, the static part (parts.js)
      { key: "door", label: "Door (sector)", kind: "integer", default: null, min: 0 },
    ],
    cost: "expensive",
    version: 2,
    async load() {
      return (await import("./source.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "doom",
    name: "Doom maps",
    general: false,
    drops: ["file"],
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
