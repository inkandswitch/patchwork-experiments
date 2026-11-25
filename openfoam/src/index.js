// Plugin metadata only. This module is evaluated in a worker and each entry is
// structuredClone'd, so: no functions except load(), and no imports but
// scene-params.js and agent-meta.js (plain data, themselves import-free).

import { SCENE_PARAMS } from "./scene-params.js";
import { AGENT_TOOLS } from "./agent-meta.js";

/**
 * Bump when the scene build makes different output from the same run and params.
 * 1: first.
 */
const SCENE_VERSION = 1;

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "openfoam-case",
    name: "OpenFOAM case",
    icon: "Waves",
    async load() {
      return (await import("./datatypes.js")).CaseDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "openfoam-case",
    name: "OpenFOAM",
    icon: "Waves",
    supportedDatatypes: ["openfoam-case"],
    async load() {
      return (await import("./tool/case-tool.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "openfoam-run",
    name: "OpenFOAM run",
    icon: "Activity",
    unlisted: true,
    async load() {
      return (await import("./datatypes.js")).RunDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "openfoam-run",
    name: "OpenFOAM run",
    icon: "Activity",
    supportedDatatypes: ["openfoam-run"],
    async load() {
      return (await import("./tool/run-tool.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "openfoam-hull",
    name: "OpenFOAM hull (kept)",
    icon: "Sailboat",
    unlisted: true,
    async load() {
      return (await import("./datatypes.js")).HullDatatype;
    },
  },
  {
    type: "scene:source",
    id: "openfoam-results",
    content: "built",
    name: "CFD results",
    icon: "Waves",
    supportedDatatypes: ["openfoam-case", "openfoam-run"],
    params: SCENE_PARAMS,
    // reads up to a few MB of layers and bakes colours: well under a second,
    // but not something to redo on every keystroke
    cost: "expensive",
    version: SCENE_VERSION,
    async load() {
      return (await import("./scene-source.js")).default;
    },
  },
  // the same case, for an agent: make, set up, run, read results, stop (src/agent-tools.js)
  ...AGENT_TOOLS,
];
