// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The agent tool's settings properties mirror src/settings-spec.js; a test
// (index.test.js) fails if the two drift apart.

const UNITS = ["mm", "cm", "m", "in"];
const num = (description, minimum, maximum) => ({ type: "number", description, minimum, maximum });
const int = (description, minimum, maximum) => ({ type: "integer", description, minimum, maximum });

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "slice-job",
    name: "Slice job",
    icon: "Layers",
    async load() {
      return (await import("./datatype.js")).SliceJobDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "patchwork-slicer",
    name: "Slicer",
    icon: "Layers",
    supportedDatatypes: ["slice-job", "file"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "agent:tool",
    id: "prepare_slice",
    name: "Prepare a model for 3D printing",
    description:
      "Make a slice job for a 3D model (or re-point an existing one), with FDM slicing settings. The model is a scene object's render " +
      "(read the scene doc: objects[<id>].renderUrl), or a GLB or STL file document. The job keeps its settings, re-slices when the model " +
      "changes, and saves G-code as a file document (its gcodeUrl). Pass slice: true to slice now and get the G-code URL back. " +
      "Lengths in mm, temperatures in °C, speeds in mm/s. Choosing a filament sets its temperatures unless you give them.",
    where: "worker",
    risk: "write",
    input_schema: {
      type: "object",
      required: ["model"],
      properties: {
        model: { type: "string", description: "Automerge URL of a scene render, or a GLB or STL file document" },
        job: { type: "string", description: "Automerge URL of an existing slice job to re-point and update. Omit to make a new one." },
        title: { type: "string", description: "Name for the job" },
        auto: { type: "boolean", description: "Re-slice automatically when the model or settings change (default true)" },
        slice: { type: "boolean", description: "Slice now and report the G-code URL (default false)" },

        stlUnit: { type: "string", enum: UNITS, description: "Units of an STL file (default mm)" },
        stlUp: { type: "string", enum: ["z", "y"], description: "Up axis of an STL file (default z)" },
        glbUnit: { type: "string", enum: ["auto", ...UNITS], description: "Units of a GLB that doesn't say (default auto: guess)" },
        scale: num("Uniform scale after units, e.g. 0.02 for a 1:50 model (default 1)", 0.0001, 10000),

        layerHeight: num("Layer height in mm (default 0.2)", 0.04, 0.6),
        firstLayerHeight: num("First layer height in mm (default 0.2)", 0.04, 0.6),
        wallLoops: int("Wall loops (default 3)", 1, 10),
        topLayers: int("Solid top layers (default 5)", 0, 30),
        bottomLayers: int("Solid bottom layers (default 4)", 0, 30),
        infillDensity: num("Infill density 0-100 % (default 15)", 0, 100),
        supports: { type: "boolean", description: "Request supports (recorded; not generated yet)" },

        filament: { type: "string", enum: ["PLA", "PETG", "ABS", "ASA", "TPU"], description: "Filament (default PLA)" },
        nozzleTemp: num("Nozzle temperature °C (default from filament)", 150, 320),
        bedTemp: num("Bed temperature °C (default from filament)", 0, 130),
        fanSpeed: num("Part fan 0-100 % (default from filament)", 0, 100),
        filamentDiameter: num("Filament diameter mm (default 1.75)", 1, 3.5),
        flow: num("Flow multiplier (default 0.98)", 0.5, 1.5),

        wallSpeed: num("Wall speed mm/s (default 120)", 5, 600),
        infillSpeed: num("Infill speed mm/s (default 200)", 5, 600),
        firstLayerSpeed: num("First layer speed mm/s (default 50)", 5, 300),
        travelSpeed: num("Travel speed mm/s (default 400)", 20, 1000),
        retract: num("Retraction length mm (default 0.8)", 0, 10),
        retractSpeed: num("Retraction speed mm/s (default 30)", 1, 200),

        printer: { type: "string", description: "Printer name (a label; default Bambu Lab H2D)" },
        bedX: num("Build volume X mm (default 325)", 10, 2000),
        bedY: num("Build volume Y mm (default 320)", 10, 2000),
        bedZ: num("Build volume height mm (default 325)", 10, 2000),
        nozzle: num("Nozzle diameter mm (default 0.4)", 0.1, 2),
        lineWidth: num("Line width mm (default 0.42)", 0.1, 3),
      },
    },
    async load() {
      return (await import("./agent.js")).default;
    },
  },
];
