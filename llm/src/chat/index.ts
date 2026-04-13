import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const chatPlugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "llm-chat",
    name: "LLM Chat",
    icon: "MessageSquare",
    async load() {
      const { LLMChatDatatype } = await import("./datatype");
      return LLMChatDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm-chat",
    name: "LLM Chat",
    supportedDatatypes: ["llm-chat"],
    async load() {
      const { LLMChatTool } = await import("./view");
      return LLMChatTool;
    },
  },
];

export { LLMChatDatatype } from "./datatype";
export { LLMChatTool } from "./view";
