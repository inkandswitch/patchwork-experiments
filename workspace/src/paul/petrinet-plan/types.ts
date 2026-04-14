import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { NetState, TokenState } from './lib';

export type InitialToken = {
  placeId: string;
  state: TokenState;
};

export type SystemPromptUrls = {
  optimizer?: string;
};

export type CandidateDoc = {
  '@patchwork': { type: 'candidate' };
  specUrl: string;
  documentsFolderUrl: string;
};

export type PetriNetPlanDoc = {
  '@patchwork': { type: 'petrinet-plan' };
  initialTokens: InitialToken[];
  systemPromptUrls?: SystemPromptUrls;
};

export type PetriNetExecutionDoc = {
  '@patchwork': { type: 'petrinet-execution' };
  planUrl: AutomergeUrl;
  specDocUrl: AutomergeUrl;
  artifactsFolderUrl: AutomergeUrl;
  tokens: NetState;
};
