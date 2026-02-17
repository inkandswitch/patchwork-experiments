import type { AutomergeUrl } from '@automerge/automerge-repo';

// --- WorkspaceDoc schema ---

export type WorkspaceDoc = {
  rootFolderUrl: AutomergeUrl;
  mappings: Record<string, AutomergeUrl>; // originalUrl → clonedUrl
  linkedUrls: AutomergeUrl[]; // docs linked into workspace (not created) — excluded from changeset unless modified
};

// --- LLMProcessDoc schema ---

export type LLMProcessDoc = {
  title: string;
  config: {
    apiUrl: string; // OpenAI-compatible endpoint
    model: string; // e.g. "gpt-4o"
  };
  rootFolderUrl: AutomergeUrl; // The folder this process can access
  workspaceUrl: AutomergeUrl; // Points to the WorkspaceDoc for COW
  runs: TaskRun[]; // All task runs, most recent last
};

export type TaskRun = {
  task: string; // The user's instruction
  output: OutputBlock[]; // Appended as the LLM process runs
  timestamp: number;
};

export type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string }
  | { type: 'result'; output?: string; error?: string };

// --- Parser types ---

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; complete: boolean };
