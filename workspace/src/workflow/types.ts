import { AutomergeUrl } from '@automerge/automerge-repo';

export type WorkflowDoc = {
  specElicitationDocUrl: AutomergeUrl;
};

export type SpecElicitationDoc = {
  prompt: string;
  docs: Record<string, AutomergeUrl>;
};

export type SpecCollectionDoc = {
  specs: SpecDoc[];
};

export type SpecDoc = {
  goal: string;
  docs: Record<string, AutomergeUrl>;
  requiredDocs: Record<string, string>;
  script: string;
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
