import type { Plugin } from "@inkandswitch/patchwork-plugins";

// A live, read-only visualization of the canvas shared context: every channel
// and its merged value, updated as scopes write and release.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "context-viewer",
    name: "Context",
    icon: "Braces",
    supportedDatatypes: ["context-viewer"],
    async load() {
      const { ContextViewerTool } = await import("./ContextViewerTool");
      return ContextViewerTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "context-viewer",
    name: "Context",
    icon: "Braces",
    async load() {
      const { ContextViewerDatatype } = await import("./datatype");
      return ContextViewerDatatype;
    },
  },
];
