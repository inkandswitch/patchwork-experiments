import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PetriNetPlanDoc } from './types';

export const PetriNetPlanDatatype: DatatypeImplementation<PetriNetPlanDoc> = {
  init(doc) {
    doc['@patchwork'] = { type: 'petrinet-plan' };
    doc.tokens = {
      problems: [],
      optimizer_idle: [],
      optimizer_running: [],
      solutions: [],
      evaluator_idle: [],
      evaluator_running: [],
    };
  },

  getTitle() {
    return 'Petri Net Plan';
  },
};
