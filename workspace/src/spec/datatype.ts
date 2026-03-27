import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { SpecDoc } from '../types';

export type { SpecDoc, Verification } from '../types';

export const SpecDatatype: DatatypeImplementation<SpecDoc> = {
  init(doc: SpecDoc) {
    doc.name = 'Untitled Spec';
    doc.documents = {} as any;
    doc.verifications = [];
  },
  getTitle(doc: SpecDoc) {
    return doc.name || 'Untitled Spec';
  },
  setTitle(doc: SpecDoc, title: string) {
    doc.name = title;
  },
};
