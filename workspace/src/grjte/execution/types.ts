import { AutomergeUrl } from '@automerge/automerge-repo';
import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins/dist/datatypes';
import { ExecutionDoc } from '../../workflow/types';

export type TaskListExecutionDoc = ExecutionDoc & {
  taskUrls: AutomergeUrl[];
  status: 'in-progress' | 'failed' | 'completed';
};

export const TaskListExecutionDatatype: DatatypeImplementation<TaskListExecutionDoc> = {
  init() {},
  getTitle(doc: TaskListExecutionDoc) {
    return doc.status ? `Execution (${doc.status})` : 'Execution';
  },
  setTitle() {},
};
