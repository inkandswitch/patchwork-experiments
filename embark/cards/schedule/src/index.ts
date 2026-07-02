import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Schedule card is a document-backed datatype + tool pair (not a handle-less
// component): the marker document gives the card a stable url, and the tool
// renders the card face + runs the shared sticker-scanning engine that
// highlights times/durations and computes a running clock.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "schedule",
    name: "Schedule",
    icon: "Clock",
    supportedDatatypes: ["schedule"],
    async load() {
      const { ScheduleTool } = await import("./ScheduleProvider");
      return ScheduleTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "schedule",
    name: "Schedule",
    icon: "Clock",
    async load() {
      const { ScheduleDatatype } = await import("./datatype");
      return ScheduleDatatype;
    },
  },
];
