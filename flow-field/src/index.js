// Plugin metadata only. This module is evaluated in a worker and each entry is
// structuredClone'd, so: no functions except load(), and no imports but
// params.js (plain data, itself import-free), which the builds read too.

import { STREAMLINE_PARAMS, SLICE_PARAMS } from "./params.js";

/**
 * Bump when a build makes different output from the same doc and params
 * (scene contract v3: renders built by an older version go stale once).
 * 2: linked bodies read from scene-render docs; params clamped to their specs.
 */
const VERSION = 2;

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
    // can mean panel solves (and, for a source-doc link, an upstream build
    // on the main thread)
    cost: "expensive",
    version: VERSION,
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
    async load() {
      return (await import("./scene-slice.js")).default;
    },
  },
];
