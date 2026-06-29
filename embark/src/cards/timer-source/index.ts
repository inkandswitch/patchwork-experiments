import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "timer-source",
    name: "Timer",
    icon: "Timer",
    supportedDatatypes: ["timer-source"],
    async load() {
      const { TimerSourceTool } = await import("./tool");
      return TimerSourceTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "timer-source",
    name: "Timer",
    icon: "Timer",
    async load() {
      const { TimerSourceDatatype } = await import("./datatype");
      return TimerSourceDatatype;
    },
  },
];
