import type { Heads } from '@automerge/automerge';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';

export type WorkflowToolIds = {
  elicitation?: string;
  spec?: string;
  plan?: string;
  execution?: string;
  validation?: string;
};

export type WorkflowDoc = {
  specElicitationDocUrl: AutomergeUrl;
  specDocUrl: AutomergeUrl;
  planDocUrl: AutomergeUrl;
  executionDocUrl: AutomergeUrl;
  validationDocUrl: AutomergeUrl;
  toolIds?: WorkflowToolIds;
};

export type SpecElicitationDoc = {
  prompt: string;
  referenceDocsFolderUrl: AutomergeUrl;
};

// TODO: have a structured way to actually specify what kind of document we want
// right now we just use the goal to describe this
export type Spec = {
  goal: string;
  // a folder containing documents with formalized input data
  dataFolderUrl?: AutomergeUrl;
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

export type PlanDoc = HasPatchworkMetadata & {
  goal: string;
  specDocUrl: AutomergeUrl;
};

export type VerificationContextDoc = HasPatchworkMetadata & {
  verificationUrl: AutomergeUrl;
  artifactUrls: AutomergeUrl[];
};

export type ExecutionDoc = HasPatchworkMetadata & {
  specDocUrl: AutomergeUrl;
  planDocUrl: AutomergeUrl;
  artifactsFolderUrl: AutomergeUrl;
  verificationContextUrls: AutomergeUrl[];
};

export type ValidationDoc = HasPatchworkMetadata & {
  planDocUrl: AutomergeUrl;
  specDocUrl: AutomergeUrl;
  executionDocUrl?: AutomergeUrl;
  isValidated: boolean;
  headsByDocUrl: Record<AutomergeUrl, Heads>;
};
