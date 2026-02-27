import type { AutomergeUrl } from '@automerge/automerge-repo';

// --- Entry types ---

export type DocReference = {
  name: string;
  url: AutomergeUrl;
  type: 'document';
};

export type ToolReference = {
  name: string;
  url: AutomergeUrl;
  path: string;
  type: 'tool';
};

export type EntryReference = DocReference | ToolReference;

// --- LLMProcessDoc schema ---

export type LLMProcessDoc = {
  title: string;
  config: {
    apiUrl: string;
    model: string;
    skillsFolderUrl?: AutomergeUrl;
  };
  entries: EntryReference[];
  runs: TaskRun[];
};

export type Attachment = {
  url: AutomergeUrl;
  name: string;
  type: string;
};

export type TaskRun = {
  task: string;
  attachments?: Attachment[];
  output: OutputBlock[];
  timestamp: number;
};

export type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string; description?: string; output?: string; error?: string };

// --- COW change tracking ---

export type CowChange = {
  originalUrl: AutomergeUrl;
  cloneUrl: AutomergeUrl;
  changeType: 'modified' | 'added';
  name: string;
  path?: string;
};

export type CowChanges = {
  getChanges(): CowChange[];
  mergeAll(): Promise<void>;
  mergeSingle(originalUrl: AutomergeUrl): Promise<void>;
  revertSingle(originalUrl: AutomergeUrl): void;
};

// --- Parser types ---

export type ParsedBlock =
  | { id: number; type: 'text'; content: string; complete: boolean }
  | { id: number; type: 'script'; code: string; description?: string; complete: boolean };

// --- LLM message types ---

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
