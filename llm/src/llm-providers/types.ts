import type {
  PluginDescription,
  LoadedPlugin,
  Plugin,
} from "@inkandswitch/patchwork-plugins";

export type ModelId = string;

export type LLMProviderDescription = PluginDescription & {
  type: "patchwork:llm-provider";
  supportedModels: ModelId[];
  available(): Promise<boolean>;
  load(): Promise<LLMProviderImplementation>;
};

export type LLMMessage = {
  role: string;
  content: string;
};

export type LLMProviderImplementation = {
  chatCompletion(
    messages: LLMMessage[],
    options?: { model?: ModelId }
  ): Promise<string>;
  chatCompletionStream(
    messages: LLMMessage[],
    options?: { model?: ModelId }
  ): AsyncGenerator<string>;
};

export type LLMProviderPlugin = Plugin<LLMProviderDescription>;
export type LoadedLLMProvider = LoadedPlugin<
  LLMProviderDescription,
  LLMProviderImplementation
>;
