// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Going elsewhere from a scene (README.md). One trait:
// - traversal.exit: an object that leads to another document. Used with its
//   verb ("Go below", "Exit"; "Go" when it names none) on the use prompt
//   within reach, or from its menu and the inspector; going there opens that
//   document in Patchwork's own way (go.js). With nowhere to go it offers
//   nothing.

export const plugins = [
  {
    type: "scene:extension",
    id: "traversal",
    name: "Traversal",
    traits: ["traversal.exit"],
    // no `activities`: it runs whatever the viewer is doing (an exit is used
    // from its menu while editing too), and so offers no activity of its own
    describes: {
      "traversal.exit": {
        name: "Exit",
        on: "object",
        blurb: "Leads to another document: its verb opens it, from the menu, or with F within reach while walking. A hatch, a level's exit, a doorway to another scene",
        fields: [
          { key: "to", label: "Leads to (a document link)", kind: "url" },
          { key: "verb", label: "Verb (Go, when empty)", kind: "string", default: "" },
        ],
        init: {},
      },
    },
    // no `requires`: the use prompt is a game's to bring into play (STAGE.md,
    // "The use prompt"), and the menu and the inspector are editing's
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
