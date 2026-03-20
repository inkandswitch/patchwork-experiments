import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LLMPetriNetDoc } from './types';

export const LLMPetriNetDatatype: DatatypeImplementation<LLMPetriNetDoc> = {
  init(doc) {
    doc.tokens = {
      problems: [],
      optimizer: [],
      evaluators: [],
      solutions: [],
    };
    // TODO: create default system prompt docs once the generic task shape is known
  },

  getTitle() {
    return 'LLM Petri Net';
  },
};
