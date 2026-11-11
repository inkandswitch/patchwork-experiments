// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// A token bag is a container: a document that holds scene objects out of the
// scene, with a public count, a draw rule, puts and draws (README.md).
//
// - patchwork:datatype "bag"   the bag doc (datatype.js; contents.js)
// - patchwork:tool "bag"       its 2D panel, useful on its own (tool.js)
// - scene:source "bag-sack"    the bag drawn as a sack, at real size (source.js)
// - scene:part "bag.token-bag" a new bag, in the editor's parts bin (part.js)
// - scene:extension "bag"      the container verbs in a scene (extension.js)

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "bag",
    name: "Token bag",
    icon: "ShoppingBag",
    async load() {
      return (await import("./datatype.js")).BagDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "bag",
    name: "Token bag",
    icon: "ShoppingBag",
    supportedDatatypes: ["bag"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "bag-sack",
    name: "Token bag",
    icon: "ShoppingBag",
    supportedDatatypes: ["bag"],
    cost: "cheap",
    version: 1,
    async load() {
      return (await import("./source.js")).default;
    },
  },
  {
    type: "scene:part",
    id: "bag.token-bag",
    name: "Token bag",
    icon: "ShoppingBag",
    category: "Containers",
    description: "A drawstring bag that holds things out of sight: drop them on it to put them in, press D over it to draw one",
    traits: ["bag.container"],
    async load() {
      return (await import("./part.js")).tokenBag;
    },
  },
  {
    // what makes an object a container: things dropped on it go in, Draw
    // takes one out into your hand, and it shows how many it holds
    // (extension.js; the scene's STAGE.md is the contract it is built from)
    type: "scene:extension",
    id: "bag",
    name: "Bag",
    traits: ["bag.container"],
    // a bag is used in play, and while setting a table up
    activities: ["play", "edit"],
    describes: {
      "bag.container": {
        name: "Container",
        on: "object",
        blurb: "Holds other objects out of the scene, in a bag document: drop things on it to put them in, Draw (D) to take one out. Anyone who opens that document can read what is inside",
        // any object may be a container (a box lid, a cup): the document that keeps its contents
        fields: [{ key: "doc", label: "Contents (a bag document)", kind: "url" }],
      },
    },
    // a bag document dropped into a scene becomes a bag in it
    drops: ["bag"],
    // carrying is the hand's; the use prompt shows Draw over a bag in play
    // (before the key map, so it hears D first: STAGE.md, "The use prompt");
    // the menu has the verbs without a key; notices say who drew
    requires: ["scene.hand", "scene.use", "scene.keys", "scene.menu", "scene.notices"],
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
