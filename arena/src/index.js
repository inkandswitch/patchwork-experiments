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
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // level can be made without a script. A target's down/stand are play
    // state, not settings: nothing to describe.
    describes: {
      "arena.level": {
        name: "Arena level",
        on: "scene",
        blurb: "Walk and shoot in this scene (Enter to play)",
        fields: [
          {
            key: "look",
            label: "Look",
            kind: "enum",
            default: "",
            options: [
              { value: "", label: "The scene's own" },
              { value: "arena", label: "Sky, haze and sun" },
            ],
          },
        ],
      },
      "arena.target": { name: "Target", on: "object", blurb: "Can be shot down; counts toward the shooter's score" },
      "arena.spawn": { name: "Spawn point", on: "object", blurb: "Where players start, facing the way it faces" },
    },
    // a level opens with no editing kit (see build.js), so it brings what
    // playing needs: Enter to play goes through the key map, and notices
    requires: ["scene.keys", "scene.notices"],
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
