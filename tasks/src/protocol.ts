import type { AutomergeUrl } from '@automerge/automerge-repo/slim';

export type MessageToWorkerPoolProxy =
  // sent by workers
  | {
    type: 'add worker',
    sharedWorkerName: string;
    workerUrl: AutomergeUrl;
  };

export type MessageToWorkerPool =
  // sent by the app (worker pool proxy)
  | {
    type: 'init';
    repoPort: MessagePort;
    contactUrl: AutomergeUrl;
  }
  | {
    type: 'join';
    taskQueueUrl: AutomergeUrl;
  }
  | {
    // this message is forwarded by the worker pool proxy to the worker pool
    // (when the worker pool proxy receives it from a worker)
    type: 'add worker';
    sharedWorkerName: string;
    workerUrl: AutomergeUrl;
  };

export type MessageToRouter =
  // sent by the app (worker pool proxy)
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
  // sent by the app (worker pool proxy)
  {
    type: 'init';
    repoPort: MessagePort;
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
