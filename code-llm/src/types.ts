import type { AutomergeUrl } from "@automerge/automerge-repo";

// --- LLMProcessDoc schema ---

export type LLMProcessDoc = {
  title: string;
  config: {
    apiUrl: string; // OpenAI-compatible endpoint
    model: string; // e.g. "gpt-4o"
  };
  rootFolderUrl: AutomergeUrl; // The folder this process can access
  runs: TaskRun[]; // All task runs, most recent last
};

export type TaskRun = {
  task: string; // The user's instruction
  output: OutputBlock[]; // Appended as the LLM process runs
  timestamp: number;
};

export type OutputBlock =
  | { type: "text"; content: string }
  | { type: "script"; code: string }
  | { type: "result"; output?: string; error?: string };

// --- Parser types ---

export type ParsedBlock =
  | { type: "text"; content: string }
  | { type: "script"; code: string };
