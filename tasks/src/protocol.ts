import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { TaskQueueSet } from './datatype';
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
  | TerminateMessage
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
  taskQueues: TaskQueueSet;
  /**
   * False when this worker's host would rather it wasn't given work just now
   * (see availability.ts). Missing from a pool that predates the choice, which
   * is always available.
   */
  available?: boolean;
}

export interface RouterHeartbeatMessage extends Stamp {
  type: 'router heartbeat';
  routerUrl: AutomergeUrl;
  workerUrls: AutomergeUrl[];
  /** Those of `workerUrls` whose hosts have asked not to be given work just now. */
  pausedWorkerUrls?: AutomergeUrl[];
};

export interface WorkOnTaskMessage extends Stamp {
  type: 'work on';
  taskUrl: AutomergeUrl;
  taskQueueUrl: AutomergeUrl;
}
