import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { WorkflowDoc } from './types';

export type { WorkflowDoc } from './types';

export const WorkflowDatatype: DatatypeImplementation<WorkflowDoc> = {
  init() {},
  getTitle() {
    return 'Workflow';
  },
  setTitle() {},
};
