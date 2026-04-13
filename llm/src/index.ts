import type { Plugin } from "@inkandswitch/patchwork-plugins";

import { llmProcessPlugins } from "./llm-process";
import { chatPlugins } from "./chat";

export const plugins: Plugin<any>[] = [
  ...llmProcessPlugins,
  ...chatPlugins,
];

export { LLMProcessDatatype, LLMProcessTool, LLMProcessView, runLLMProcess, parseScriptBlocks } from "./llm-process";
export { LLMChatDatatype, LLMChatTool } from "./chat";
export { createWorkspace } from "./workspace";
export type { 
  LLMProcessDoc, 
  LLMChatDoc, 
  Message, 
  ContentBlock, 
  TextBlock, 
  ScriptBlock, 
  ImageBlock,
  Workspace,
  ParsedBlock,
} from "./types";
