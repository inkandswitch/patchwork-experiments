import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { Heads } from '@automerge/automerge';

export type DocumentEntry = {
  cloneUrl: AutomergeUrl;
  originalHeads?: Heads;
};

export type Verification = {
  documentUrls: Record<string, AutomergeUrl>;
  name: string;
  script: string;
};

export type SpecCollectionDoc = {
  specs: SpecDoc[];
};

export type SpecDoc = {
  goal: string;
  docs: Record<string, AutomergeUrl>;
  requiredDocs: string[];
  verifications: Verification[];
};

export type PlanDoc = {
  tasks: AutomergeUrl[];
};

export type TaskDoc = {
  goal: string;
  dependsOn: AutomergeUrl[];
  artifacts: Record<string, AutomergeUrl>;
  specDocUrl: AutomergeUrl;
};

export type WorkspaceDoc = {
  documents: Record<string, DocumentEntry>;
};

export type WorkspaceChatDoc = {
  specCollectionDocUrl?: AutomergeUrl;
  planDocUrl?: AutomergeUrl;
  llmProcessUrl?: AutomergeUrl;
  prompt: string;
};
