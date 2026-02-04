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
    importMap: any,
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

  private initializeWorker(workerId: number, importMap: any, baseURI: string) {
    // (It doesn't matter if this messgage is sent more than once.)
    const worker = this.workers.get(workerId)!;
    const repoPort = (window as any).getRepoChannel();
    const { port1: workerPoolPort, port2: workerPort } = new MessageChannel();
    const contactUrl = this.contactUrl;
    console.log('initializing worker', { workerId });
    try {
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
    } catch (e1) {
      console.error('Failed to initialize worker', { workerId, e: e1 });
      throw e1;
    }
    console.log('telling worker pool about worker', { workerId });
    try {
      this.workerPool.port.postMessage(
        {
          type: 'listen to worker',
          workerId,
          workerPort,
        } satisfies MessageToWorkerPool,
        [workerPort],
      );
    } catch (e2) {
      console.error('Failed to register worker with worker pool', { workerId, e: e2 });
      throw e2;
    }
  }

  joinTaskQueue(taskQueueUrl: AutomergeUrl) {
    let router = this.routers.get(taskQueueUrl);
    if (router) {
      return;
    }

    // TODO: remove this once we have a doc w/ all the URLs that the worker pool can pay attention to
    this.workerPool.port.postMessage({ type: 'join', taskQueueUrl } satisfies MessageToWorkerPool);

    // Create a router (SharedWorker) for this task queue if our browser doesn't have one already.
    // (If another window or tab already created one, we'll just get that one.)
    router = new TaskRouter({ name: `task-router-${taskQueueUrl}` });
    this.routers.set(taskQueueUrl, router);

    // Initialize the router -- it's OK even if the `new TaskRouter(...)` above didn't create a new one.
    const repoPort = (window as any).getRepoChannel();
    const contactUrl = this.contactUrl;
    router.port.start();
    router.port.postMessage(
      {
        type: 'init',
        repoPort,
        contactUrl,
        taskQueueUrl,
      } satisfies MessageToRouter,
      [repoPort],
    );
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
