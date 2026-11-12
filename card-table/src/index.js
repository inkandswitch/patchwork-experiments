// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "secure-deck",
    name: "Secure deck",
    icon: "Layers",
    unlisted: true, // made by whatever sets a scene up (keeper.js contain), not from a menu
    async load() {
      return (await import("./datatype.js")).SecureDeckDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "secure-deck",
    name: "Secure deck",
    icon: "Layers",
    supportedDatatypes: ["secure-deck"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    // The joint keeper: what an object really is, kept in a secure deck the
    // seated players shuffle between them, shown to whoever the scene says
    // may see it (src/keeper.js). An ordinary scene extension, attached to
    // objects by its own trait; `keeper: "joint"` is how setup code finds it
    // (and its module's `contain`) in the scene:extension registry.
    type: "scene:extension",
    id: "card-table",
    name: "Joint keeper",
    traits: ["card-table.kept"],
    keeper: "joint",
    // no `activities`: what is kept stays kept, and keys go on being handed over, whatever the viewer is doing
    describes: {
      "card-table.kept": {
        name: "Kept (jointly)",
        on: "object",
        blurb: "What this really is lives in a secure deck that the seated players shuffle between them: nobody knows which is where, and it is shown only to whoever may see it here",
        // which position of which deck it is, is about this object in this scene: a copy has neither
        runtime: true,
        fields: [
          { key: "by", label: "Deck", kind: "url", copy: "drop" },
          { key: "slot", label: "Position", kind: "integer", default: 0, min: 0 },
        ],
      },
    },
    async load() {
      return (await import("./keeper.js")).default;
    },
  },
];
