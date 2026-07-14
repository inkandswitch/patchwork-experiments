import type { Plugin, ToolElement } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  // Doc view: openable as a view on a Mergecraft world (gets its handle).
  {
    type: "patchwork:component",
    id: "mergecraft-spreadsheet",
    name: "Block Sheet",
    icon: "Table2",
    supportedDatatypes: ["mergecraft"],
    async load() {
      const { SpreadsheetTool } = await import("./tool");
      return SpreadsheetTool;
    },
  },
  // Context-sidebar variant: shows up automatically wherever `context-tool`
  // components are rendered (the frame resolves them from the
  // `patchwork:component` registry by tag). It takes no document — the render
  // ignores the `null` handle and follows `patchwork:selected-view` to track
  // whichever Mergecraft world is in front.
  {
    type: "patchwork:component",
    id: "mergecraft-spreadsheet-context",
    name: "Block Sheet",
    icon: "Table2",
    tags: ["context-tool"],
    async load() {
      const { SpreadsheetTool } = await import("./tool");
      return (element: ToolElement) => SpreadsheetTool(null as never, element);
    },
  },
];
