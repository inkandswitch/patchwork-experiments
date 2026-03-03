import type { AutomergeUrl } from '@automerge/automerge-repo';

export type ProcessDoc = {
  title: string;
  config: {
    apiUrl: string;
    model: string;
    skillsFolderUrl?: AutomergeUrl;
  };
  workspaceUrl: AutomergeUrl;
  history?: string;
  prompt: string;
  output: OutputBlock[];
  timestamp: number;
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
