import { openAIProvider } from "./openai";
import { anthropicProvider } from "./anthropic";
import { openRouterProvider } from "./openrouter";
import { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [openAIProvider, anthropicProvider, openRouterProvider];
