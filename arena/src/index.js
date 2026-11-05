// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The arena is not a datatype or a tool. It is two scene extensions and a kit
// (see the scene package's STAGE.md):
// - "arena" plays: any scene whose doc has an arena trait (the level on the
//   scene, targets and spawn points on objects) can be walked and shot in;
// - "arena.build" lays out a level: commands to put down the sample arena, or
//   a target, crate or spawn point where you're looking. The "arena-level"
//   kit is the scene's model kit plus those commands.

export const plugins = [
  {
    type: "scene:extension",
    id: "arena",
    name: "Arena",
    traits: ["arena.level", "arena.target", "arena.spawn"],
    async load() {
      return (await import("./play.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "arena.build",
    name: "Arena level",
    async load() {
      return (await import("./build.js")).default;
    },
  },
  {
    type: "scene:kit",
    id: "arena-level",
    name: "Arena level",
    icon: "Crosshair",
    kits: ["model"],
    extensions: ["arena.build"],
  },
];
