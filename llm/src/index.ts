import type { Plugin } from "@inkandswitch/patchwork-plugins";

console.log("llm version", 1);

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "llm",
    name: "LLM",
    icon: "Bot",
    async load() {
      const { LLMDatatype } = await import("./datatype");
      return LLMDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm",
    name: "LLM",
    supportedDatatypes: ["llm"],
    async load() {
      const { LLMTool } = await import("./view");
      return LLMTool;
    },
  },
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
      const { LLMChatTool } = await import("./chat");
      return LLMChatTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "llm-workspace",
    name: "LLM Workspace",
    icon: "FolderOpen",
    async load() {
      const { LLMWorkspaceDatatype } = await import("./datatype");
      return LLMWorkspaceDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm-workspace",
    name: "LLM Workspace",
    supportedDatatypes: ["llm-workspace"],
    async load() {
      const { LLMWorkspaceTool } = await import("./workspace");
      return LLMWorkspaceTool;
    },
  },
];

export { runLLMProcess, runLLMProcessRaw, buildLLMMessages } from "./llm-process";
export { SYSTEM_PROMPT } from "./system-prompt";
export { LLMTool, LLMView } from "./view";
export { LLMWorkspaceTool, LLMWorkspaceView } from "./workspace";
export type { LLMDoc, LLMChatDoc, LLMWorkspaceDoc, OutputBlock, ParsedBlock, ChatMessage, ContentPart } from "./types";

