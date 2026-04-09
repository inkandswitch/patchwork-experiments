import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const chatPlugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "llm-chat2",
    name: "LLM Chat 2",
    icon: "MessageSquare",
    async load() {
      const { LLMChatDatatype } = await import("./datatype");
      return LLMChatDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm-chat2",
    name: "LLM Chat 2",
    supportedDatatypes: ["llm-chat2"],
    async load() {
      const { LLMChatTool } = await import("./view");
      return LLMChatTool;
    },
  },
];

export { LLMChatDatatype } from "./datatype";
export { LLMChatTool } from "./view";
