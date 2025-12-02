import { HasVersionControlMetadata } from '@patchwork/sdk/versionControl';
import { type DataTypeImplementation } from '@patchwork/sdk';
import { AutomergeUrl } from '@automerge/automerge-repo';

// Task

export type Task<Input, Result> = {
  input: Input;
  importUrl: string;
  runs: RunInfo<Result>[];
};

export type TaskDoc<Input, Result> = HasVersionControlMetadata<unknown, unknown> &
  Task<Input, Result>;

export type RunInfo<Result> = {
  runner: string;
  status: 'succeeded' | 'failed';
  result?: Result; // only if status === 'succeeded'
  log?: [number, string][];
  startTime: number;
  endTime: number;
};

export const taskDatatype: DataTypeImplementation<TaskDoc<any, any>, unknown> = {
  init(doc: TaskDoc<any, any>) {
    doc.input = null;
    doc.importUrl = '';
    doc.runs = [];
  },
  async getTitle(_doc: TaskDoc<any, any>) {
    return 'Task';
  },
  async setTitle(_doc: TaskDoc<any, any>, _title: string) {
    // no op
  },
  markCopy(_doc: TaskDoc<any, any>) {
    // no op
  },
};

// Task Queue

export type TaskQueue = {
  title?: string;
  inputExpr?: string; // text field for input expression
  code?: string; // text field for task code
  pending: AutomergeUrl[]; // ids of task documents
  done: AutomergeUrl[]; // ids of task documents
};

export type TaskQueueDoc = HasVersionControlMetadata<unknown, unknown> & TaskQueue;

export const taskQueueDatatype: DataTypeImplementation<TaskQueueDoc, unknown> = {
  init(doc: TaskQueueDoc) {
    doc.pending = [];
    doc.done = [];
    doc.inputExpr = `[
  Math.floor(Math.random() * 10) + 1,
  Math.floor(Math.random() * 10) + 1
]`;
    doc.code = `export default async function ([x, y]) {
  await seconds(Math.random() * 3);
  if (Math.random() < 0.1) { throw new Error("Oh no!") }
  return x + y;
}
  
async function seconds(s) {
  return new Promise((resolve) => {
    setTimeout(resolve, s * 1000);
  });
}
`;
  },
  async getTitle(doc: TaskQueueDoc) {
    // the fact that this is async makes it not so useful in react, no?
    return doc.title ?? 'Task Queue';
  },
  async setTitle(doc: TaskQueueDoc, title: string) {
    doc.title = title;
  },
  markCopy(doc: TaskQueueDoc) {
    doc.title = 'Copy of ' + this.getTitle(doc, null as any);
  },
};

// Runner

export type Runner = {
  name: string;
  contactUrl: AutomergeUrl | null;
  currentTask: AutomergeUrl | null;
};

export type RunnerDoc = HasVersionControlMetadata<unknown, unknown> & Runner;
