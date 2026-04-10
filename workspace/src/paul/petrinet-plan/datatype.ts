import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PetriNetPlanDoc } from './types';

export const PetriNetPlanDatatype: DatatypeImplementation<PetriNetPlanDoc> = {
  init(doc) {
    doc['@patchwork'] = { type: 'petrinet-plan' };
    doc.initialTokens = [];
  },

  getTitle() {
    return 'Petri Net Plan';
  },

  setTitle() {},
};
