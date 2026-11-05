// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The arena is not a datatype or a tool. It is two scene extensions and a
// template (see the scene package's STAGE.md):
// - "arena" plays: in a scene whose doc has an arena trait (the level on the
//   scene, targets and spawn points on objects), the "play" activity walks
//   and shoots in it;
// - "arena.edit" edits a level: while editing such a scene, commands put a
//   target, crate or spawn point where you're looking;
// - the "arena-level" template lays out the sample arena in an empty scene
//   and starts it in play, so its maker is in the game at once.
// The first arena trait in any other scene (a target on a boat's deck) comes
// from the inspector's "Add behaviour…", which reads `describes`.

export const plugins = [
  {
    type: "scene:extension",
    id: "arena",
    name: "Arena",
    traits: ["arena.level", "arena.target", "arena.spawn"],
    activities: ["play"],
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // level can be made without a script. A target's down/stand are play
    // state, not settings: nothing to describe.
    describes: {
      "arena.level": {
        name: "Arena level",
        on: "scene",
        blurb: "Walk and shoot in this scene, in Play",
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
    // playing brings no editor, so it says what it needs: Enter to play
    // goes through the key map, notices, and the camera framing the level as
    // it loads (a joiner's camera starts untouched, wherever the stage puts
    // it, which in an arena can be inside a wall). While playing, the game
    // holds the camera and takes every input, so framing stands aside. Not
    // scene.frame: Frame all and double-click to frame are editing's.
    requires: ["scene.keys", "scene.notices", "scene.autoframe"],
    async load() {
      return (await import("./play.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "arena.edit",
    name: "Arena editing",
    traits: ["arena.level", "arena.target", "arena.spawn"],
    activities: ["edit"],
    async load() {
      return (await import("./edit.js")).default;
    },
  },
  {
    type: "scene:template",
    id: "arena-level",
    name: "Arena level",
    icon: "Crosshair",
    description: "A walled arena with crates, a tower, targets and spawn points, ready to play",
    async load() {
      return (await import("./template.js")).default;
    },
  },
];
