// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.


const SCENE_PLUGINS = [
  {
    type: "scene:source",
    id: "ink-scene",
    content: "built",
    name: "Ink Studio scene",
    icon: "Sparkles",
    supportedDatatypes: ["ink-scene"],
    // building runs the scene's code and bakes its splats; the GLB is a blocky stand-in (proxy.js)
    cost: "expensive",
    version: 1,
    params: [
      { key: "cells", label: "Stand-in blocks across", kind: "integer", default: 48, min: 8, max: 128, step: 8, cost: "expensive" },
    ],
    async load() {
      return (await import("./source.js")).default;
    },
  },
  {
    // draws each object with the trait by ink's own renderer, in the stage's GL context with depth
    type: "scene:extension",
    id: "ink",
    name: "Ink Studio",
    traits: ["ink.scene"],
    drops: ["ink-scene"],
    describes: {
      "ink.scene": {
        name: "Ink Studio scene",
        on: "object",
        blurb: "Drawn by Ink Studio's own renderer, in pixel art, among everything else in the scene",
        fields: [
          { key: "px", label: "Pixel size", kind: "integer", default: 3, min: 1, max: 8, step: 1 },
          { key: "atmosphere", label: "Give the scene this world's sky and sun", kind: "boolean", default: false },
          { key: "look", label: "Give the whole scene this world's pixel-art look", kind: "boolean", default: false },
        ],
      },
    },
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "ink-scene",
    name: "Ink Studio scene",
    icon: "Sparkles",
    async load() {
      return (await import("./datatype.js")).default;
    },
  },
  {
    type: "patchwork:tool",
    id: "ink-scene",
    name: "Ink Studio",
    icon: "Sparkles",
    supportedDatatypes: ["ink-scene"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  // ink in a scene: the source, the drawing extension
  ...SCENE_PLUGINS,
];
