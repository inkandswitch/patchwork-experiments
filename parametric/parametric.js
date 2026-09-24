/**
 * Plugin registry entry. Metadata only: this module is imported inside a Web
 * Worker and structuredClone'd, so nothing but JSON and the `load` functions
 * may live here. The ids are public and permanent; documents record them.
 */
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "parametric",
    name: "Parametric",
    icon: "SlidersHorizontal",
    async load() {
      return (await import("./datatype.js")).ParametricDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "parametric",
    name: "Parametric",
    icon: "SlidersHorizontal",
    supportedDatatypes: ["parametric"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
];
