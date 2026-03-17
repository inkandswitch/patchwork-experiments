import type { AutomergeUrl } from '@automerge/automerge-repo';

export type LLMDoc = {
  '@patchwork': { type: 'llm' };
  config: {
    apiUrl: string;
    model: string;
    api?: string;
  };
  docUrl?: AutomergeUrl;
  workspaceUrl?: AutomergeUrl;
  skillsFolderUrl?: AutomergeUrl;
  prompt: string;
  output: OutputBlock[];
  previousMessages?: ChatMessage[];
  /** Set to true by the caller when runLLMProcess() resolves. */
  done?: boolean;
};

export type LLMChatDoc = {
  '@patchwork': { type: 'llm-chat' };
  config: {
    apiUrl: string;
    model: string;
    api?: string;
  };
  workspaceUrl?: AutomergeUrl;
  runs: AutomergeUrl[];
};

export type LLMWorkspaceDoc = {
  '@patchwork': { type: 'llm-workspace' };
  title: string;
  urls: AutomergeUrl[];
};

export type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string; description?: string; output?: string; error?: string };

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; description?: string; complete: boolean };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
