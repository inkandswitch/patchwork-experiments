import type { AutomergeUrl } from '@automerge/automerge-repo';

export type WorkflowDoc = {
  specElicitationDocUrl: AutomergeUrl;
  specDocUrl: AutomergeUrl;
  planDocUrl: AutomergeUrl;
  executionDocUrl: AutomergeUrl;
  validationDocUrl: AutomergeUrl;
};

export type SpecElicitationDoc = {
  prompt: string;
  referenceDocsFolderUrl: AutomergeUrl;
};

// TODO: have a structured way to actually specify what kind of document we want
// right now we just use the goal to describe this
export type Spec = {
  goal: string;
  verificationUrls: AutomergeUrl[];
  subSpecs?: Spec[];
};

export type Verification = {
  docsFolderUrl: AutomergeUrl;
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
