// Every slice-job setting, as data. No imports, no functions: index.js builds
// the agent tool's input schema from this, and that module runs in a worker.
// settings.js reads it to fill defaults, coerce and clamp; the tool reads it to
// build the form. Lengths are millimetres, speeds mm/s, temperatures °C.

export const UNIT_OPTIONS = [
  { value: "mm", label: "Millimetres" },
  { value: "cm", label: "Centimetres" },
  { value: "m", label: "Metres" },
  { value: "in", label: "Inches" },
];

/**
 * One table for filament presets. Choosing a filament writes its nozzle, bed
 * and fan values into the settings (they stay editable). `density` (g/cm³) is
 * only used for the weight estimate.
 */
export const FILAMENTS = {
  PLA: { nozzleTemp: 220, bedTemp: 60, fanSpeed: 100, density: 1.24 },
  PETG: { nozzleTemp: 245, bedTemp: 75, fanSpeed: 40, density: 1.27 },
  ABS: { nozzleTemp: 255, bedTemp: 100, fanSpeed: 0, density: 1.04 },
  ASA: { nozzleTemp: 260, bedTemp: 100, fanSpeed: 0, density: 1.07 },
  TPU: { nozzleTemp: 230, bedTemp: 45, fanSpeed: 60, density: 1.21 },
};

/**
 * @typedef {{ key: string, label: string, group: string, kind: "number"|"integer"|"boolean"|"enum"|"string",
 *   default: any, min?: number, max?: number, step?: number, options?: {value: any, label: string}[],
 *   hint?: string }} SettingSpec
 */

/** @type {SettingSpec[]} */
export const SETTINGS = [
  // Model: how to read the geometry. A scene render is metres by contract and
  // ignores the unit settings; a GLB that says its units in asset.extras does too.
  { key: "stlUnit", label: "STL units", group: "Model", kind: "enum", default: "mm", options: UNIT_OPTIONS, hint: "STL files carry no units" },
  { key: "stlUp", label: "STL up axis", group: "Model", kind: "enum", default: "z", options: [{ value: "z", label: "Z up" }, { value: "y", label: "Y up" }] },
  { key: "glbUnit", label: "GLB units", group: "Model", kind: "enum", default: "auto", options: [{ value: "auto", label: "Guess" }, ...UNIT_OPTIONS], hint: "Only for a GLB that doesn't say (renders and kit GLBs do)" },
  { key: "scale", label: "Scale", group: "Model", kind: "number", default: 1, min: 0.0001, max: 10000, step: 0.01, hint: "Uniform, after units: 0.02 prints a 1:50 model" },

  { key: "layerHeight", label: "Layer height", group: "Quality", kind: "number", default: 0.2, min: 0.04, max: 0.6, step: 0.02 },
  { key: "firstLayerHeight", label: "First layer height", group: "Quality", kind: "number", default: 0.2, min: 0.04, max: 0.6, step: 0.02 },
  { key: "wallLoops", label: "Wall loops", group: "Quality", kind: "integer", default: 3, min: 1, max: 10, step: 1 },
  { key: "topLayers", label: "Top layers", group: "Quality", kind: "integer", default: 5, min: 0, max: 30, step: 1 },
  { key: "bottomLayers", label: "Bottom layers", group: "Quality", kind: "integer", default: 4, min: 0, max: 30, step: 1 },
  { key: "infillDensity", label: "Infill (%)", group: "Quality", kind: "number", default: 15, min: 0, max: 100, step: 5 },
  { key: "supports", label: "Supports", group: "Quality", kind: "boolean", default: false, hint: "Recorded, not generated yet" },

  { key: "filament", label: "Filament", group: "Material", kind: "enum", default: "PLA", options: Object.keys(FILAMENTS).map((k) => ({ value: k, label: k })) },
  { key: "nozzleTemp", label: "Nozzle (°C)", group: "Material", kind: "number", default: 220, min: 150, max: 320, step: 5 },
  { key: "bedTemp", label: "Bed (°C)", group: "Material", kind: "number", default: 60, min: 0, max: 130, step: 5 },
  { key: "fanSpeed", label: "Fan (%)", group: "Material", kind: "number", default: 100, min: 0, max: 100, step: 10 },
  { key: "filamentDiameter", label: "Filament ⌀", group: "Material", kind: "number", default: 1.75, min: 1, max: 3.5, step: 0.05 },
  { key: "flow", label: "Flow", group: "Material", kind: "number", default: 0.98, min: 0.5, max: 1.5, step: 0.01 },

  { key: "wallSpeed", label: "Walls", group: "Speed (mm/s)", kind: "number", default: 120, min: 5, max: 600, step: 10 },
  { key: "infillSpeed", label: "Infill", group: "Speed (mm/s)", kind: "number", default: 200, min: 5, max: 600, step: 10 },
  { key: "firstLayerSpeed", label: "First layer", group: "Speed (mm/s)", kind: "number", default: 50, min: 5, max: 300, step: 5 },
  { key: "travelSpeed", label: "Travel", group: "Speed (mm/s)", kind: "number", default: 400, min: 20, max: 1000, step: 10 },
  { key: "retract", label: "Retract (mm)", group: "Speed (mm/s)", kind: "number", default: 0.8, min: 0, max: 10, step: 0.1 },
  { key: "retractSpeed", label: "Retract speed", group: "Speed (mm/s)", kind: "number", default: 30, min: 1, max: 200, step: 5 },

  { key: "printer", label: "Printer", group: "Printer", kind: "string", default: "Bambu Lab H2D" },
  // H2D build volume (single nozzle region); check against your printer profile.
  { key: "bedX", label: "Bed X (mm)", group: "Printer", kind: "number", default: 325, min: 10, max: 2000, step: 1 },
  { key: "bedY", label: "Bed Y (mm)", group: "Printer", kind: "number", default: 320, min: 10, max: 2000, step: 1 },
  { key: "bedZ", label: "Height (mm)", group: "Printer", kind: "number", default: 325, min: 10, max: 2000, step: 1 },
  { key: "nozzle", label: "Nozzle ⌀ (mm)", group: "Printer", kind: "number", default: 0.4, min: 0.1, max: 2, step: 0.05 },
  { key: "lineWidth", label: "Line width (mm)", group: "Printer", kind: "number", default: 0.42, min: 0.1, max: 3, step: 0.01 },
];
