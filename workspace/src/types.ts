import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { Heads } from '@automerge/automerge';

export type WorkspaceDoc = {
  name: string;
  documents: Record<AutomergeUrl, { cloneUrl: AutomergeUrl; originalHeads: Heads }>;
};

export type Verification = {
  name: string;
  script: string;
};

export type SpecDoc = WorkspaceDoc & {
  goalDocUrl: AutomergeUrl;
  verifications: Verification[];
};

export type PlanDoc = WorkspaceDoc & {
  tasks: Task[];
};

export type Task = {
  id: string;
  name: string;
  dependendsOn: string[];
  verifications: Verification[];
};

export type WorkspaceChatDoc = {
  workspaceUrl: AutomergeUrl;
  llmProcessUrl?: AutomergeUrl;
  prompt: string;
};
