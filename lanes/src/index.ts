import type { Datatype, Plugin, Tool } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "lanes",
    name: "Lanes",
    icon: "Kanban",
    async load() {
      const { LanesDatatype } = await import("./datatype");
      return LanesDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "project-card",
    name: "Project Card",
    icon: "ListTodo",
    async load() {
      const { ProjectCardDatatype } = await import("./datatype");
      return ProjectCardDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "field-configuration",
    name: "Field Configuration",
    icon: "Settings",
    async load() {
      const { FieldConfigurationDatatype } = await import("./datatype");
      return FieldConfigurationDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "project-card",
    name: "Project Card",
    icon: "ListTodo",
    supportedDatatypes: ["project-card"],
    async load() {
      const { CardTool } = await import("./card-tool");
      return CardTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "project-card-compact",
    name: "Project Card Compact",
    icon: "ListTodo",
    supportedDatatypes: ["project-card"],
    async load() {
      const { CompactCardTool } = await import("./card-tool");
      return CompactCardTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "field-configuration",
    name: "Field Configuration",
    icon: "Settings",
    supportedDatatypes: ["field-configuration"],
    async load() {
      const { FieldConfigurationToolRender } = await import(
        "./field-configuration-tool"
      );
      return FieldConfigurationToolRender;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "folder-lanes-view",
    name: "Lanes",
    icon: "LayoutGrid",
    supportedDatatypes: ["folder", "lanes"],
    async load() {
      const { LaneViewTool } = await import("./lane-view-tool");
      return LaneViewTool;
    },
  } satisfies Tool,
];
