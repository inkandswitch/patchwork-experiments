// The scene build's params (plain data: the worker-evaluated entry reads it).
// Colour choices are cheap (a recolour); which layers are drawn costs a rebuild too, but small.

export const SCENE_PARAMS = [
  { key: "hull", label: "Hull", kind: "enum", default: "Cp", cost: "cheap",
    options: [ { value: "Cp", label: "Pressure (Cp)" }, { value: "Cf", label: "Skin friction (Cf)" }, { value: "plain", label: "Plain" }, { value: "off", label: "Hidden" } ] },
  { key: "surface", label: "Water surface", kind: "enum", default: "auto", cost: "cheap",
    options: [ { value: "auto", label: "Waves, or Cp for a double body" }, { value: "Cp", label: "Pressure (Cp)" }, { value: "speed", label: "Speed" }, { value: "off", label: "Hidden" } ] },
  { key: "streamlines", label: "Streamlines", kind: "boolean", default: true, cost: "cheap" },
  { key: "wake", label: "Wake plane", kind: "boolean", default: false, cost: "cheap" },
  { key: "centreplane", label: "Centre plane", kind: "boolean", default: false, cost: "cheap" },
  { key: "mirror", label: "Mirror a half model", kind: "boolean", default: true, cost: "cheap" },
  { key: "fade", label: "Fade the undisturbed flow", kind: "number", default: 0.85, min: 0, max: 1, step: 0.05, cost: "cheap" },
  { key: "exaggerate", label: "Wave height ×", kind: "number", default: 1, min: 1, max: 20, step: 1, cost: "cheap" },
];
