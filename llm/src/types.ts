import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { Heads } from '@automerge/automerge';

export type LLMDoc = {
  '@patchwork': { type: 'llm' };
  config: {
    apiUrl: string;
    model: string;
  };
  workspaceUrl?: AutomergeUrl;
  /** When set, used as the system prompt verbatim (no skills/workspace appended). Used by runLLMProcessRaw. */
  systemPrompt?: string;
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

export type WorkspaceEntry = {
  url: AutomergeUrl;
  changedAt: Heads | null;
};

export type LLMWorkspaceDoc = {
  '@patchwork': { type: 'llm-workspace' };
  title: string;
  entries: Record<string, WorkspaceEntry>;
};

export type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string; description?: string; output?: string; error?: string };

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; description?: string; complete: boolean };

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
};
