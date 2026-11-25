// The pool's run workers in a browser: each a dedicated worker running
// ../run-worker.ts (run-worker-entry.ts), made by the pool's own worker
// (pool-worker.ts). The pool can end one whatever its code is doing:
// `terminate()` ends even a worker spinning in a loop, about 2 s later.
//
// A browser's Worker has no 'exit' event, so this says `exit` itself, once
// per worker: when the worker reports an error that escaped its code or kept
// it from starting (the worker is then ended, as a Node thread would be), and
// when it is terminated. A worker that runs out of memory takes the whole tab
// with it, pool included, so nothing here hears of that: the next pool of
// this browser records the run lost.

import type { Executor, Job, RunWorker, StopReason, WorkerEvents } from '../pool';
import type { FromRunWorker, RunWorkerSettings, ToRunWorker } from '../run-worker';

export interface BrowserExecutorOptions {
  /** What every run worker is told before its first job: the sync server, and the page's import map. */
  settings: RunWorkerSettings;
  /** The task's document as the pool has it, saved: handed to the worker with the job (see `ToRunWorker`). */
  taskBytes(taskUrl: Job['taskUrl']): Promise<Uint8Array | undefined>;
}

export class BrowserExecutor implements Executor {
  private alive = 0;

  constructor(private readonly options: BrowserExecutorOptions) {}

  /** How many run workers are alive: from start until `exit` is said. */
  get workers() {
    return this.alive;
  }

  start(events: WorkerEvents): RunWorker {
    const { settings, taskBytes } = this.options;
    const worker = new Worker(new URL('./run-worker-entry.ts', import.meta.url), {
      type: 'module',
      name: 'patchwork-task-run',
    });
    this.alive++;
    let over = false;
    // Said after the current call returns, as a Node thread's 'exit' is: the
    // pool may be in the middle of ending this very worker.
    const exit = () => {
      if (over) {
        return;
      }
      over = true;
      this.alive--;
      queueMicrotask(() => events.exit());
    };
    const tell = (message: ToRunWorker) => worker.postMessage(message);

    worker.onmessage = ({ data }: MessageEvent<FromRunWorker>) => {
      if (over) {
        return;
      }
      switch (data?.type) {
        case 'log':
          events.log(data.message);
          break;
        case 'progress':
          events.progress(data.value);
          break;
        case 'done':
          events.done(data.result);
          break;
        case 'threw':
          events.threw(data.message);
          break;
      }
    };
    // An error that escapes the task's code, or a script that will not load.
    // The worker is ended, so that what escaped cannot go on beside the next
    // job, and the pool hears that it is gone.
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      if (over) {
        return;
      }
      events.log(`its worker crashed: ${event.message || 'it could not be started'}`);
      worker.terminate();
      exit();
    };
    worker.onmessageerror = () => {
      if (!over) {
        events.log('something its worker said could not be read');
      }
    };
    tell({ type: 'settings', settings });

    // A job goes with the task's document, which takes a moment to read. What
    // is said after it waits its turn, so that an abort never overtakes its job.
    let said = Promise.resolve();
    const inTurn = (message: () => Promise<ToRunWorker> | ToRunWorker) => {
      said = said
        .then(async () => {
          const next = await message();
          if (!over) {
            tell(next);
          }
        })
        .catch((error) => console.error('tasks: telling a run worker something failed', error));
    };

    return {
      run: (job: Job) =>
        inTurn(async () => ({
          type: 'job',
          job,
          task: await taskBytes(job.taskUrl).catch(() => undefined),
        })),
      abort: (reason: StopReason) => inTurn(() => ({ type: 'abort', reason })),
      terminate: () => {
        worker.terminate();
        exit();
      },
    };
  }
}
