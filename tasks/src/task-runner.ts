import { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import { TaskQueue } from './datatype';

declare global {
  interface Window {
    getRepoChannel: () => MessagePort;
  }
}

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

  private constructor(
    private readonly repo: Repo,
    private readonly queueHandle: DocHandle<TaskQueue>,
    private workerCount = 2
  ) { }

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
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push(this.createWorker());
    }
  }

  private createWorker(): Worker {
    // Get a channel to the repo from the site's SharedWorker.
    // The site must define window.getRepoChannel() to return a MessagePort connected to the automerge-repo SharedWorker.
    if (typeof window.getRepoChannel !== 'function') {
      throw new Error('TaskRunner requires window.getRepoChannel() to be defined by the site');
    }
    const port = window.getRepoChannel();

    // Create runner worker and transfer the port to it
    const worker = new Worker(new URL('./runnerWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage(
      {
        port,
        queueUrl: this.queueHandle.url,
        contactUrl: this.contactUrl,
      },
      [port]
    );

    return worker;
  }
}
