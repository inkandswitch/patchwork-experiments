import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PetriNetExecutionDoc } from './types';

export const PetriNetExecutionDatatype: DatatypeImplementation<PetriNetExecutionDoc> = {
  init(doc: PetriNetExecutionDoc) {
    doc.tokens = {};
  },
  getTitle() {
    return 'Petri Net Execution';
  },
  setTitle() {},
};
