// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The arena is not a datatype or a tool. It is two scene extensions, a
// template and three parts (see the scene package's STAGE.md):
// - "arena" plays: in a scene whose doc has an arena trait (the level on the
//   scene, targets and spawn points on objects), the "play" activity walks
//   and shoots in it;
// - "arena.edit" edits a level: stands knocked-over targets back up;
// - the "arena-level" template lays out the sample arena in an empty scene
//   and starts it in play, so its maker is in the game at once;
// - the parts ("Arena" in the editor's parts bin) put a target, a crate or a
//   spawn point into any scene: a boat's deck as well as a level. A target or
//   a spawn point makes the scene a level if it isn't one yet.
// A level trait on its own comes from the inspector's "Add behaviour…", which
// reads `describes`.

export const plugins = [
  {
    type: "scene:extension",
    id: "arena",
    name: "Arena",
    traits: ["arena.level", "arena.target", "arena.spawn"],
    activities: ["play"],
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // level can be made without a script. A target's down/stand are not
    // settings: no fields to edit. `down` (who shot it, when) is play state,
    // marked `runtime`, so a copy of a knocked-over target (into another
    // scene, or a duplicate) is nobody's point. `stand` (how it stood) is
    // about the object, which the copy still is: lying down, so it goes
    // along, and Stand them up raises the copy too (scene/STAGE.md,
    // "Copying objects" and `runtime`; src/level.js).
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
      "arena.target": { name: "Target", on: "object", blurb: "Can be shot down; counts toward the shooter's score", runtime: ["down"] },
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
  {
    type: "scene:part",
    id: "arena.target",
    name: "Target",
    icon: "Target",
    category: "Arena",
    description: "A target to shoot down in play. Makes the scene a level",
    traits: ["arena.target"],
    async load() {
      return (await import("./parts.js")).target;
    },
  },
  {
    type: "scene:part",
    id: "arena.crate",
    name: "Crate",
    icon: "Package",
    category: "Arena",
    description: "A crate to hide behind or climb on",
    async load() {
      return (await import("./parts.js")).crate;
    },
  },
  {
    type: "scene:part",
    id: "arena.spawn",
    name: "Spawn point",
    icon: "MapPin",
    category: "Arena",
    description: "Where players start in play, facing the way it faces. Makes the scene a level",
    traits: ["arena.spawn"],
    async load() {
      return (await import("./parts.js")).spawn;
    },
  },
];
