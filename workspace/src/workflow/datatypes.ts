import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type {
  PlanDoc,
  SpecDoc,
  ExecutionDoc,
  ValidationDoc,
  VerificationContextDoc,
  WorkflowDoc,
} from './types';

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

export const PlanDatatype: DatatypeImplementation<PlanDoc> = {
  init() {},
  getTitle(doc: PlanDoc) {
    return doc.goal || 'Plan';
  },
  setTitle(doc: PlanDoc, title: string) {
    doc.goal = title;
  },
};

export const VerificationContextDatatype: DatatypeImplementation<VerificationContextDoc> = {
  init() {},
  getTitle() {
    return 'Verification Context';
  },
  setTitle() {},
};

export const ExecutionDatatype: DatatypeImplementation<ExecutionDoc> = {
  init() {},
  getTitle() {
    return 'Execution';
  },
  setTitle() {},
};

export const ValidationDatatype: DatatypeImplementation<ValidationDoc> = {
  init() {},
  getTitle(doc: ValidationDoc) {
    return 'Validation for ' + doc.planDocUrl;
  },
  setTitle() {},
};
