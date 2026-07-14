import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "todo",
    name: "Todo",
    icon: "CheckSquare",
    supportedDatatypes: ["todo"],
    async load() {
      const { TodoTool } = await import("./TodoTool");
      return TodoTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "todo",
    name: "Todo",
    icon: "CheckSquare",
    async load() {
      const { TodoDatatype } = await import("./datatype");
      return TodoDatatype;
    },
  },
];
