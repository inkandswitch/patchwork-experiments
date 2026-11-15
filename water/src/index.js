// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Water is a scene extension (see the scene package's STAGE.md, "Ambients"
// and "Water"): it runs in a scene with the `water` trait, offers that
// world's water as an ambient, gives the scene's own parts a reader of the
// world's water (the outermost doc's) in their own frame and time, and draws
// the one surface where its doc is the world. What makes waves (sailing's
// sea) contributes them; water evaluates them.

export const plugins = [
  {
    type: "scene:extension",
    id: "water",
    name: "Water",
    traits: ["water"],
    describes: {
      water: {
        name: "Water",
        on: "scene",
        blurb: "This world has water, at a level; what floats in it reads it. A world linked into another floats on that world's water instead. Its waves come from whatever makes them (a sea)",
        fields: [{ key: "level", label: "Level (m)", kind: "number", default: 0, step: 0.1 }],
        init: { level: 0 },
      },
    },
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
