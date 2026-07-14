import { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "unconference",
    name: "Unconference",
    icon: "Calendar",
    async load() {
      const { unconferenceDatatype } = await import("./datatype");
      return unconferenceDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "unconference",
    name: "Unconference",
    icon: "Calendar",
    supportedDatatypes: ["unconference"],
    async load() {
      const { renderUnconferenceTool } = await import("./UnconferenceTool");
      return renderUnconferenceTool;
    },
  },
  {
    type: "patchwork:tool",
    id: "unconference-schedule",
    name: "Schedule",
    icon: "Calendar",
    supportedDatatypes: ["unconference"],
    async load() {
      const { renderScheduleViewTool } = await import("./ScheduleViewTool");
      return renderScheduleViewTool;
    },
  },
];
