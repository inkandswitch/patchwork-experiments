import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { SpecDoc } from '../workflow/types';

export type { SpecDoc, Spec } from '../workflow/types';

export const SpecDatatype: DatatypeImplementation<SpecDoc> = {
  init(doc: SpecDoc) {
    doc.spec = {
      goal: '',
      verificationUrls: [],
    };
  },
  getTitle(doc: SpecDoc) {
    return doc.spec?.goal || 'Spec';
  },
  setTitle(doc: SpecDoc, title: string) {
    if (doc.spec) {
      doc.spec.goal = title;
    }
  },
};
