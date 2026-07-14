import type { Plugin, Tool, Datatype } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "lighterpack",
    name: "Gear List",
    icon: "Backpack",
    async load() {
      const { LighterpackDatatype } = await import("./datatype");
      return LighterpackDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "lighterpack",
    name: "Gear List",
    icon: "Backpack",
    supportedDatatypes: ["lighterpack"],
    async load() {
      await import("./index.css");
      const { LighterpackTool } = await import("./tool");
      return LighterpackTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "lighterpack-checklist",
    name: "Packing Checklist",
    icon: "CheckSquare",
    supportedDatatypes: ["lighterpack"],
    async load() {
      await import("./index.css");
      const { LighterpackChecklistTool } = await import("./checklist");
      return LighterpackChecklistTool;
    },
  } satisfies Tool,
];
