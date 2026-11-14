// Rhino .3dm → scene. Metadata only here: this module may run in a worker.
export const plugins = [
  {
    type: "patchwork:tool",
    id: "model-viewer",
    name: "3D Model Viewer",
    icon: "Box",
    supportedDatatypes: ["file"],
    // the formats it opens; other file types show a message
    extensions: ["glb", "gltf", "stl", "3mf", "3dm", "obj", "ply"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "file-3dm",
    name: "Rhino 3DM file",
    icon: "Box",
    supportedDatatypes: ["file"],
    extensions: ["3dm"],
    content: "built",
    cost: "expensive",
    version: 1,
    params: [
      {
        key: "unit", label: "File units", kind: "enum", default: "auto", cost: "cheap",
        options: [
          { value: "auto", label: "From file" },
          { value: "mm", label: "Millimetres" },
          { value: "cm", label: "Centimetres" },
          { value: "m", label: "Metres" },
          { value: "in", label: "Inches" },
          { value: "ft", label: "Feet" },
        ],
      },
      { key: "hidden", label: "Include hidden objects/layers", kind: "boolean", default: false },
    ],
    async load() {
      return (await import("./source.js")).default;
    },
  },
];
