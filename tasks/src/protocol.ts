import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import type { RunLogEntry, TaskQueueSet } from './datatype';
import type { Stamp } from './delivery-stats';
import type { TabReport } from './availability';

export type MessageToWorkerPoolProxy =
  // sent by workers
  | RegisterWorkerMessage
  ;

export type MessageToWorkerPool =
  // sent by the app (worker pool proxy)
  | InitMessage
  | RegisterWorkerMessage // forwarded by the worker pool proxy when received from a worker
  | UpdateTaskQueueSetMessage
  | HostActivityMessage
  | TerminateMessage
  ;

export type MessageToRouter =
  // sent by the app (worker pool proxy)
  | InitMessage
  | UpdateTaskQueueSetMessage
  | TerminateMessage
  ;

export type MessageToRouterChannel =
  // sent by worker pools (one per worker) to the active router of each task queue
  | WorkerHeartbeatMessage
  ;

export type MessageToTaskQueueChannel =
  // sent by the active router
  | RouterHeartbeatMessage
  ;

export type MessageToWorker =
  // sent by the app (worker pool proxy)
  | WorkerInitMessage
  | UpdateTaskQueueSetMessage // a worker goes by it for whose code it runs (see acceptance.ts)
  | TerminateMessage
  ;

export type MessageToTaskChannel =
  // sent by the worker running the task
  | TaskProgressMessage
  ;

export type MessageToWorkerChannel =
  // sent by an active router
  | WorkOnTaskMessage
  ;

/**
 * What a shared worker needs to build a Repo of its own (see `getRepo` in
 * webworker-lib.ts). Only a tab can work it out, so it's sent along with `init`.
 */
export interface RepoConfig {
  /** The Subduction sync server this site's tabs are connected to. */
  syncServerUrl: string;
}

export interface InitMessage {
  type: 'init';
  repoConfig: RepoConfig;
  contactUrl: AutomergeUrl;
  importMap: any;
  baseURI: string;
}

export interface WorkerInitMessage extends InitMessage {}

export interface RegisterWorkerMessage {
  type: 'register worker';
  sharedWorkerName: string;
  workerUrl: AutomergeUrl;
}

export interface UpdateTaskQueueSetMessage {
  type: 'update task queue set';
  taskQueues: TaskQueueSet;
}

/** One tab's view of what its host is doing; see availability.ts. */
export interface HostActivityMessage {
  type: 'host activity';
  /** Which tab this is, so the pool keeps only the latest from each. */
  tabId: string;
  /** Null when the tab is going away. */
  report: TabReport | null;
}

export interface TerminateMessage {
  type: 'terminate';
}

export interface WorkerHeartbeatMessage extends Stamp {
  type: 'worker heartbeat';
  workerUrl: AutomergeUrl;
  currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
  /** The worker's `taskCount` as the pool had it when it sent this (see datatype.ts). */
  taskCount?: number;
  taskQueues: TaskQueueSet;
  /**
   * False when this worker's host would rather it wasn't given work just now
   * (see availability.ts). Missing from a pool that predates the choice, which
   * is always available.
   */
  available?: boolean;
  /** The pool's build and the protocol it speaks (see version.ts). */
  build?: number;
  protocol?: number;
}

export interface RouterHeartbeatMessage extends Stamp {
  type: 'router heartbeat';
  routerUrl: AutomergeUrl;
  workerUrls: AutomergeUrl[];
  /** Those of `workerUrls` whose hosts have asked not to be given work just now. */
  pausedWorkerUrls?: AutomergeUrl[];
  /** The router's build and the protocol it speaks (see version.ts). */
  build?: number;
  protocol?: number;
  /** The build each of `workerUrls` says it is, where it says. */
  workerBuilds?: Record<AutomergeUrl, number>;
  /** Those of `workerUrls` that speak another protocol than the router, and so get no work from it. */
  incompatibleWorkerUrls?: AutomergeUrl[];
};

/**
 * How a running task is going, said by its worker on the task doc's own
 * channel to whoever has the task open. Nothing is written for these: a
 * watcher that arrives late hears the next one.
 */
export interface TaskProgressMessage extends Stamp {
  type: 'task progress';
  /** The hand-out this is a run of: a watcher keeps what it hears to the run going on. */
  assignment: string;
  /** What the task's function last reported, if this message brings news of that. */
  progress?: unknown;
  /** Lines its function has logged since the last message. */
  logs?: RunLogEntry[];
}

export interface WorkOnTaskMessage extends Stamp {
  type: 'work on';
  taskUrl: AutomergeUrl;
  taskQueueUrl: AutomergeUrl;
  /** For a task asked for by key (see jobs.ts), the key. */
  key?: string;
}
