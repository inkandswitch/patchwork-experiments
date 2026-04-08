import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { MessageToRouter, MessageToWorker, MessageToWorkerPool } from './protocol';

import { IndexedDBStorageAdapter, MessageChannelNetworkAdapter, Repo } from '@automerge/vanillajs';
import { getAccountHandle, getTaskQueues } from './helpers';

import WorkerPool from './worker-pool.ts?sharedworker';
import TaskWorker from './worker.ts?sharedworker';
import TaskRouter from './router.ts?sharedworker';

const BUILD_ID = import.meta.env.VITE_BUILD_ID ?? 'dev';

const NUM_WORKERS = 2;

export class WorkerPoolProxy {
  private readonly workerPool: SharedWorker;
  private readonly workers: SharedWorker[] = [];
  private readonly router: SharedWorker;
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

    this.router = this.createAndInitializeRouter();
  }

  private createAndInitializeWorkerPool() {
    // create the shared worker
    const workerPool = new WorkerPool({ name: `task-worker-pool-${BUILD_ID}` });
    workerPool.onerror = (error) => log(error);

    // initialize it (doesn't matter if this message is sent more than once)
    const repoPort = (window as any).getRepoChannel();
    log('sending init to worker pool');
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
    const name = `task-worker-${BUILD_ID}-${id}`;
    log('creating and initializing worker', name);
    const worker = new TaskWorker({ name });
    worker.onerror = (error) => log(`worker ${id} error:`, error);

    // forward messages from the worker (type 'add worker') to the worker pool
    worker.port.onmessage = (e: any) => {
      log(
        'received message from worker that i will forward to the pool',
        e.data,
      );
      this.workerPool.port.postMessage(e.data);
    };

    worker.port.onmessageerror = (e) => {
      log('message error from worker', name, e);
    };

    (worker.port as any).start?.();

    // initialize it (doesn't matter if this message is sent more than once)
    log('sending init message to', name);
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

    return worker;
  }

  private createAndInitializeRouter() {
    // create the shared worker
    const router = new TaskRouter({ name: `task-router-${BUILD_ID}` });
    router.onerror = (error) => log(error);

    // initialize it (doesn't matter if this message is sent more than once)
    log('sending init message to router');
    const repoPort = (window as any).getRepoChannel();
    router.port.postMessage(
      {
        type: 'init',
        repoPort,
        contactUrl: this.contactUrl,
      } satisfies MessageToRouter,
      [repoPort],
    );

    // note: no `await` on purpose
    this.setUpTaskQueueSetUpdates();

    return router;
  }

  async setUpTaskQueueSetUpdates() {
    const updateTaskQueues = (accountDoc: any) =>
      this.sendToRouter({
        type: 'update task queue set',
        taskQueues: getTaskQueues(accountDoc),
      });

    const accountHandle = await getAccountHandle(await this.getRepo() as any);
    accountHandle.on('change', (payload) => updateTaskQueues(payload.handle.doc()));
    updateTaskQueues(accountHandle.doc());
  }

  sendToRouter(message: MessageToRouter) {
    this.router.port.postMessage(message);
  }

  async getRepo() {
    if (!this._repo) {
      this._repo = new Repo({
        storage: new IndexedDBStorageAdapter(),
        network: [new MessageChannelNetworkAdapter((window as any).getRepoChannel())],
        peerId: `worker-pool-proxy-${Math.round(Math.random() * 10_000)}` as any,
      });
      await this._repo.networkSubsystem.whenReady();
    }
    return this._repo;
  }
}

function log(...args: any) {
  console.log('worker pool proxy:', ...args);
}
