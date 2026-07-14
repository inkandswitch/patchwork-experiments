import type { Plugin, ToolElement } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  // Doc view: openable as a view on a Mergecraft world (gets its handle).
  {
    type: "patchwork:component",
    id: "mergecraft-distribution",
    name: "Block Distribution",
    icon: "ChartSpline",
    supportedDatatypes: ["mergecraft"],
    async load() {
      const { DistributionTool } = await import("./tool");
      return DistributionTool;
    },
  },
  // Context-sidebar variant: shows up automatically wherever `context-tool`
  // components are rendered (the frame resolves them from the
  // `patchwork:component` registry by tag). It takes no document — the render
  // ignores the `null` handle and follows `patchwork:selected-view` to track
  // whichever Mergecraft world is in front.
  {
    type: "patchwork:component",
    id: "mergecraft-distribution-context",
    name: "Block Distribution",
    icon: "ChartSpline",
    tags: ["context-tool"],
    async load() {
      const { DistributionTool } = await import("./tool");
      return (element: ToolElement) => DistributionTool(null as never, element);
    },
  },
];
