// Plugin metadata only. This module is evaluated in a worker and each entry is
// structuredClone'd, so: no imports, no functions except load().

const COLOR_BY = [
  { value: "speed", label: "Speed" },
  { value: "cp", label: "Pressure coefficient (Cp)" },
];
const BODY_MODEL = [
  { value: "doc", label: "As the flow document says" },
  { value: "waterplane-2d", label: "Waterplane (2D panels)" },
  { value: "slender-body-3d", label: "Slender body (3D line sources)" },
];
const COLORMAP = [
  { value: "auto", label: "Auto (viridis for speed, cool–warm for Cp)" },
  { value: "viridis", label: "Viridis" },
  { value: "coolwarm", label: "Cool–warm" },
  { value: "turbo", label: "Turbo" },
];

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
    params: [
      { key: "seedCount", label: "Seeds per row (0 = document's)", kind: "integer", default: 0, min: 0, max: 40, step: 1, cost: "cheap" },
      { key: "rakeRows", label: "Rake rows", kind: "integer", default: 3, min: 1, max: 8, step: 1, cost: "cheap" },
      { key: "seedHeight", label: "Seed height (m)", kind: "number", default: 0, min: -10, max: 10, step: 0.1, cost: "cheap" },
      { key: "rowSpacing", label: "Row spacing (m, downward)", kind: "number", default: 0.6, min: -5, max: 5, step: 0.05, cost: "cheap" },
      { key: "step", label: "Step (m)", kind: "number", default: 0.1, min: 0.01, max: 1, step: 0.01, log: true },
      { key: "maxSteps", label: "Max steps", kind: "integer", default: 600, min: 10, max: 5000, step: 10 },
      { key: "colorBy", label: "Colour by", kind: "enum", default: "speed", options: COLOR_BY, cost: "cheap" },
      { key: "colormap", label: "Colormap", kind: "enum", default: "auto", options: COLORMAP, cost: "cheap" },
      { key: "autoRange", label: "Auto colour range", kind: "boolean", default: true, cost: "cheap" },
      { key: "colorMin", label: "Colour min", kind: "number", default: 0, step: 0.05, cost: "cheap" },
      { key: "colorMax", label: "Colour max", kind: "number", default: 3, step: 0.05, cost: "cheap" },
      { key: "tubes", label: "Stream tubes", kind: "boolean", default: true, cost: "cheap" },
      { key: "tubeRadius", label: "Tube radius (m)", kind: "number", default: 0.05, min: 0.005, max: 0.5, step: 0.005, log: true, cost: "cheap" },
      { key: "hugLines", label: "Lines past a linked body (per side)", kind: "integer", default: 3, min: 0, max: 8, step: 1, cost: "cheap" },
      { key: "bodyModel", label: "Linked body model", kind: "enum", default: "doc", options: BODY_MODEL, cost: "cheap" },
    ],
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
    params: [
      { key: "height", label: "Height (m)", kind: "number", default: 0, min: -10, max: 10, step: 0.05, cost: "cheap" },
      { key: "resolution", label: "Resolution (cells)", kind: "integer", default: 110, min: 8, max: 160, step: 1 },
      { key: "colorBy", label: "Colour by", kind: "enum", default: "cp", options: COLOR_BY, cost: "cheap" },
      { key: "colormap", label: "Colormap", kind: "enum", default: "auto", options: COLORMAP, cost: "cheap" },
      { key: "mask", label: "Mask body interiors", kind: "boolean", default: true },
      { key: "autoRange", label: "Auto colour range", kind: "boolean", default: true, cost: "cheap" },
      { key: "colorMin", label: "Colour min", kind: "number", default: -1, step: 0.05, cost: "cheap" },
      { key: "colorMax", label: "Colour max", kind: "number", default: 1, step: 0.05, cost: "cheap" },
      { key: "fade", label: "Fade undisturbed flow", kind: "number", default: 0, min: 0, max: 1, step: 0.05, cost: "cheap" },
      { key: "bodyModel", label: "Linked body model", kind: "enum", default: "doc", options: BODY_MODEL, cost: "cheap" },
    ],
    async load() {
      return (await import("./scene-slice.js")).default;
    },
  },
];
