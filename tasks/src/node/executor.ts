// The pool's run workers in a Node process: each a worker thread running
// ../run-worker.ts (built as run-thread.mjs), with a Repo of its own on disk.
//
// A thread's Repo keeps its documents in <data-dir>/slots/<n>, a directory
// no other live thread uses: two Repos writing one directory would spoil it.
// The pool asks for threads as it needs them and ends a stopped one at once,
// so a replacement can start before the old one has gone; the old one's
// directory is free again only when its 'exit' has fired, and the new one
// takes the lowest number nobody holds. So there can be a few more
// directories than slots, and never two live threads on one.
//
// Each thread's heap has a ceiling (`maxHeapMb`). A task that reaches it ends
// its own thread, which the pool records as a lost run; without one, it would
// take the whole process down, the pool and every other run with it.

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { Executor, Job, RunWorker, StopReason, WorkerEvents } from '../pool';
import type { FromRunWorker, RunWorkerSettings, ToRunWorker } from '../run-worker';

export interface NodeExecutorOptions {
  /** The run worker's script: run-thread.mjs beside the host. */
  script: URL;
  /** Holds `slots/<n>`, one directory for each thread's Repo. */
  dataDir: string;
  /** What every thread is told, but for where its Repo keeps documents. */
  settings: RunWorkerSettings;
  /** The task's document as the pool has it, saved: handed to the thread with the job (see `ToRunWorker`). */
  taskBytes(taskUrl: Job['taskUrl']): Promise<Uint8Array | undefined>;
  /** For a person watching: a line for each thread started and ended and each run handed over and over. */
  say?(line: string): void;
  /** The most each thread's heap may grow to, in megabytes. */
  maxHeapMb?: number;
}

/** A thread's heap ceiling unless the host is told otherwise: what V8 allows a process by default on a 64-bit machine. */
export const DEFAULT_MAX_HEAP_MB = 4096;

export class NodeExecutor implements Executor {
  private readonly held = new Set<number>();

  constructor(private readonly options: NodeExecutorOptions) {}

  /** How many threads are alive: from start until their 'exit'. */
  get threads() {
    return this.held.size;
  }

  start(events: WorkerEvents): RunWorker {
    const { script, dataDir, settings, taskBytes, say, maxHeapMb = DEFAULT_MAX_HEAP_MB } = this.options;
    let n = 0;
    while (this.held.has(n)) {
      n++;
    }
    // Held once there is a thread, so that one that could not be made (the
    // pool fails its run) does not hold a number that no 'exit' will free.
    const worker = new Worker(script, {
      name: `task-run-${n}`,
      resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
    });
    this.held.add(n);
    say?.(`thread ${n} started (${this.held.size} alive)`);
    let job: Job | null = null;
    const tell = (message: ToRunWorker) => worker.postMessage(message);
    tell({
      type: 'settings',
      settings: { ...settings, place: { ...settings.place, storageDir: join(dataDir, 'slots', String(n)) } },
    });

    worker.on('message', (message: FromRunWorker) => {
      switch (message?.type) {
        case 'log':
          events.log(message.message);
          break;
        case 'progress':
          events.progress(message.value);
          break;
        case 'done':
          say?.(`run ${short(job)} returned`);
          job = null;
          events.done(message.result);
          break;
        case 'threw':
          say?.(`run ${short(job)} threw: ${message.message}`);
          job = null;
          events.threw(message.message);
          break;
      }
    });
    // An error that escapes the task's code ends the thread; 'exit' follows, and says so to the pool.
    worker.on('error', (error) => events.log(`its worker crashed: ${error?.message ?? error}`));
    worker.on('exit', (code) => {
      this.held.delete(n);
      say?.(`thread ${n} ended (code ${code}; ${this.held.size} alive)`);
      events.exit();
    });

    // A job goes with the task's document, which takes a moment to read. What
    // is said after it waits its turn, so that neither an abort nor a settle overtakes its job.
    let said = Promise.resolve();
    const inTurn = (message: () => Promise<ToRunWorker> | ToRunWorker) => {
      said = said
        .then(async () => tell(await message()))
        .catch((error) => console.error('tasks: telling a run worker something failed', error));
    };

    return {
      run: (given) => {
        job = given;
        say?.(`run ${short(given)} of ${given.key} handed to thread ${n}`);
        inTurn(async () => ({
          type: 'job',
          job: given,
          task: await taskBytes(given.taskUrl).catch(() => undefined),
        }));
      },
      abort: (reason: StopReason) => {
        say?.(`run ${short(job)} told to stop: ${reason}`);
        inTurn(() => ({ type: 'abort', reason }));
      },
      settle: (runId: string) => {
        say?.(`run ${runId.slice(0, 8)} settled`);
        inTurn(() => ({ type: 'settled', run: runId }));
      },
      terminate: () => {
        void worker.terminate();
      },
    };
  }
}

const short = (job: Job | null) => job?.runId.slice(0, 8) ?? '(none)';
