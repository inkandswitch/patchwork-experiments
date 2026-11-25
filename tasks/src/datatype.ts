// A queue, as a Patchwork datatype, and the types of the task system's two
// documents. What they hold, and what may be read from them, is
// task-rules.js's: the types are its. A task is not a datatype here: it is
// made by `ask` (task-client.js), never from Patchwork's list of new documents.

import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Queue } from './task-rules.js';

export type { Entry, LogLine, Queue, Run, RunStatus, Task, TaskState } from './task-rules.js';

export const TaskQueueDatatype: DatatypeImplementation<Queue> = {
  init(doc: Queue) {
    doc.jobs = {};
  },
  getTitle(doc: Queue) {
    return doc.title ?? 'Task Queue';
  },
  setTitle(doc: Queue, title: string) {
    doc.title = title;
  },
};
