import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { QueueSetting } from './acceptance';

// Task Queue

export interface TaskQueueDoc {
  title?: string;
  activeRouter: AutomergeUrl | null;
  pending: AutomergeUrl[];
  done: AutomergeUrl[];
  doneSet: { [key: AutomergeUrl]: true };
  /**
   * Tasks asked for by key (see jobs.ts). Missing from a queue made before
   * there were any; the first task asked of such a queue by key writes it.
   */
  jobs?: { [key: string]: JobEntry };
}

/**
 * A task asked for by key, as its queue lists it. Everything about the task
 * itself is in its own doc; this is what a router goes by.
 */
export interface JobEntry {
  taskUrl: AutomergeUrl;
  /** When it was asked for, by the asker's clock: only for the order tasks are handed out in. */
  askedAt: number;
  /**
   * The package its code is in (see import-url.ts), or null for code that is
   * in none: here so a router can tell which workers will take it without
   * opening the task.
   */
  package?: string | null;
  /** Finished with: nothing more is to be handed out for this key. */
  done?: true;
}

export const TaskQueueDatatype: DatatypeImplementation<TaskQueueDoc> = {
  init(doc: TaskQueueDoc) {
    doc.activeRouter = null;
    doc.pending = [];
    doc.done = [];
    doc.doneSet = {};
    doc.jobs = {};
  },
  getTitle(doc: TaskQueueDoc) {
    return doc.title ?? 'Task Queue';
  },
  setTitle(doc: TaskQueueDoc, title: string) {
    doc.title = title;
  },
};

// Task

export interface TaskDoc<Input, Result> {
  title?: string;
  input: Input;
  importUrl: string;
  runs: RunInfo<Result>[];

  // The rest is newer than the task framework's first builds (see jobs.ts),
  // and missing from tasks they made or ran.

  /** Its key in its queue's `jobs`, if it was asked for by key. */
  key?: string;
  /** Someone has asked for it to stop. Never unset: a cancelled task is finished with. */
  cancelled?: true;
  /** The run going on now, written as it starts and taken away as it ends. */
  current?: CurrentRun | null;
  /**
   * How it ended for good, written with the run that ended it: it succeeded,
   * was cancelled while running, or failed as often as a task may.
   */
  outcome?: RunStatus;
}

/** A run in progress. How it is going is said on the task doc's channel (see `TaskProgressMessage`). */
export interface CurrentRun {
  workerUrl: AutomergeUrl;
  /** The hand-out this run answers (see `assignmentId` in claims.ts). */
  assignment: string;
  startTimeMillis: number;
}

export interface RunInfo<Result> {
  workerUrl: AutomergeUrl;
  status: RunStatus;
  result?: Result; // only if status === 'succeeded'
  logs?: RunLogEntry[];
  startTimeMillis: number;
  endTimeMillis: number;
}

export type RunStatus = 'succeeded' | 'failed' | 'cancelled';

export interface RunLogEntry {
  timestampMillis: number;
  message: string;
}

export const taskDatatype: DatatypeImplementation<TaskDoc<any, any>> = {
  init(doc: TaskDoc<any, any>) {
    doc.input = null;
    doc.importUrl = '';
    doc.runs = [];
  },
  getTitle(doc: TaskDoc<any, any>) {
    return doc.title ?? '';
  },
  setTitle(doc: TaskDoc<any, any>, title: string) {
    doc.title = title;
  },
};

// Worker

export interface WorkerDoc {
  name: string;
  contactUrl: AutomergeUrl;
  /**
   * What it is running. For a job, with the key it was listed under: that is
   * how a router, even one that has only just taken the queue over, knows not
   * to hand out another task for the same key meanwhile (see jobs.ts).
   */
  currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl; key?: string } | null;
  /**
   * How many tasks it has taken on, the one it is on included: one more with
   * each change that sets `currentTask`. It puts what is said of the worker
   * in order. A pool's heartbeat repeats the worker's doc as the pool last
   * had it, and reaches a router by another road than the doc does; with the
   * count on both, the router can tell which of the two is the later word
   * (see `heardRunning` in claims.ts). Missing from a worker that predates it.
   */
  taskCount?: number;
  /**
   * The hand-out (see `assignmentId` in claims.ts) this worker last finished,
   * whether the task succeeded, failed, or couldn't be loaded. It tells the
   * router the worker is free the moment it is.
   *
   * `done` says the task is finished with: the worker has moved it out of its
   * queue's pending list. The router usually hears this before it sees the
   * queue change, and without it would hand the same task straight out again.
   */
  lastFinished?: { assignment: string; done: boolean } | null;
  /**
   * Whose code this worker runs from each queue it works on (see
   * acceptance.ts): `any`, or the packages. Written by the worker itself, so
   * what a router believes of it is what it said. Missing from a worker that
   * predates the choice, which runs whatever it's handed.
   */
  accepts?: { [taskQueueUrl: AutomergeUrl]: 'any' | string[] };
}

// Router

export interface RouterDoc {
  name: string;
  contactUrl: AutomergeUrl;
}

/**
 * The queues a browser's (or a process's) workers work on, and whose code
 * they run from each (see acceptance.ts).
 */
export type TaskQueueSet = Record<AutomergeUrl, QueueSetting>;
