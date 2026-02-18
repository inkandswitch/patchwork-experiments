import type { AutomergeUrl } from '@automerge/automerge-repo';

// --- WorkspaceDoc schema ---

export type MappingEntry = {
  cloneUrl: AutomergeUrl;
  originalUrlWithHeads: AutomergeUrl; // original URL with heads at clone time baked in
};

export type WorkspaceDoc = {
  rootFolderUrl: AutomergeUrl;
  mappings: Record<string, MappingEntry>; // originalUrl → { cloneUrl, originalUrlWithHeads }
  createdUrls: AutomergeUrl[]; // new files created by the agent — shown as "added" in changeset
};

// --- LLMProcessDoc schema ---

export type LLMProcessDoc = {
  title: string;
  config: {
    apiUrl: string; // OpenAI-compatible endpoint
    model: string; // e.g. "gpt-4o"
  };
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
  | { type: 'script'; code: string; description?: string; output?: string; error?: string };

// --- Parser types ---

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; description?: string; complete: boolean };
