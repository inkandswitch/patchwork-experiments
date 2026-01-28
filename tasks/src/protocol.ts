import type { AutomergeUrl } from '@automerge/automerge-repo/slim';

export type MessageToWorkerPool =
  // sent by the app
  | {
      type: 'init';
      repoPort: MessagePort;
      contactUrl: AutomergeUrl;
    }
  // sent by workers
  // TODO: consider having the worker pool subscribe to changes in the worker docs, then this is not needed
  | {
      type: 'worker update';
      workerId: number;
      workerUrl: AutomergeUrl;
      currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
    };

export type MessageToRouter =
  // sent by the worker pool proxy
  | {
      type: 'init';
      repoPort: MessagePort;
      contactUrl: AutomergeUrl;
      taskQueueUrl: AutomergeUrl;
    }
  | {
      type: 'terminate';
    };

export type MessageToRouterChannel =
  // sent by worker pools (one per worker) to the active router of each task queue
  {
    type: 'worker heartbeat';
    workerUrl: AutomergeUrl;
    currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
  };

export type MessageToTaskQueueChannel =
  // sent by the active router
  {
    type: 'router heartbeat';
    routerUrl: AutomergeUrl;
    workerUrls: AutomergeUrl[];
  };

export type MessageToWorker =
  // sent by the worker pool proxy
  {
    type: 'init';
    repoPort: MessagePort;
    workerPoolPort: MessagePort;
    workerId: number;
    contactUrl: AutomergeUrl;
    importMap: any;
    baseURI: string;
  };

export type MessageToWorkerChannel =
  // sent by an active router
  {
    type: 'work on';
    taskUrl: AutomergeUrl;
    taskQueueUrl: AutomergeUrl;
  };
