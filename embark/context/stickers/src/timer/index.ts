import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "timer",
    name: "Timer",
    icon: "Timer",
    supportedDatatypes: ["timer"],
    async load() {
      const { TimerTool } = await import("./TimerTool");
      return TimerTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "timer",
    name: "Timer",
    icon: "Timer",
    async load() {
      const { TimerDatatype } = await import("./datatype");
      return TimerDatatype;
    },
  },
];
