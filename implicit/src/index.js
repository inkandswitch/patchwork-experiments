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
    // a source edit remeshes from scratch
    cost: "expensive",
    // Bump when build() makes different output for the same doc and params
    // (not the "v1:" fingerprint prefix in doc.js, which stays put).
    // 2: the mesh has a fixed name instead of the doc's title.
    version: 2,
    params: [
      {
        // the host clamps to min/max; mesh/job.js repeats them (index.test.js checks)
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
