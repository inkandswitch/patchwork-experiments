import type { AutomergeUrl } from '@automerge/automerge-repo';

// --- Workspace entry types ---

export type DocReference = {
  name: string;
  url: AutomergeUrl;
  type: 'document';
};

export type ToolReference = {
  name: string;
  url: AutomergeUrl; // the folder doc containing the tool
  path: string; // file within the folder, e.g. "tool.js"
  type: 'tool';
};

export type WorkspaceEntry = DocReference | ToolReference;

// --- COW overlay ---

export type MappingEntry = {
  cloneUrl: AutomergeUrl;
  originalUrlWithHeads: AutomergeUrl;
};

// --- WorkspaceDoc schema ---

export type WorkspaceDoc = {
  entries: WorkspaceEntry[];
  mappings: Record<string, MappingEntry>;
  createdUrls: AutomergeUrl[];
};

// --- LLMProcessDoc schema ---

export type LLMProcessDoc = {
  title: string;
  config: {
    apiUrl: string;
    model: string;
  };
  workspaceUrl: AutomergeUrl;
  runs: TaskRun[];
};

export type TaskRun = {
  task: string;
  output: OutputBlock[];
  timestamp: number;
};

export type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string; description?: string; output?: string; error?: string };

// --- Parser types ---

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; description?: string; complete: boolean };
