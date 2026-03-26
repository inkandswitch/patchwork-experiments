import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LLMPetriNetDoc } from './types';

export const LLMPetriNetDatatype: DatatypeImplementation<LLMPetriNetDoc> = {
  init(doc) {
    doc.tokens = {
      problems: [],
      optimizer_idle: [],
      optimizer_running: [],
      solutions: [],
      evaluator_idle: [],
      evaluator_running: [],
    };
    // TODO: create default system prompt docs once the generic task shape is known
  },

  getTitle() {
    return 'LLM Petri Net';
  },
};
