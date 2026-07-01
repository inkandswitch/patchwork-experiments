import type { Plugin } from "@inkandswitch/patchwork-plugins";

// "Convert to metric" is a document-backed datatype + tool pair (not a
// handle-less component): the marker document gives the card a stable url, and
// the tool renders the card face + runs the shared sticker-scanning engine. It
// is the mirror of "Convert to imperial" and shares no scanning code with it.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "convert-to-metric",
    name: "Convert to metric",
    icon: "Ruler",
    supportedDatatypes: ["convert-to-metric"],
    async load() {
      const { ConvertToMetricTool } = await import("./UnitConverterProvider");
      return ConvertToMetricTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "convert-to-metric",
    name: "Convert to metric",
    icon: "Ruler",
    async load() {
      const { ConvertToMetricDatatype } = await import("./datatype");
      return ConvertToMetricDatatype;
    },
  },
];
