import { type Plugin } from "@inkandswitch/patchwork-plugins";
import { openAIProvider } from "../llm-providers/openai";
import { anthropicProvider } from "../llm-providers/anthropic";

export const plugins: Plugin<any>[] = [
  openAIProvider,
  anthropicProvider,
  {
    type: "patchwork:datatype",
    id: "agent",
    name: "Agent",
    icon: "Bot",
    async load() {
      const { AgentDataType } = await import("./datatype");
      return AgentDataType;
    },
  },
];
