import type { Heads } from '@automerge/automerge';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';

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
  subSpecUrls?: AutomergeUrl[];
};

export type SpecDoc = HasPatchworkMetadata & {
  spec: Spec;
};

export type Verification = {
  docUrl: AutomergeUrl;
  script: string;
};

// TODO: we treat running the verifications as a purely deterministic computation that is cheap to run
// we probably want a way to store the results that we can reference from the validation
export type PlanDoc = {
  goal: string;
  dependsOn: AutomergeUrl[];
  specDocUrl: AutomergeUrl;
  artifactsFolderUrl: AutomergeUrl;
};

export type ValidationDoc = {
  planDocUrl: AutomergeUrl;
  isValidated: boolean;
  headsByDocUrl: Record<AutomergeUrl, Heads>;
};
