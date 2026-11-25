import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import type {
  MessageToRouter,
  MessageToWorker,
  MessageToWorkerPool,
  RepoConfig,
} from './protocol';

import { getAccountHandle, getTaskQueues } from './helpers';
import { watchHostActivity } from './host-activity';
import { getRepoConfig } from './repo-config';
import { ROUTER_NAME, WORKER_POOL_NAME, workerName } from './ids';

import type { WorkerScripts } from './version';

const NUM_WORKERS = 2;

export class WorkerPoolProxy {
  private readonly workerPool: SharedWorker;
  private readonly workers: SharedWorker[] = [];
  private readonly router: SharedWorker;

  private readonly repoConfig: RepoConfig;
  private readonly stopWatchingHost: () => void;
  private stopWatchingAccount: (() => void) | undefined;
  private disposed = false;

  /**
   * `scripts` are the shared workers to start, or to join if they're already
   * running. They needn't be this copy of the package's own: a tab that hears
   * of a newer build starts that build's (see worker-handover.ts).
   */
  constructor(
    readonly contactUrl: AutomergeUrl,
    private readonly scripts: WorkerScripts,
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
    this.disposed = true;
    this.stopWatchingHost();
    this.stopWatchingAccount?.();
  }

  private createAndInitializeWorkerPool(importMap: any, baseURI: string) {
    // create the shared worker
    const workerPool = new SharedWorker(this.scripts.pool, {
      type: 'module',
      name: WORKER_POOL_NAME,
    });
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
    const worker = new SharedWorker(this.scripts.worker, { type: 'module', name });
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
    const router = new SharedWorker(this.scripts.router, { type: 'module', name: ROUTER_NAME });
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
      // And each worker: the set says whose code it runs from each queue (see
      // acceptance.ts), and a worker that hasn't been told runs nothing.
      for (const worker of this.workers) {
        worker.port.postMessage(message satisfies MessageToWorker);
      }
    };

    const accountHandle = await getAccountHandle(repo);
    if (this.disposed) {
      return;
    }
    const onChange = (payload: { handle: { doc(): any } }) =>
      updateTaskQueues(payload.handle.doc());
    accountHandle.on('change', onChange);
    this.stopWatchingAccount = () => accountHandle.off('change', onChange);
    updateTaskQueues(accountHandle.doc());
  }

  sendToRouter(message: MessageToRouter) {
    this.router.port.postMessage(message);
  }
}

function log(...args: any) {
  console.log('worker pool proxy:', ...args);
}
