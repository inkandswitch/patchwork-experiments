// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// naval: a naval architecture workbench, a companion to camber. Two
// datatypes: "Rig" (a rig design over a hull), its tool, and the
// scene:source that builds the rig GLB carrying the extras.rig contract
// (contract/v1); and "Naval study" (hulls and designs screened side by
// side, every figure with its method, source and envelope), its tool.

/**
 * Bump when a build makes different output from the same doc and params.
 * 1: the first rig GLB (contract v1).
 */
const VERSION = 1;

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "rig-design",
    name: "Rig",
    icon: "Sailboat",
    async load() {
      return (await import("./datatype.js")).RigDesignDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "rig-design",
    name: "Rig",
    icon: "Sailboat",
    supportedDatatypes: ["rig-design"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "rig-design",
    name: "Rig",
    icon: "Sailboat",
    supportedDatatypes: ["rig-design"],
    params: [
      { key: "sails", label: "Sails", kind: "boolean", default: true, cost: "cheap" },
      { key: "hull", label: "Synthetic hull (when no hull is linked)", kind: "boolean", default: true, cost: "cheap" },
    ],
    // a build floats the hull, builds its hydrostatic table and solves the polar (about a second, in a worker)
    cost: "expensive",
    version: VERSION,
    async load() {
      return (await import("./scene-build.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "naval-study",
    name: "Naval study",
    icon: "Scale",
    async load() {
      return (await import("./study/datatype.js")).NavalStudyDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "naval-study",
    name: "Naval study",
    icon: "Scale",
    supportedDatatypes: ["naval-study"],
    async load() {
      return (await import("./study/tool.js")).default;
    },
  },
];
