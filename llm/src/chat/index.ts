import type { Plugin, ToolElement } from "@inkandswitch/patchwork-plugins";

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
  // A `patchwork:component` that takes no document: the render function
  // ignores its handle (it reads everything off `element`, via the
  // `patchwork:tool-storage` provider), so we pass `null`.
  {
    type: "patchwork:component",
    id: "llm-context-chat",
    name: "LLM Chat",
    icon: "MessageSquare",
    tags: ["context-tool"],
    async load() {
      const { LLMContextChatTool } = await import("./context-view");
      return (element: ToolElement) => LLMContextChatTool(null as never, element);
    },
  },
];

export { LLMChatDatatype } from "./datatype";
export { LLMChatTool } from "./view";
export { LLMContextChatTool } from "./context-view";
