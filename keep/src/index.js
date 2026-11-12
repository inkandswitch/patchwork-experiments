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
//
// `keeper: "plain"` is how setup code finds it (and its module's `contain`)
// in the scene:extension registry without naming this package.
//
// Not here yet: a sealed keeper (an authored secret behind a commitment) and
// jointly drawn seeds. They would be further extensions in this list.

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
