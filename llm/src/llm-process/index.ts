import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const llmProcessPlugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "llm-process2",
    name: "LLM Process 2",
    icon: "Bot",
    async load() {
      const { LLMProcessDatatype } = await import("./datatype");
      return LLMProcessDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm-process2",
    name: "LLM Process 2",
    supportedDatatypes: ["llm-process2"],
    async load() {
      const { LLMProcessTool } = await import("./view");
      return LLMProcessTool;
    },
  },
];

export { LLMProcessDatatype } from "./datatype";
export { LLMProcessTool, LLMProcessView } from "./view";
export { runLLMProcess } from "./run";
export { parseScriptBlocks } from "./parser";
