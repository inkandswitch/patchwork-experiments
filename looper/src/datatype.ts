import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LooperDoc } from './types';

export const LooperDatatype: DatatypeImplementation<LooperDoc> = {
  init(doc: LooperDoc) {
    doc['@patchwork'] = { type: 'looper' };
    doc.title = 'Untitled';
    doc.layers = [];
  },
  getTitle(doc: LooperDoc) {
    return doc.title?.trim() || 'Looper';
  },
  setTitle(doc: LooperDoc, title: string) {
    doc.title = title.trim();
  },
};