import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PyonpyonDoc } from './types';

export const PyonpyonDatatype: DatatypeImplementation<PyonpyonDoc> = {
  init(doc: PyonpyonDoc) {
    doc['@patchwork'] = { type: 'pyonpyon' };
    doc.title = 'Untitled';
  },
  getTitle(doc: PyonpyonDoc) {
    return doc.title?.trim() || 'Pyonpyon';
  },
};
