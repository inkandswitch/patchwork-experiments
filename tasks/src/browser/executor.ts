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
//
// Under a pool linked to its page (link.ts), each run worker is handed its
// end of a link of its own as it starts, with its settings, and the link is
// ended with its `exit`. Its settings wait for the page to name the link's
// peer, and carry that id, which the worker's Repo is made with; the job
// waits behind them.
//
// Kept before reported. A linked run worker says how a run ended once the
// page's Repo has what the run wrote, and names those documents (`wrote`).
// Before the pool hears the ending, the page is asked to save them
// (`RunWorkerLink.keep`), waited for at most KEEP_LIMIT_MS; what could not be
// done is said in the run's log, and the ending is then heard all the same.
// An error that escapes the worker after its ending waits behind the ending
// too, so a run that returned is not recorded as one whose worker died.
//
// Each run worker is told the pool's registry (../registry-snapshot.ts) in
// its settings, and again, in its turn, whenever the page sends a newer one.

import type { Executor, Job, RunWorker, StopReason, WorkerEvents } from '../pool';
import type { FromRunWorker, PluginsHere, RunWorkerSettings, ToRunWorker } from '../run-worker';
import { Latest } from '../registry-snapshot';

/** A run worker's link to the page's Repo, as the pool's worker makes it (pool-worker.ts). */
export interface RunWorkerLink {
  /** The run worker's end. */
  port: MessagePort;
  /** The peer id the page chose for it; null where the page took no link. */
  peer: Promise<string | null>;
  /** Asks the page to save `documents`: null once it has, or why it could not. */
  keep(documents: string[]): Promise<string | null>;
  end(): void;
}

/** The longest a run's ending waits for the page to save what the run wrote: a save takes milliseconds; this is for a page that cannot. */
export const KEEP_LIMIT_MS = 10_000;

/** Said in a run's log when the page did not save what the run wrote. */
export const notKept = (of: number, why: string) =>
  `The page holds the ${of} documents this run wrote but did not save them (${why}): they are lost from this browser's page if it closes before it saves them.`;

/** The database, and the Web Lock, of run worker number `n`. */
export const runDatabase = (n: number) => `patchwork-tasks-run-${n}`;

export interface BrowserExecutorOptions {
  /** What every run worker is told before its first job: the sync server, and the page's import map. */
  settings: RunWorkerSettings;
  /** The task's document as the pool has it, saved: handed to the worker with the job (see `ToRunWorker`). */
  taskBytes(taskUrl: Job['taskUrl']): Promise<Uint8Array | undefined>;
  /** A new link to the page's Repo for a run worker that is starting; absent where the pool has no page linked. */
  link?(): RunWorkerLink;
}

export class BrowserExecutor implements Executor {
  /** The numbers of run workers that have not really ended, as far as this pool knows. */
  private readonly held = new Set<number>();
  /** The pool's registry as the page last sent it: every new run worker starts with it, and every live one is told a newer one. */
  readonly plugins = new Latest<PluginsHere>({ snapshot: [] });

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
    const link = this.options.link?.() ?? null;
    // Said after the current call returns, as a Node thread's 'exit' is: the
    // pool may be in the middle of ending this very worker.
    const exit = () => {
      if (over) {
        return;
      }
      over = true;
      unfollow();
      link?.end();
      this.free(n);
      queueMicrotask(() => events.exit());
    };
    const tell = (message: ToRunWorker) => worker.postMessage(message);

    // What the worker says is heard in the order it was said; an ending waits
    // until the page has saved what the run wrote, and what follows it waits too.
    let heard = Promise.resolve();
    const hear = (then: () => void) => {
      heard = heard
        .then(() => {
          if (!over) {
            then();
          }
        })
        .catch((error) => console.error('tasks: hearing a run worker failed', error));
    };
    const kept = (documents: unknown): Promise<void> => {
      const wrote = Array.isArray(documents) ? documents.filter((id): id is string => typeof id === 'string') : [];
      if (!link || wrote.length === 0) {
        return Promise.resolve();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        link.keep(wrote).catch((error) => (error as Error)?.message ?? String(error)),
        new Promise<string>((resolve) => (timer = setTimeout(() => resolve(`no answer in ${KEEP_LIMIT_MS / 1000} s`), KEEP_LIMIT_MS))),
      ]).then((problem) => {
        clearTimeout(timer);
        if (problem !== null && !over) {
          events.log(notKept(wrote.length, problem));
        }
      });
    };

    worker.onmessage = ({ data }: MessageEvent<FromRunWorker>) => {
      if (over) {
        return;
      }
      switch (data?.type) {
        case 'log':
          hear(() => events.log(data.message));
          break;
        case 'progress':
          hear(() => events.progress(data.value));
          break;
        case 'done':
          heard = heard.then(() => kept(data.wrote));
          hear(() => events.done(data.result));
          break;
        case 'threw':
          heard = heard.then(() => kept(data.wrote));
          hear(() => events.threw(data.message));
          break;
      }
    };
    // An error that escapes the task's code, or a script that will not load.
    // The worker is ended at once, so that what escaped cannot go on beside
    // the next job, and the pool hears that it is gone in its turn, behind
    // what the worker said before it: an ending said before the error, and
    // waiting for the page's save, is heard first.
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      if (over) {
        return;
      }
      worker.terminate();
      hear(() => {
        events.log(`its worker crashed: ${event.message || 'it could not be started'}`);
        exit();
      });
    };
    worker.onmessageerror = () => {
      if (!over) {
        events.log('something its worker said could not be read');
      }
    };
    // Said once the page has named the link's peer (at once, with no link),
    // and before anything else: what is said after waits its turn.
    const place = { ...settings.place, database: runDatabase(n) };
    let said = (link ? link.peer : Promise.resolve(null)).then((peer) => {
      if (over || !link || peer === null) {
        link?.port.close();
      }
      if (over) {
        return;
      }
      worker.postMessage(
        {
          type: 'settings',
          settings: { ...settings, place, plugins: this.plugins.value, ...(link && peer !== null ? { link: link.port, peerId: peer } : {}) },
        } satisfies ToRunWorker,
        link && peer !== null ? [link.port] : [],
      );
    });

    // A job goes with the task's document, which takes a moment to read. What
    // is said after it waits its turn, so that neither an abort nor a settle overtakes its job.
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
    const unfollow = this.plugins.follow((plugins) => inTurn(() => ({ type: 'plugins', plugins })));

    return {
      run: (job: Job) =>
        inTurn(async () => ({
          type: 'job',
          job,
          task: await taskBytes(job.taskUrl).catch(() => undefined),
        })),
      abort: (reason: StopReason) => inTurn(() => ({ type: 'abort', reason })),
      settle: (runId: string) => inTurn(() => ({ type: 'settled', run: runId })),
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
