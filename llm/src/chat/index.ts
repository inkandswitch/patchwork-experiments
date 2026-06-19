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
  {
    type: "patchwork:tool",
    id: "llm-context-chat",
    name: "LLM Chat",
    icon: "MessageSquare",
    tags: ["context-tool"],
    supportedDatatypes: ["account"],
    async load() {
      const { LLMContextChatTool } = await import("./context-view");
      return LLMContextChatTool;
    },
  },
];

export { LLMChatDatatype } from "./datatype";
export { LLMChatTool } from "./view";
export { LLMContextChatTool } from "./context-view";
