// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// A keeper holds what an object really is, away from the scene, and shows it
// only to whoever the scene's policies say may see it (the stage's
// api.audience; scene/STAGE.md, "Audience" and "Keepers"). It is an ordinary
// scene:extension, attached to objects by its own trait, so a scene that
// uses one lists this package like any other.
//
// - scene:extension "keep.plain"   the plain keeper (src/plain-keeper.js)
// - patchwork:datatype "keep-plain" its container document (src/plain.js)
// - scene:extension "keep.lots"    lots: random values the seated players'
//                                  clients draw between them by commit and
//                                  open, some parts sealed until the scene
//                                  says who may know (src/lots-ext.js,
//                                  src/lots.js)
//
// `keeper: "plain"` is how setup code finds the plain keeper (and its
// module's `contain`) in the scene:extension registry without naming this
// package; `lots: true` finds lots (and its module's `attach`).
//
// Not here yet: a sealed keeper for authored secrets (an envelope a player
// writes and opens later). It needs a private place in the stage.

export const plugins = [
  {
    type: "scene:extension",
    id: "keep.plain",
    name: "Plain keeper",
    traits: ["keep.plain"],
    keeper: "plain",
    // no `activities`: what is kept stays kept whatever the viewer is doing
    describes: {
      "keep.plain": {
        name: "Kept (in the open)",
        on: "object",
        blurb: "What this really is lives in a container document and is shown only to whoever may see it here. Anyone who opens that document can read it: a table, not a vault",
        // which slot of which container it is, is about this object in this scene: a copy has neither
        runtime: true,
        fields: [
          { key: "by", label: "Container", kind: "url", copy: "drop" },
          { key: "slot", label: "Slot", kind: "integer", default: 0, min: 0 },
        ],
      },
    },
    async load() {
      return (await import("./plain-keeper.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "keep.lots",
    name: "Lots",
    traits: ["keep.lots"],
    lots: true,
    // no `activities`: a member's client commits and opens whatever its viewer is doing
    describes: {
      "keep.lots": {
        name: "Drawn by lots",
        on: "object",
        blurb: "Random values for this (a roll) are drawn by the seated players' clients between them, so nobody chooses them: each commits to a secret, then they are opened together",
        // a draw under way is about this object now: a copy starts with none
        runtime: ["round"],
      },
    },
    async load() {
      return (await import("./lots-ext.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "keep-plain",
    name: "Kept things",
    icon: "Archive",
    unlisted: true, // made by whatever sets a scene up (contain), not from a menu
    async load() {
      return (await import("./plain.js")).PlainDatatype;
    },
  },
];
