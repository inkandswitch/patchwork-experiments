import { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as chatPlugins } from "./chat";
import { plugins as agentPlugins } from "./agent";
import { plugins as llmProvidersPlugins } from "./llm-providers";
import { plugins as llmContextPlugins } from "./llm-context";

export const plugins: Plugin<any>[] = [
  ...chatPlugins,
  ...agentPlugins,
  ...llmProvidersPlugins,
  ...llmContextPlugins,
];

console.log("llm", 19);
