import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PlanDoc, SpecDoc, WorkflowDoc } from './types';

export type { WorkflowDoc } from './types';

export const WorkflowDatatype: DatatypeImplementation<WorkflowDoc> = {
  init() {},
  getTitle() {
    return 'Workflow';
  },
  setTitle() {},
};

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
