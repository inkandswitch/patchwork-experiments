import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The card document shape, re-exported so other packages (inspect) can type
// against it without reaching into this package's internals.
export type { LlmCardDoc } from "./types";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "llm-card",
    name: "LLM Card",
    icon: "Sparkles",
    async load() {
      const { LlmCardDatatype } = await import("./datatype");
      return LlmCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm-card",
    name: "LLM Card",
    icon: "Sparkles",
    supportedDatatypes: ["llm-card"],
    async load() {
      const { LlmCardTool } = await import("./LlmCardTool");
      return LlmCardTool;
    },
  },
];
