import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "latex",
    name: "LaTeX",
    icon: "FileText",
    async load() {
      const { LaTeXDatatype } = await import("./datatype");
      return LaTeXDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "latex",
    name: "LaTeX Editor",
    icon: "FileText",
    supportedDatatypes: ["latex"],
    async load() {
      const { renderLaTeXEditor } = await import("./LaTeXEditor");
      return renderLaTeXEditor;
    },
  },
];
