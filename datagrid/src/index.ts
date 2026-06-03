import type { Datatype, Plugin, Tool } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "datagrid",
    name: "Spreadsheet",
    icon: "Sheet",
    async load() {
      const { DatagridDatatype } = await import("./datatype");
      return DatagridDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "datagrid",
    name: "Spreadsheet",
    icon: "Sheet",
    supportedDatatypes: ["datagrid"],
    async load() {
      const { DatagridTool } = await import("./tool");
      return DatagridTool;
    },
  } satisfies Tool,
];
