// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The arena is not a datatype or a tool. It is a scene extension, a
// template and three parts (see the scene package's STAGE.md):
// - "arena" runs in a scene whose doc has an arena trait (the level on the
//   scene, targets on objects): the gun (a held tool), the targets, and
//   Stand targets up; walking in is the walk package's walk body, entered at
//   a spawn point (its trait, `walk.spawn`);
// - the "arena-level" template lays out the sample arena in an empty scene
//   and starts people walking at one of its spawn points (view.start), so
//   its maker is in the game at once;
// - the parts ("Arena" in the editor's parts bin) put a target, a crate or a
//   spawn point (a pad carrying the walk package's `walk.spawn`) into any
//   scene: a boat's deck as well as a level. A target or a spawn point makes
//   the scene a level if it isn't one yet.
// A level trait on its own comes from the inspector's "Add behaviour…", which
// reads `describes`.

export const plugins = [
  {
    type: "scene:extension",
    id: "arena",
    name: "Arena",
    traits: ["arena.level", "arena.target"],
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // level can be made without a script. A target's down/stand are not
    // settings: no fields to edit. `down` (who shot it, when) is play state,
    // marked `runtime`, so a copy of a knocked-over target (into another
    // scene, or a duplicate) is nobody's point. `stand` (how it stood) is
    // about the object, which the copy still is: lying down, so it goes
    // along, and Stand targets up raises the copy too (scene/STAGE.md,
    // "Copying objects" and `runtime`; src/level.js).
    describes: {
      "arena.level": {
        name: "Arena level",
        on: "scene",
        blurb: "Walk and shoot in this scene",
        fields: [
          {
            key: "look",
            label: "Look",
            kind: "enum",
            default: "",
            options: [
              { value: "", label: "The scene's own" },
              { value: "arena", label: "Sky, haze and sun" },
              { value: "sky", label: "Sky only (the level's light is its own)" },
            ],
          },
        ],
      },
      "arena.target": { name: "Target", on: "object", blurb: "Can be shot down; counts toward the shooter's score", runtime: ["down"] },
    },
    async load() {
      return (await import("./play.js")).default;
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
    description: "A target to shoot down. Makes the scene a level",
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
    description: "Where players start walking, facing the way it faces. Makes the scene a level",
    // the walk body's spawn point (the walk package's trait), drawn as one of the arena's pads
    traits: ["walk.spawn"],
    async load() {
      return (await import("./parts.js")).spawn;
    },
  },
];
