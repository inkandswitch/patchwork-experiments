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
//
// Each run worker keeps its documents in a database of its own, numbered
// (`runDatabase`), and uses it only while it holds the Web Lock of the same
// name (see getRepo in ../webworker-lib.ts): that is what keeps two live
// workers off one database, whatever happens here. What happens here only
// keeps a new worker from waiting. A worker takes the lowest number this
// pool does not hold, and the number is held from the worker's start until
// this pool has itself been granted that lock after the worker's `exit`,
// which is when the worker has really ended: a terminated worker spinning in
// a loop goes on for about 2 s, lock and open database with it. So there can
// be a few more databases than slots, and a worker waits for its lock only
// behind a worker of an earlier pool of this browser.

import type { Executor, Job, RunWorker, StopReason, WorkerEvents } from '../pool';
import type { FromRunWorker, RunWorkerSettings, ToRunWorker } from '../run-worker';

/** The database, and the Web Lock, of run worker number `n`. */
export const runDatabase = (n: number) => `patchwork-tasks-run-${n}`;

export interface BrowserExecutorOptions {
  /** What every run worker is told before its first job: the sync server, and the page's import map. */
  settings: RunWorkerSettings;
  /** The task's document as the pool has it, saved: handed to the worker with the job (see `ToRunWorker`). */
  taskBytes(taskUrl: Job['taskUrl']): Promise<Uint8Array | undefined>;
}

export class BrowserExecutor implements Executor {
  /** The numbers of run workers that have not really ended, as far as this pool knows. */
  private readonly held = new Set<number>();

  constructor(private readonly options: BrowserExecutorOptions) {}

  start(events: WorkerEvents): RunWorker {
    const { settings, taskBytes } = this.options;
    let n = 0;
    while (this.held.has(n)) {
      n++;
    }
    this.held.add(n);
    const worker = new Worker(new URL('./run-worker-entry.ts', import.meta.url), {
      type: 'module',
      name: 'patchwork-task-run',
    });
    let over = false;
    // Said after the current call returns, as a Node thread's 'exit' is: the
    // pool may be in the middle of ending this very worker.
    const exit = () => {
      if (over) {
        return;
      }
      over = true;
      this.free(n);
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
    tell({ type: 'settings', settings: { ...settings, place: { ...settings.place, database: runDatabase(n) } } });

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

  /**
   * Lets number `n` go to a new worker once its last worker has really
   * ended: once this pool is granted the lock that worker held for its life
   * (or would have taken, had it got that far). Until then `n` stays held.
   */
  private free(n: number) {
    navigator.locks
      .request(runDatabase(n), { mode: 'exclusive' }, () => {
        this.held.delete(n);
      })
      .catch((error) => console.error(`tasks: run worker ${n}'s number could not be freed`, error));
  }
}
