import { AutomergeUrl } from '@automerge/automerge-repo';
import { MessageToWorkerPool } from './protocol';

import WorkerPool from './worker-pool.ts?sharedworker';

export class WorkerPoolProxy {
  private readonly workerPool: SharedWorker;

  constructor(
    readonly contactUrl: AutomergeUrl,
    importMap: ImportMap,
    baseURI: string,
    numWorkers = 2,
  ) {
    this.workerPool = new WorkerPool({ name: `task-worker-pool` });
    this.workerPool.onerror = (error) => {
      console.error('SharedWorker error:', error);
    };
    this.workerPool.port.start();

    const port = (window as any).getRepoChannel();
    const workerPorts: MessagePort[] = [];
    for (let i = 0; i < numWorkers; i++) {
      workerPorts.push((window as any).getRepoChannel());
    }
    this.workerPool.port.postMessage(
      {
        type: 'init',
        contactUrl,
        port,
        workerPorts,
        importMap,
        baseURI,
      } satisfies MessageToWorkerPool,
      [port, ...workerPorts],
    );
  }

  joinTaskQueue(url: AutomergeUrl) {
    const port = (window as any).getRepoChannel();
    this.workerPool.port.postMessage(
      { type: 'join task queue', url, port } satisfies MessageToWorkerPool,
      [port],
    );
  }

  leaveTaskQueue(url: AutomergeUrl) {
    this.workerPool.port.postMessage({
      type: 'leave task queue',
      url,
    } satisfies MessageToWorkerPool);
  }
}
