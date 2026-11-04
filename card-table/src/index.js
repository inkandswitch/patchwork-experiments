// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "secure-deck",
    name: "Secure deck",
    icon: "Layers",
    unlisted: true, // made by a table (tabletop's "Set up a table"), not from a menu
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
    // A table reads the cards of a secure deck (objects whose tabletop.hidden trait names it) through this.
    type: "tabletop:deck",
    id: "secure-deck",
    name: "Secure deck",
    supportedDatatypes: ["secure-deck"],
    async load() {
      return await import("./scene-resolver.js");
    },
  },
];
