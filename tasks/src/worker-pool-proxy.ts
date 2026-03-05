import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { MessageToRouter, MessageToWorker, MessageToWorkerPool } from './protocol';

import { MessageChannelNetworkAdapter, Repo } from '@automerge/vanillajs';
import { getAccountHandle, getTaskQueues, type TaskQueues } from './helpers';

import WorkerPool from './worker-pool.ts?sharedworker';
import TaskWorker from './worker.ts?sharedworker';
import TaskRouter from './router.ts?sharedworker';

const NUM_WORKERS = 2;

export class WorkerPoolProxy {
  private readonly workerPool: SharedWorker;
  private readonly workers: SharedWorker[] = [];
  private readonly routers = new Map<AutomergeUrl, SharedWorker>();
  private _repo: Repo | null = null;

  constructor(
    readonly contactUrl: AutomergeUrl,
    importMap: any,
    baseURI: string,
  ) {
    this.workerPool = this.createAndInitializeWorkerPool();
    for (let workerId = 0; workerId < NUM_WORKERS; workerId++) {
      this.workers.push(this.createAndInitializeWorker(workerId, importMap, baseURI));
    }
    this.initializeRouters();
  }

  private createAndInitializeWorkerPool() {
    // create the shared worker
    const workerPool = new WorkerPool({ name: `task-worker-pool` });
    workerPool.onerror = (error) => console.error('worker pool error:', error);
    workerPool.port.start();

    // initialize it (it doesn't matter if this message is sent more than once)
    const repoPort = (window as any).getRepoChannel();
    workerPool.port.postMessage(
      {
        type: 'init',
        contactUrl: this.contactUrl,
        repoPort: repoPort,
      } satisfies MessageToWorkerPool,
      [repoPort],
    );
    return workerPool;
  }

  private createAndInitializeWorker(id: number, importMap: any, baseURI: string) {
    // create the shared worker
    const worker = new TaskWorker({ name: `task-worker-${id}` });
    worker.onerror = (error) => console.error(`worker ${id} error:`, error);
    worker.port.start();

    // initialize it (it doesn't matter if this message is sent more than once)
    const repoPort = (window as any).getRepoChannel();
    worker.port.postMessage(
      {
        type: 'init',
        repoPort,
        contactUrl: this.contactUrl,
        importMap,
        baseURI,
      } satisfies MessageToWorker,
      [repoPort],
    );

    // forward messages from the worker (type 'add worker')to the worker pool
    worker.port.onmessage = (e: any) => {
      this.workerPool.port.postMessage(e.data);
    };

    return worker;
  }

  private async initializeRouters() {
    const accountHandle = await getAccountHandle(this.repo as any);
    accountHandle.on('change', (payload) =>
      this.updateRouters(getTaskQueues(payload.handle.doc())),
    );
    await this.updateRouters(getTaskQueues(accountHandle.doc()));
  }

  private async updateRouters(taskQueues: TaskQueues) {
    // terminate routers for the task queues we're no longer interested in
    for (const [taskQueueUrl, router] of this.routers.entries()) {
      if (!taskQueues[taskQueueUrl as any]) {
        this.routers.delete(taskQueueUrl);
        router.port.postMessage({
          type: 'terminate',
        } satisfies MessageToRouter);
      }
    }

    // add routers for the task queues we didn't already know about
    for (const url of Object.keys(taskQueues)) {
      const taskQueueUrl = url as AutomergeUrl;

      this.workerPool.port.postMessage({
        type: 'join',
        taskQueueUrl,
      } satisfies MessageToWorkerPool);

      // Create a router (SharedWorker) for this task queue if our browser doesn't have one already.
      // (If another window or tab already created one, we'll just get that one.)
      const router = new TaskRouter({ name: `task-router-${taskQueueUrl}` });
      this.routers.set(taskQueueUrl, router);

      // Initialize the router -- this is OK even if the `new TaskRouter(...)` above didn't create a new one.
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
  }

  get repo(): Repo {
    if (!this._repo) {
      this._repo = new Repo({
        network: [new MessageChannelNetworkAdapter((window as any).getRepoChannel())],
        peerId: `worker-pool-proxy-${Math.round(Math.random() * 10_000)}` as any,
      });
    }
    return this._repo;
  }
}
