// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Doom-format maps in a scene (README.md):
// - scene:source "doom-map": a part of a map in a .wad file doc, as a GLB
//   (source.js). A map is a static part, a part per door and a part per exit
//   switch, each one object, each the same file doc; or, for something that
//   moves the doors itself, the whole map as one part with them as nodes.
// - scene:extension "doom": lays out a dropped .wad file doc's first map as
//   those objects (layout.js). Its trait, `doom.map`, is the marker that
//   layout writes on the map's static part: it says what the object is (the
//   inspector's Behaviours) and makes a scene with a map call for this
//   package, as any trait does. Running, it does nothing more.

export const plugins = [
  {
    type: "scene:source",
    id: "doom-map",
    content: "built",
    name: "Doom map",
    icon: "Map",
    supportedDatatypes: ["file"],
    extensions: ["wad"],
    params: [
      // the map's name ("E1M1", "MAP01"): there is no default map, so a render doc names one
      { key: "map", label: "Map", kind: "string", default: "" },
      // which part: a door, by its sector; an exit switch, by its line; neither, the static part (parts.js)
      { key: "door", label: "Door (sector)", kind: "integer", default: null, min: 0 },
      { key: "line", label: "Exit switch (line)", kind: "integer", default: null, min: 0 },
      // the whole map in one part, each door and exit switch a node in it, for something that moves the doors itself (a running game shown in it)
      { key: "whole", label: "Whole map (doors as nodes)", kind: "boolean", default: false },
    ],
    cost: "expensive",
    // 3: the static part leaves the exit switches out (each is a part of its own)
    // 4: every part's extras say where its frame is (doom: { map, anchor, unitsPerMetre }); `whole`
    version: 4,
    async load() {
      return (await import("./source.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "doom",
    name: "Doom maps",
    traits: ["doom.map"],
    describes: {
      "doom.map": { name: "Doom map", on: "object", blurb: "A Doom-format map's static part, laid out from a WAD; its doors and exit switches are objects of their own, attached to it" },
    },
    drops: ["file"],
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
