import { type Plugin } from "@patchwork/sdk";

import "./index.css";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:dataType",
    id: "lighterpack",
    name: "Gear List",
    icon: "Backpack",
    async load() {
      const { dataType } = await import("./datatype");
      return dataType;
    },
  },
  {
    type: "patchwork:tool",
    id: "lighterpack",
    name: "Gear List",
    icon: "Backpack",
    supportedDataTypes: ["lighterpack"],
    async load() {
      const { Tool } = await import("./tool");
      return { EditorComponent: Tool };
    },
  },
  {
    type: "patchwork:tool",
    id: "lighterpack-checklist",
    name: "Packing Checklist",
    icon: "CheckSquare",
    supportedDataTypes: ["lighterpack"],
    async load() {
      const { PackingChecklist } = await import("./checklist");
      return { EditorComponent: PackingChecklist };
    },
  },
];
