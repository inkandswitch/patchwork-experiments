import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { CandidateDoc } from './types';

export const CandidateDatatype: DatatypeImplementation<CandidateDoc> = {
  init(doc) {
    doc['@patchwork'] = { type: 'candidate' };
    doc.specUrl = '';
    doc.documents = {};
  },
  getTitle() {
    return 'Candidate';
  },
  setTitle() {},
};
