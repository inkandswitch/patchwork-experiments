import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import type {
  MessageToRouter,
  MessageToWorker,
  MessageToWorkerPool,
  RepoConfig,
} from './protocol';

import { getAccountHandle, getTaskQueues } from './helpers';
import { watchHostActivity } from './host-activity';
import { ROUTER_NAME, WORKER_POOL_NAME, workerName } from './ids';

import WorkerPool from './worker-pool.ts?sharedworker';
import TaskWorker from './worker.ts?sharedworker';
import TaskRouter from './router.ts?sharedworker';

const NUM_WORKERS = 2;

// Patchwork doesn't say at runtime which sync server a site was built for, so
// this is the one its bootloader falls back to. A site on another server sets
// `localStorage.tasksSyncServerUrl`.
const DEFAULT_SYNC_SERVER_URL = 'wss://subduction.sync.inkandswitch.com';
const SYNC_SERVER_URL_KEY = 'tasksSyncServerUrl';

/** What the shared workers need to build their Repos (see `getRepo` in webworker-lib.ts). */
export function getRepoConfig(): RepoConfig {
  return {
    syncServerUrl: localStorage.getItem(SYNC_SERVER_URL_KEY) || DEFAULT_SYNC_SERVER_URL,
  };
}

export class WorkerPoolProxy {
  private readonly workerPool: SharedWorker;
  private readonly workers: SharedWorker[] = [];
  private readonly router: SharedWorker;

  private readonly repoConfig: RepoConfig;
  private readonly stopWatchingHost: () => void;

  constructor(
    readonly contactUrl: AutomergeUrl,
    importMap: any,
    baseURI: string,
  ) {
    this.repoConfig = getRepoConfig();
    this.workerPool = this.createAndInitializeWorkerPool(importMap, baseURI);

    for (let workerId = 0; workerId < NUM_WORKERS; workerId++) {
      this.workers.push(this.createAndInitializeWorker(workerId, importMap, baseURI));
    }

    this.router = this.createAndInitializeRouter(importMap, baseURI);

    // The pool can't see the user; this tab can, and keeps it posted.
    this.stopWatchingHost = watchHostActivity((message) =>
      this.workerPool.port.postMessage(message satisfies MessageToWorkerPool),
    );
  }

  /**
   * Call when this tab's tool goes away. The shared workers carry on for as
   * long as any tab has them open; this only stops this tab reporting to them.
   */
  dispose() {
    this.stopWatchingHost();
  }

  private createAndInitializeWorkerPool(importMap: any, baseURI: string) {
    // create the shared worker
    const workerPool = new WorkerPool({ name: WORKER_POOL_NAME });
    workerPool.onerror = (error) => log(error);

    log('sending init to worker pool');
    workerPool.port.postMessage({
      type: 'init',
      contactUrl: this.contactUrl,
      repoConfig: this.repoConfig,
      importMap,
      baseURI,
    } satisfies MessageToWorkerPool);

    return workerPool;
  }

  private createAndInitializeWorker(id: number, importMap: any, baseURI: string) {
    // create the shared worker
    const name = workerName(id);
    log('creating and initializing worker', name);
    const worker = new TaskWorker({ name });
    worker.onerror = (error) => log(`worker ${id} error:`, error);

    // forward messages from the worker (type 'add worker') to the worker pool
    worker.port.onmessage = (e: any) => {
      log('received message from worker that i will forward to the pool', e.data);
      this.workerPool.port.postMessage(e.data);
    };

    worker.port.onmessageerror = (e) => {
      log('message error from worker', name, e);
    };

    (worker.port as any).start?.();

    log('sending init message to', name);
    worker.port.postMessage({
      type: 'init',
      repoConfig: this.repoConfig,
      contactUrl: this.contactUrl,
      importMap,
      baseURI,
    } satisfies MessageToWorker);

    return worker;
  }

  private createAndInitializeRouter(importMap: any, baseURI: string) {
    // create the shared worker
    const router = new TaskRouter({ name: ROUTER_NAME });
    router.onerror = (error) => log(error);

    log('sending init message to router');
    router.port.postMessage({
      type: 'init',
      repoConfig: this.repoConfig,
      contactUrl: this.contactUrl,
      importMap,
      baseURI,
    } satisfies MessageToRouter);

    // note: no `await` on purpose
    this.setUpTaskQueueSetUpdates();

    return router;
  }

  async setUpTaskQueueSetUpdates() {
    const updateTaskQueues = (accountDoc: any) => {
      const message: MessageToWorkerPool = {
        type: 'update task queue set',
        taskQueues: getTaskQueues(accountDoc),
      };
      // Router needs the set so it can join queues, run takeover, and broadcast UI heartbeats.
      this.sendToRouter(message);
      // Worker pool must get the same update: it forwards worker heartbeats to the active
      // router's doc channel; without this it never joins queues and the router sees no workers.
      this.workerPool.port.postMessage(message);
    };

    const accountHandle = await getAccountHandle(repo);
    accountHandle.on('change', (payload) => updateTaskQueues(payload.handle.doc()));
    updateTaskQueues(accountHandle.doc());
  }

  sendToRouter(message: MessageToRouter) {
    this.router.port.postMessage(message);
  }
}

function log(...args: any) {
  console.log('worker pool proxy:', ...args);
}
