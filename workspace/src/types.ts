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
  verifications: Verification[];
};

export type TaskDoc = {
  dependsOn: AutomergeUrl[];
  docs: Record<string, AutomergeUrl>;
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
