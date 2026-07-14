import type { Plugin, Tool } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "tldraw-text-list",
    name: "Text List",
    icon: "List",
    supportedDatatypes: ["tldraw4"],
    async load() {
      const { TextListTool } = await import("./tool");
      return TextListTool;
    },
  } satisfies Tool,
];
