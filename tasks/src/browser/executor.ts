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
// Each run worker is handed its end of a pipe to the page's Repo (pipe.ts) in
// its settings, its only way to documents, and the pipe is ended with its
// `exit`.
//
// A job goes to its run worker with the task's document as the pool has it
// saved (null where the pool cannot export it: the worker then finds it
// through its pipe), and what is said after a job waits behind it.
//
// Each run worker is told the pool's registry (../registry-snapshot.ts) in
// its settings, and again, in its turn, whenever the page sends a newer one.

import type { Executor, Job, RunWorker, StopReason, WorkerEvents } from '../pool';
import type { FromRunWorker, PluginsHere, RunWorkerSettings, ToRunWorker } from '../run-worker';
import { Latest } from '../registry-snapshot';

/** A run worker's pipe to the page's Repo, as the pool's worker makes it (pool-worker.ts). */
export interface RunWorkerLink {
  /** The run worker's end. */
  port: MessagePort;
  end(): void;
}

export interface BrowserExecutorOptions {
  /** What every run worker is told before its first job, but for its pipe: the page's import map. */
  settings: Omit<RunWorkerSettings, 'link' | 'plugins'>;
  /** A new pipe to the page's Repo for a run worker that is starting. */
  link(): RunWorkerLink;
  /** The task's document as the pool has it, saved, handed to the run worker with its job; undefined when the pool cannot export it. */
  taskBytes(taskUrl: Job['taskUrl']): Promise<Uint8Array | undefined>;
}

export class BrowserExecutor implements Executor {
  /** The pool's registry as the page last sent it: every new run worker starts with it, and every live one is told a newer one. */
  readonly plugins = new Latest<PluginsHere>({ snapshot: [] });

  constructor(private readonly options: BrowserExecutorOptions) {}

  start(events: WorkerEvents): RunWorker {
    const { settings, taskBytes } = this.options;
    const worker = new Worker(new URL('./run-worker-entry.ts', import.meta.url), {
      type: 'module',
      name: 'patchwork-task-run',
    });
    let over = false;
    const link = this.options.link();
    // Said after the current call returns, as a Node thread's 'exit' is: the
    // pool may be in the middle of ending this very worker.
    const exit = () => {
      if (over) {
        return;
      }
      over = true;
      unfollow();
      link.end();
      queueMicrotask(() => events.exit());
    };
    const tell = (message: ToRunWorker) => {
      if (!over) {
        worker.postMessage(message);
      }
    };
    // A job goes with the task's document, which takes a moment to read. What
    // is said after it waits its turn, so that neither an abort nor a settle overtakes its job.
    let said = Promise.resolve();
    const inTurn = (message: () => Promise<ToRunWorker> | ToRunWorker) => {
      said = said.then(async () => tell(await message())).catch((error) => console.error('tasks: telling a run worker something failed', error));
    };

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
    // The worker is ended at once, so that what escaped cannot go on beside
    // the next job.
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      if (over) {
        return;
      }
      worker.terminate();
      events.log(`its worker crashed: ${event.message || 'it could not be started'}`);
      exit();
    };
    worker.onmessageerror = () => {
      if (!over) {
        events.log('something its worker said could not be read');
      }
    };
    worker.postMessage(
      { type: 'settings', settings: { ...settings, plugins: this.plugins.value, link: link.port } } satisfies ToRunWorker,
      [link.port],
    );

    const unfollow = this.plugins.follow((plugins) => inTurn(() => ({ type: 'plugins', plugins })));

    return {
      run: (job: Job) => inTurn(async () => ({ type: 'job', job, task: (await taskBytes(job.taskUrl).catch(() => undefined)) ?? null })),
      abort: (reason: StopReason) => inTurn(() => ({ type: 'abort', reason })),
      settle: (runId: string) => inTurn(() => ({ type: 'settled', run: runId })),
      terminate: () => {
        worker.terminate();
        exit();
      },
    };
  }
}
