import type { Plugin } from "@inkandswitch/patchwork-plugins";

// A read/edit inspector for an LLM card: shows the card's plain-language spec
// and its generated effect.js side by side. It renders the existing `llm-card`
// datatype (no datatype of its own), pinned onto an embed via `toolId: "inspect"`.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "inspect",
    name: "Inspect",
    icon: "Search",
    supportedDatatypes: ["llm-card"],
    unlisted: true,
    async load() {
      const { InspectTool } = await import("./InspectTool");
      return InspectTool;
    },
  },
];
