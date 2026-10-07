// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "implicit-surface",
    name: "Implicit Surface",
    icon: "Atom",
    async load() {
      return (await import("./datatype.js")).ImplicitSurfaceDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "implicit-surface",
    name: "Implicit Surface",
    icon: "Atom",
    supportedDatatypes: ["implicit-surface"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "implicit-mesh",
    name: "Implicit surface (meshed)",
    icon: "Atom",
    supportedDatatypes: ["implicit-surface"],
    params: [
      {
        key: "resolution",
        label: "Resolution (cells across)",
        kind: "integer",
        default: 96,
        min: 16,
        max: 160,
        step: 8,
        cost: "expensive",
      },
      { key: "smoothNormals", label: "Smooth normals", kind: "boolean", default: true, cost: "cheap" },
      {
        key: "finish",
        label: "Surface finish",
        kind: "enum",
        default: "matte",
        options: [
          { value: "matte", label: "Matte (scene colour)" },
          { value: "satin", label: "Satin" },
          { value: "metal", label: "Polished metal" },
        ],
        cost: "cheap",
      },
    ],
    async load() {
      return (await import("./scene-source.js")).default;
    },
  },
];
