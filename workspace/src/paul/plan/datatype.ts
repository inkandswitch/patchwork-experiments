import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PlanDoc } from '../../types';

export type { PlanDoc, TaskDoc } from '../../types';

export const PlanDatatype: DatatypeImplementation<PlanDoc> = {
  init(doc: PlanDoc) {
    doc.tasks = [];
  },
  getTitle() {
    return 'Plan';
  },
};
