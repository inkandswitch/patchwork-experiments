import { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import { TaskQueue } from './datatype';

export class TaskRunner {
  public static factory(repo: Repo) {
    return {
      async withQueue(docId: AutomergeUrl, workerCount = 2) {
        const handle = await repo.find<TaskQueue>(docId);
        return new TaskRunner(repo, handle, workerCount);
      },
      async forNewQueue(workerCount = 2) {
        const handle = repo.create<TaskQueue>({
          pending: [],
          done: [],
        });
        return new TaskRunner(repo, handle, workerCount);
      },
    };
  }

  private workers: Worker[] = [];
  private contactUrl: AutomergeUrl | null = null;
  private sharedWorker: SharedWorker | null = null;
  private sharedWorkerPort: MessagePort | null = null;

  private constructor(
    private readonly repo: Repo,
    private readonly queueHandle: DocHandle<TaskQueue>,
    private workerCount = 2
  ) {}

  public setContactUrl(url: AutomergeUrl) {
    this.contactUrl = url;
  }

  public async start() {
    if (this.workers.length > 0) return;
    await this.initializeWorkers();
    console.log('TaskRunner: Started - workers are running autonomously');
  }

  public stop() {
    if (this.workers.length === 0) return;
    this.cleanupWorkers();
    console.log('TaskRunner: Stopped');
  }

  private cleanupWorkers() {
    // Terminate all workers
    this.workers.forEach((worker) => {
      worker.terminate();
    });
    this.workers = [];
  }

  private async initializeWorkers() {
    // Check if SharedWorker is available (for tiny-patchwork)
    // @ts-ignore - window.__sharedworker may exist
    const existingSharedWorker = (window as any).__sharedworker as SharedWorker | undefined;

    if (existingSharedWorker) {
      // Workers will connect directly to the SharedWorker themselves
      for (let i = 0; i < this.workerCount; i++) {
        this.workers.push(this.createWorkerWithSharedWorker());
      }
      return;
    }

    // Fall back to ServiceWorker (for older setups)
    const serviceWorker = navigator.serviceWorker.controller;
    if (!serviceWorker) {
      console.warn('TaskRunner: No service worker available, workers cannot be initialized');
      return;
    }

    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push(this.createWorkerWithServiceWorker(serviceWorker));
    }
  }

  private createWorkerWithSharedWorker(): Worker {
    const { port1, port2 } = new MessageChannel();

    // Send port1 to shared worker via its port
    if (this.sharedWorkerPort) {
      this.sharedWorkerPort.postMessage({ type: 'INIT' }, [port1]);
    }

    // Create and initialize autonomous worker
    const worker = new Worker(new URL('./runnerWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage(
      {
        port: port2,
        queueUrl: this.queueHandle.url,
        contactUrl: this.contactUrl,
      },
      [port2]
    );

    return worker;
  }

  private createWorkerWithServiceWorker(serviceWorker: ServiceWorker): Worker {
    const { port1, port2 } = new MessageChannel();

    // Send port1 to service worker
    serviceWorker.postMessage({ type: 'INIT' }, [port1]);

    // Create and initialize autonomous worker
    const worker = new Worker(new URL('./runnerWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage(
      {
        port: port2,
        queueUrl: this.queueHandle.url,
        contactUrl: this.contactUrl,
      },
      [port2]
    );

    return worker;
  }
}
