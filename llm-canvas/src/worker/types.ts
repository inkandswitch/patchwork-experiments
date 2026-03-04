import type { AutomergeUrl } from '@automerge/automerge-repo';

export type WorkerToken = {
  type: 'document' | 'tool';
  url: AutomergeUrl;
  name: string;
  path?: string;
};

export type WorkerDoc = {
  title: string;
  config: {
    apiUrl: string;
    model: string;
    skillsFolderUrl?: AutomergeUrl;
  };
  workspaceUrl: AutomergeUrl;
  prompt: string;
  processUrls: AutomergeUrl[];
  runMode: "auto" | "manual";
  autoInterval: number;
  inputTokens: WorkerToken[];
  outputTokens: WorkerToken[];
};
