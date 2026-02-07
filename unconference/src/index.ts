import { Plugin } from "@inkandswitch/patchwork-plugins";
import { toolify } from "@inkandswitch/patchwork-react";

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
      const { UnconferenceTool } = await import("./UnconferenceTool");
      return toolify(UnconferenceTool);
    },
  },
  {
    type: "patchwork:tool",
    id: "unconference-schedule",
    name: "Schedule",
    icon: "Calendar",
    supportedDatatypes: ["unconference"],
    async load() {
      const { ScheduleViewTool } = await import("./ScheduleViewTool");
      return toolify(ScheduleViewTool);
    },
  },
];
