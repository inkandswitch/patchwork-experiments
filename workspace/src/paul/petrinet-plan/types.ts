import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { NetState, TokenState } from './lib';

// Initial token definition (what will be created on Start)
export type InitialToken = {
  placeId: string;
  state: TokenState;
};

// Plan document - the definition and initial configuration
export type PetriNetPlanDoc = {
  '@patchwork': { type: 'petrinet-plan' };
  initialTokens: InitialToken[];
};

// Execution document - the runtime state
export type PetriNetExecutionDoc = {
  '@patchwork': { type: 'petrinet-execution' };
  planUrl: AutomergeUrl;
  tokens: NetState;
};
