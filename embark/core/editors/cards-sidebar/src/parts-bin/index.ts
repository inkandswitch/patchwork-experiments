import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The parts bin: a datatype holding a list of example documents plus a tool
// that previews them and lets you drag clones onto the canvas.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "parts-bin",
    name: "Parts Bin",
    icon: "Package",
    async load() {
      const { PartsBinDatatype } = await import("./datatype");
      return PartsBinDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "parts-bin",
    name: "Parts Bin",
    icon: "Package",
    supportedDatatypes: ["parts-bin"],
    async load() {
      const { PartsBinTool } = await import("./PartsBinTool");
      return PartsBinTool;
    },
  },
];
