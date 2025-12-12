import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type {
  PluginDescription,
  LoadedPlugin,
  Plugin,
} from "@inkandswitch/patchwork-plugins";

export type ModelId = string;

export type LLMContextDescription = PluginDescription & {
  type: "patchwork:llm-context";
};

export type LLMContextImplementation = {
  prompt(agentDocUrl: AutomergeUrl, repo: Repo): Promise<string>;
  /** Returns a reason string if the agent should continue, or null/undefined if done */
  getRerunReason?: (agentDocUrl: AutomergeUrl, repo: Repo) => Promise<string | null>;
  init?: (agentDocUrl: AutomergeUrl, repo: Repo) => Promise<void>;
};

export type LLMContextPlugin = Plugin<LLMContextDescription>;
export type LoadedLLMContext = LoadedPlugin<
  LLMContextDescription,
  LLMContextImplementation
>;
