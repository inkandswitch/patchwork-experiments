import type { AutomergeUrl } from '@automerge/automerge-repo';

export type LLMProcessDoc = {
  config: {
    apiUrl: string;
    model: string;
  };
  llmConfigFolderUrl: AutomergeUrl;
  workspaceUrl: AutomergeUrl;
  messages: ChatMessage[];
  done: boolean;
};

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; description?: string; complete: boolean };

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'script'; code: string; description?: string; output?: string; error?: string };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: ChatMessagePart[];
};
