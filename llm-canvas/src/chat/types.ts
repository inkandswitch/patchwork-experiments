import type { AutomergeUrl } from '@automerge/automerge-repo';

export type ChatDoc = {
  title: string;
  config: {
    apiUrl: string;
    model: string;
    skillsFolderUrl?: AutomergeUrl;
  };
  workspaceUrl: AutomergeUrl;
  processUrls: AutomergeUrl[];
};
