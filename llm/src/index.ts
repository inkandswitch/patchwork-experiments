import { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as chatPlugins } from "./chat";
import { plugins as agentPlugins } from "./agent";
import { plugins as llmProvidersPlugins } from "./llm-providers";

export const plugins: Plugin<any>[] = [
  ...chatPlugins,
  ...agentPlugins,
  ...llmProvidersPlugins,
];
