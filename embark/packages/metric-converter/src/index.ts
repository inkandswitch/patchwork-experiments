import type { Plugin } from "@inkandswitch/patchwork-plugins";

// "Convert to imperial" is a document-backed datatype + tool pair (not a
// handle-less component): the marker document gives the card a stable url, and
// the tool renders the card face + runs the shared sticker-scanning engine. It
// is the mirror of "Convert to metric" and shares no scanning code with it.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "convert-to-imperial",
    name: "Convert to imperial",
    icon: "Ruler",
    supportedDatatypes: ["convert-to-imperial"],
    async load() {
      const { ConvertToImperialTool } = await import("./MetricConverterProvider");
      return ConvertToImperialTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "convert-to-imperial",
    name: "Convert to imperial",
    icon: "Ruler",
    async load() {
      const { ConvertToImperialDatatype } = await import("./datatype");
      return ConvertToImperialDatatype;
    },
  },
];
