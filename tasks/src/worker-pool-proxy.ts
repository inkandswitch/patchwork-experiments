import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { MessageToRouter, MessageToWorker, MessageToWorkerPool } from './protocol';

import WorkerPool from './worker-pool.ts?sharedworker';
import TaskWorker from './worker.ts?sharedworker';
import TaskRouter from './router.ts?sharedworker';

const NUM_WORKERS = 2;

export class WorkerPoolProxy {
  private readonly workerPool: SharedWorker;
  private readonly workers = new Map<number, SharedWorker>();
  private readonly routers = new Map<AutomergeUrl, SharedWorker>();

  constructor(
    readonly contactUrl: AutomergeUrl,
    importMap: ImportMap,
    baseURI: string,
  ) {
    this.workerPool = this.createWorkerPool();
    this.initializeWorkerPool();

    for (let workerId = 0; workerId < NUM_WORKERS; workerId++) {
      this.workers.set(workerId, this.createWorker(workerId));
      this.initializeWorker(workerId, importMap, baseURI);
    }
  }

  private createWorkerPool(): SharedWorker {
    const workerPool = new WorkerPool({ name: `task-worker-pool` });
    workerPool.onerror = (error) => {
      console.error('worker pool error:', error);
    };
    workerPool.port.start();
    return workerPool;
  }

  private initializeWorkerPool() {
    // (It doesn't matter if this messgage is sent more than once.)
    const contactUrl = this.contactUrl;
    const repoPort = (window as any).getRepoChannel();
    this.workerPool.port.postMessage(
      { type: 'init', contactUrl, repoPort: repoPort } satisfies MessageToWorkerPool,
      [repoPort],
    );
  }

  private createWorker(workerId: number) {
    const worker = new TaskWorker({ name: `task-worker-${workerId}` });
    worker.onerror = (error) => {
      console.error(`worker ${workerId} error:`, error);
    };
    worker.port.start();
    return worker;
  }

  private initializeWorker(workerId: number, importMap: ImportMap, baseURI: string) {
    // (It doesn't matter if this messgage is sent more than once.)
    const worker = this.workers.get(workerId)!;
    const repoPort = (window as any).getRepoChannel();
    const workerPoolPort = this.workerPool.port; // TODO: fix this (need to create a new MessageChannel, etc.)
    const contactUrl = this.contactUrl;
    worker.port.postMessage(
      {
        type: 'init',
        repoPort,
        workerPoolPort,
        workerId,
        contactUrl,
        importMap,
        baseURI,
      } satisfies MessageToWorker,
      [repoPort, workerPoolPort],
    );
  }

  joinTaskQueue(taskQueueUrl: AutomergeUrl) {
    let router = this.routers.get(taskQueueUrl);
    if (router) {
      return;
    }

    // create it
    router = new TaskRouter({ name: `task-router-${taskQueueUrl}` });
    this.routers.set(taskQueueUrl, router);

    // initialize it (doesn't matter if this message is sent more than once)
    const repoPort = (window as any).getRepoChannel();
    const contactUrl = this.contactUrl;
    router.port.postMessage({
      type: 'init',
      repoPort,
      contactUrl,
      taskQueueUrl,
    } satisfies MessageToRouter);
  }

  leaveTaskQueue(taskQueueUrl: AutomergeUrl) {
    const router = this.routers.get(taskQueueUrl);
    if (!router) {
      return;
    }

    this.routers.delete(taskQueueUrl);
    router.port.postMessage({
      type: 'terminate',
    } satisfies MessageToRouter);
  }
}
