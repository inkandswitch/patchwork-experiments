import type { NetState } from './lib';

export type PetriNetPlanDoc = {
  '@patchwork': { type: 'petrinet-plan' };
  tokens: NetState;
};
