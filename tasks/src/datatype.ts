// The task system's two documents, as Patchwork datatypes. What they hold,
// and what may be read from them, is task-rules.js's: the types are its.

import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Queue, Task } from './task-rules.js';

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

export const taskDatatype: DatatypeImplementation<Task> = {
  init(doc: Task) {
    doc.importUrl = '';
    doc.input = null;
    doc.key = '';
    doc.runs = [];
  },
  getTitle(doc: Task) {
    return doc.title ?? '';
  },
  setTitle(doc: Task, title: string) {
    doc.title = title;
  },
};
