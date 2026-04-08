import { AutomergeUrl } from '@automerge/automerge-repo';
import { PlanDoc } from '../../workflow/types';
import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins/dist/datatypes';

export type TaskDoc = {
  goal: string;
  dependsOn: AutomergeUrl[];
  status?: 'pending' | 'in-progress' | 'failed' | 'completed';
};

export type TaskListPlanDoc = PlanDoc & {
  tasks: AutomergeUrl[];
};

export const TaskListPlanDatatype: DatatypeImplementation<TaskListPlanDoc> = {
  init() {},
  getTitle(doc: TaskListPlanDoc) {
    return doc.goal || 'Plan';
  },
  setTitle(doc: TaskListPlanDoc, title: string) {
    doc.goal = title;
  },
};

export const TaskDatatype: DatatypeImplementation<TaskDoc> = {
  init() {},
  getTitle(doc: TaskDoc) {
    return doc.goal || 'Task';
  },
  setTitle(doc: TaskDoc, title: string) {
    doc.goal = title;
  },
};
