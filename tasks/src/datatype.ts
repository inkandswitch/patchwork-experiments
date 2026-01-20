import { AutomergeUrl } from '@automerge/automerge-repo';

// Task

export type Task<Input, Result> = {
  input: Input;
  importUrl: string;
  runs: RunInfo<Result>[];
};

export type TaskDoc<Input, Result> = Task<Input, Result>;

export type RunInfo<Result> = {
  worker: AutomergeUrl;
  status: 'succeeded' | 'failed';
  result?: Result; // only if status === 'succeeded'
  log?: [number, string][];
  startTime: number;
  endTime: number;
};

export const taskDatatype: any = {
  init(doc: TaskDoc<any, any>) {
    doc.input = null;
    doc.importUrl = '';
    doc.runs = [];
  },
  getTitle(_doc: TaskDoc<any, any>) {
    return 'Task';
  },
  setTitle(_doc: TaskDoc<any, any>, _title: string) {
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
  router: AutomergeUrl | null; // id of the current router
  pending: AutomergeUrl[]; // ids of task documents
  // TODO: change done to { [AutomergeUrl]: true }
  done: AutomergeUrl[]; // ids of task documents
};

export type TaskQueueDoc = TaskQueue;

export const taskQueueDatatype: any = {
  init(doc: TaskQueueDoc) {
    doc.router = null;
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
  getTitle(doc: TaskQueueDoc) {
    // the fact that this is async makes it not so useful in react, no?
    return doc.title ?? 'Task Queue';
  },
  setTitle(doc: TaskQueueDoc, title: string) {
    doc.title = title;
  },
  markCopy(doc: TaskQueueDoc) {
    doc.title = 'Copy of ' + this.getTitle(doc, null as any);
  },
};

// Worker

export type Worker = {
  name: string;
  contactUrl: AutomergeUrl | null;
  currentTask: AutomergeUrl | null;
};

export type WorkerDoc = Worker;

export type WorkerStatus = {
  worker: AutomergeUrl;
  currentTask: AutomergeUrl | null;
};

export type MessageToWorker = { type: 'work on'; task: AutomergeUrl };

// Router

export type Router = {
  name: string;
  contactUrl: AutomergeUrl | null;
};

export type RouterDoc = Router;

export type RouterHeartbeat = {
  router: AutomergeUrl;
  workers: AutomergeUrl[];
};
