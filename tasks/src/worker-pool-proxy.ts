import { AutomergeUrl } from '@automerge/automerge-repo';
import { MessageToWorkerPool } from './protocol';

export class WorkerPoolProxy {
  private readonly getRepoChannel: () => MessagePort = (window as any).getRepoChannel();
  private readonly workerPool: SharedWorker;

  constructor(
    readonly contactUrl: AutomergeUrl,
    readonly importMap: ImportMap,
    readonly baseURI: string,
    numWorkers = 2
  ) {
    this.workerPool = new SharedWorker(new URL('./worker-pool.ts', import.meta.url), {
      name: `worker-pool`,
      type: 'module',
    });
    this.workerPool.port.start();

    const port = this.getRepoChannel();
    this.workerPool.port.postMessage(
      { type: 'init', contactUrl, port } satisfies MessageToWorkerPool,
      [port]
    );

    for (let idx = 0; idx < numWorkers; idx++) {
      this.addWorker();
    }
  }

  addWorker() {
    const port = this.getRepoChannel();
    this.workerPool.port.postMessage(
      {
        type: 'add worker',
        port,
        importMap: this.importMap,
        baseURI: this.baseURI,
      } satisfies MessageToWorkerPool,
      [port]
    );
  }

  joinTaskQueue(url: AutomergeUrl) {
    const port = this.getRepoChannel();
    this.workerPool.port.postMessage(
      { type: 'join task queue', url, port } satisfies MessageToWorkerPool,
      [port]
    );
  }

  leaveTaskQueue(url: AutomergeUrl) {
    this.workerPool.port.postMessage({
      type: 'leave task queue',
      url,
    } satisfies MessageToWorkerPool);
  }
}
