// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Joints for scene objects (README.md). One so far:
// - joints.slide: a part that moves along a line between two stops, closed
//   and open: a door rising into its frame, a drawer, a hatch on a deck.
//   Opened and closed with a verb (the use prompt's F within reach, or the
//   menu and the inspector), it may close itself after a wait (slide.js; the
//   extension is extension.js).

export const plugins = [
  {
    type: "scene:extension",
    id: "joints",
    name: "Joints",
    traits: ["joints.slide"],
    // no `activities`: it runs whatever the viewer is doing (a drawer is opened
    // while editing too), and so offers no activity of its own: a scene with a
    // slide in it offers play only if something else there (a game) does
    describes: {
      "joints.slide": {
        name: "Slide",
        on: "object",
        blurb: "Moves along a line between two stops: Open and Close from its menu, or with F within reach while walking. A door, a drawer, a sliding hatch",
        fields: [
          { key: "axis", label: "Opens along (x, y, z in its parent's frame)", kind: "json", default: [0, 1, 0] },
          { key: "stops", label: "Stops (m along the axis)", kind: "json", default: { closed: 0, open: 1 } },
          { key: "speed", label: "Speed (m/s)", kind: "number", default: 1, min: 0.01, max: 20, step: 0.1 },
          { key: "wait", label: "Closes itself after (s; 0: stays open)", kind: "number", default: 0, min: 0, max: 600, step: 0.5 },
        ],
        // `at` (which stop the transform is at) is about the object, and goes with a copy; when and by whom it was opened is not
        init: { axis: [0, 1, 0], stops: { closed: 0, open: 1 }, at: "closed" },
        runtime: ["since", "by"],
      },
    },
    // no `requires`: the use prompt is a game's to bring into play (STAGE.md,
    // "The use prompt"), and the menu and the inspector are editing's
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
