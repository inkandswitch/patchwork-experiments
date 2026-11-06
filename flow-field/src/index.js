// Plugin metadata only. This module is evaluated in a worker and each entry is
// structuredClone'd, so: no functions except load(), and no imports but
// params.js (plain data, itself import-free), which the builds read too.

import { STREAMLINE_PARAMS, SLICE_PARAMS } from "./params.js";

/**
 * Bump when a build makes different output from the same doc and params
 * (scene contract v3: renders built by an older version go stale once).
 * 2: linked bodies read from scene-render docs; params clamped to their specs.
 * 3: the body is always cut here from geometry (a render, a GLB file, or a
 *    source's default build), never asked of a geometry:section provider;
 *    GLB units and quantized / meshopt GLBs read; build notes changed.
 */
const VERSION = 3;

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "flow-field",
    name: "Flow Field",
    icon: "Wind",
    async load() {
      return (await import("./datatype.js")).FlowFieldDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "flow-field",
    name: "Flow Field",
    icon: "Wind",
    supportedDatatypes: ["flow-field"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "flow-field-streamlines",
    name: "Flow streamlines",
    icon: "Wind",
    supportedDatatypes: ["flow-field"],
    params: STREAMLINE_PARAMS,
    // builds run in a worker (main thread if none starts), and a linked body
    // can mean panel solves (and, for a body that is a source doc, an
    // upstream build on the main thread)
    cost: "expensive",
    version: VERSION,
    // dragged in the scene: the seed rake's height, up the field's z (the GLB's +Y)
    handles: [{ param: "seedHeight", axis: [0, 1, 0], label: "Seed height" }],
    async load() {
      return (await import("./scene-streamlines.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "flow-field-slice",
    name: "Flow slice",
    icon: "Layers",
    supportedDatatypes: ["flow-field"],
    params: SLICE_PARAMS,
    cost: "expensive",
    version: VERSION,
    // dragged in the scene: the slice plane's height, up the field's z (the GLB's +Y)
    handles: [{ param: "height", axis: [0, 1, 0], label: "Slice height" }],
    async load() {
      return (await import("./scene-slice.js")).default;
    },
  },
];
