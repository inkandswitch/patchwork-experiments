// The pool's run workers in a Node process: each a worker thread running
// ../run-worker.ts (built as run-thread.mjs), each with a pipe to the host's Repo.
//
// Each thread is handed its end of a pipe to the host's Repo (../pipe.ts) in
// its settings, its only way to documents, and the pipe is ended with its
// 'exit'.
//
// A job goes to its thread with the task's document as the host has it saved
// (null where the host cannot export it: the thread then finds it through its
// pipe), and what is said after a job waits behind it.
//
// Each thread's heap has a ceiling (`maxHeapMb`). A task that reaches it ends
// its own thread, which the pool records as a lost run; without one, it would
// take the whole process down, the pool and every other run with it.
//
// Each thread is told the host's registry (../registry-snapshot.ts) in its
// settings, and again whenever the host's registry changes (host.ts).

import { Worker, type MessagePort as NodePort } from 'node:worker_threads';
import type { Executor, Job, RunWorker, StopReason, WorkerEvents } from '../pool';
import type { FromRunWorker, PluginsHere, RunWorkerSettings, ToRunWorker } from '../run-worker';
import { Latest } from '../registry-snapshot';

export interface NodeExecutorOptions {
  /** The run worker's script: run-thread.mjs beside the host. */
  script: URL;
  /** What every thread is told, but for its pipe and the registry. */
  settings: Omit<RunWorkerSettings, 'link' | 'plugins'>;
  /** A new pipe to the host's Repo for a thread that is starting. */
  link(): RunWorkerLink;
  /** The task's document as the host has it, saved, handed to the thread with its job; undefined when the host cannot export it. */
  taskBytes(taskUrl: Job['taskUrl']): Promise<Uint8Array | undefined>;
  /** For a person watching: a line for each thread started and ended and each run handed over and over. */
  say?(line: string): void;
  /** The most each thread's heap may grow to, in megabytes. */
  maxHeapMb?: number;
}

/** A thread's heap ceiling unless the host is told otherwise: what V8 allows a process by default on a 64-bit machine. */
export const DEFAULT_MAX_HEAP_MB = 4096;

/** A run thread's pipe to the host's Repo, as the host makes it (host.ts). */
export interface RunWorkerLink {
  /** The thread's end, which is transferred to it. */
  port: MessagePort;
  end(): void;
}

export class NodeExecutor implements Executor {
  /** Threads started, which numbers them; and how many are alive. */
  private started = 0;
  private alive = 0;
  /** The host's registry as it last changed: every new thread starts with it, and every live one is told a newer one. */
  readonly plugins = new Latest<PluginsHere>({ snapshot: [] });

  constructor(private readonly options: NodeExecutorOptions) {}

  /** How many threads are alive: from start until their 'exit'. */
  get threads() {
    return this.alive;
  }

  start(events: WorkerEvents): RunWorker {
    const { script, settings, taskBytes, say, maxHeapMb = DEFAULT_MAX_HEAP_MB } = this.options;
    const n = this.started++;
    const worker = new Worker(script, {
      name: `task-run-${n}`,
      resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
    });
    this.alive++;
    say?.(`thread ${n} started (${this.alive} alive)`);
    const link = this.options.link();
    let job: Job | null = null;
    const tell = (message: ToRunWorker) => worker.postMessage(message);
    // A job goes with the task's document, which takes a moment to read. What
    // is said after it waits its turn, so that neither an abort nor a settle overtakes its job.
    let said = Promise.resolve();
    const inTurn = (message: () => Promise<ToRunWorker> | ToRunWorker) => {
      said = said.then(async () => tell(await message())).catch((error) => console.error('tasks: telling a run worker something failed', error));
    };
    worker.postMessage({ type: 'settings', settings: { ...settings, plugins: this.plugins.value, link: link.port } } satisfies ToRunWorker, [
      link.port as unknown as NodePort,
    ]);
    const unfollow = this.plugins.follow((plugins) => inTurn(() => ({ type: 'plugins', plugins })));

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
      unfollow();
      link.end();
      this.alive--;
      say?.(`thread ${n} ended (code ${code}; ${this.alive} alive)`);
      events.exit();
    });

    return {
      run: (given) => {
        job = given;
        say?.(`run ${short(given)} of ${given.key} handed to thread ${n}`);
        inTurn(async () => ({ type: 'job', job: given, task: (await taskBytes(given.taskUrl).catch(() => undefined)) ?? null }));
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
