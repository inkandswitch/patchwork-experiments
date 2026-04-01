import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { SpecCollectionDoc } from '../types';

export type { SpecCollectionDoc, SpecDoc, Verification } from '../types';

export const SpecDatatype: DatatypeImplementation<SpecCollectionDoc> = {
  init(doc: SpecCollectionDoc) {
    doc.specs = [];
  },
  getTitle(doc: SpecCollectionDoc) {
    return doc.specs?.[0]?.goal || 'Spec Collection';
  },
  setTitle(doc: SpecCollectionDoc, title: string) {
    if (doc.specs?.[0]) {
      doc.specs[0].goal = title;
    }
  },
};
