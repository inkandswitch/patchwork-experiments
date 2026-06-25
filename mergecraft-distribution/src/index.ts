import type { Plugin, Tool } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "mergecraft-distribution",
    name: "Block Distribution",
    icon: "ChartSpline",
    supportedDatatypes: ["mergecraft"],
    async load() {
      const { DistributionTool } = await import("./tool");
      return DistributionTool;
    },
  } satisfies Tool,
];
