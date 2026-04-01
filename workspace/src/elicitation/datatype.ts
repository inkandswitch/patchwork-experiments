import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { ElicitationDoc } from '../types';

export type { ElicitationDoc } from '../types';

export const ElicitationDatatype: DatatypeImplementation<ElicitationDoc> = {
  init(doc: ElicitationDoc) {
    doc.prompt = '';
  },
  getTitle(doc: ElicitationDoc) {
    return doc.prompt?.slice(0, 50) || 'Elicitation';
  },
  setTitle(doc: ElicitationDoc, title: string) {
    doc.prompt = title;
  },
};
