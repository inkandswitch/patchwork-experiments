import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "llm-process",
    name: "LLM Process",
    icon: "Bot",
    async load() {
      const { LLMProcessDatatype } = await import("./datatype");
      return LLMProcessDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm-process",
    name: "LLM Process",
    supportedDatatypes: ["llm-process"],
    async load() {
      const { LLMProcessTool } = await import("./view");
      return LLMProcessTool;
    },
  },
];

export { LLMProcessDatatype } from "./datatype";
export { LLMProcessTool, LLMProcessView } from "./view";
export type { LLMProcessDoc } from "./types";
