import type { Plugin } from "@inkandswitch/patchwork-plugins";

// A read/edit inspector for any document, pinned onto an embed via
// `toolId: "inspect"`. Every document gets a `raw` tab (the `raw` tool). LLM
// cards additionally get `spec` and `code` tabs (their plain-language spec and
// generated effect.js), shown before `raw`.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "inspect",
    name: "Inspect",
    icon: "Search",
    supportedDatatypes: "*",
    unlisted: true,
    async load() {
      const { InspectTool } = await import("./InspectTool");
      return InspectTool;
    },
  },
];
