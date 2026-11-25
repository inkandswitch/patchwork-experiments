// The scene build's params (plain data: the worker-evaluated entry reads it).
// All cheap: the results are read once, and a change only recolours or moves them.

export const SCENE_PARAMS = [
  { key: "show", label: "Colour by", kind: "enum", default: "auto", cost: "cheap",
    options: [ { value: "auto", label: "Stress, or the mode's shape" }, { value: "vm", label: "Stress (von Mises)" }, { value: "u", label: "Displacement" }, { value: "plain", label: "Plain" } ] },
  { key: "deform", label: "Drawn moved", kind: "enum", default: "auto", cost: "cheap",
    options: [ { value: "auto", label: "Exaggerated, to be seen" }, { value: "true", label: "As it really moves" }, { value: "none", label: "Not at all" } ] },
  { key: "mode", label: "Mode (a modal run)", kind: "integer", default: 1, min: 1, max: 40, step: 1, cost: "cheap" },
  { key: "marks", label: "Supports and loads", kind: "boolean", default: true, cost: "cheap" },
];
