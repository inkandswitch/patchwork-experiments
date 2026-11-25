// Plugin metadata only. This module is evaluated in a worker and each entry is
// structuredClone'd, so: no functions except load(), and no imports but
// scene-params.js and agent-meta.js (plain data, themselves import-free).

import { SCENE_PARAMS } from "./scene-params.js";
import { AGENT_TOOLS } from "./agent-meta.js";

/**
 * Bump when the scene build makes different output from the same study and params.
 * 1: first.
 */
const SCENE_VERSION = 1;

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "fea-study",
    name: "FEA study",
    icon: "Hammer",
    async load() {
      return (await import("./datatypes.js")).StudyDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "fea-study",
    name: "FEA",
    icon: "Hammer",
    supportedDatatypes: ["fea-study"],
    async load() {
      return (await import("./tool/study-tool.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "fea-run",
    name: "FEA run",
    icon: "Activity",
    unlisted: true,
    async load() {
      return (await import("./datatypes.js")).RunDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "fea-run",
    name: "FEA run",
    icon: "Activity",
    supportedDatatypes: ["fea-run"],
    async load() {
      return (await import("./tool/run-tool.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "fea-part",
    name: "FEA part (kept)",
    icon: "Box",
    unlisted: true,
    async load() {
      return (await import("./datatypes.js")).PartDatatype;
    },
  },
  {
    type: "patchwork:datatype",
    id: "fea-server",
    name: "FEA server",
    icon: "Server",
    unlisted: true,
    async load() {
      return (await import("./datatypes.js")).ServerDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "fea-server",
    name: "FEA server",
    icon: "Server",
    supportedDatatypes: ["fea-server"],
    async load() {
      return (await import("./tool/server-tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "fea-results",
    content: "built",
    name: "FEA results",
    icon: "Hammer",
    supportedDatatypes: ["fea-study", "fea-run"],
    params: SCENE_PARAMS,
    // reads the part and the results once and bakes colours: well under a second
    cost: "expensive",
    version: SCENE_VERSION,
    async load() {
      return (await import("./scene-source.js")).default;
    },
  },
  {
    // A study where it stands in a scene: "Analyse" on any object makes a study
    // of it, and a study's Open lays its panel over the scene with the part in
    // place to pick faces on (src/scene/edit.js).
    type: "scene:view",
    id: "fea-scene-edit",
    name: "FEA in a scene",
    async load() {
      return (await import("./scene/edit.js")).default;
    },
  },
  // the same study for an agent: make, set up, run, read results, stop (src/agent-tools.js)
  ...AGENT_TOOLS,
];
