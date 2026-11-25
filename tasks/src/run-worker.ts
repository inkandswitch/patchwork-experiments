// A run worker: where a task's code runs, one run at a time. A pool owns it
// and can end it whatever the code is doing, which is why each run worker is
// a thread of its own (a worker thread in Node, a dedicated worker in a
// browser) and not the pool's.
//
// It is told its settings once and then handed jobs one at a time. For each,
// it imports the code, calls its default export with `(input, ctx)` and
// `this` = ctx, and says what the code logs and reports, and then how it
// ended. It never writes the task's document: the pool records everything,
// from what this says. What the code writes to other documents through
// `ctx.repo` is saved before this says the code is done (I8).
//
// The same script runs on both platforms. What differs is behind
// ./webworker-lib (a Repo, and how code is imported; the Node build puts
// src/node/webworker-lib.node.ts in its place) and in the entry that hands
// `serve` its port (src/node/run-thread.ts in Node).

import type { DocumentId, Repo } from '@automerge/automerge-repo/slim';
import { getRepo, importModule, setUpImportMap, type PlaceSettings } from './webworker-lib';
import type { RepoConfig } from './repo-config';
import type { Job, StopReason } from './pool';
import type { TaskContext } from './job-context';

/** What a run worker is told once, before its first job. */
export interface RunWorkerSettings {
  /** The sync server its Repo talks to. */
  repoConfig: RepoConfig;
  /** What only one platform needs: in Node, where its Repo keeps documents and where code is found (see webworker-lib.node.ts). */
  place?: PlaceSettings;
  /** In a browser, the page's import map, which bare names in a task's code resolve by. */
  importMap?: unknown;
  baseURI?: string;
}

/** What is said to a run worker. */
export type ToRunWorker =
  | { type: 'settings'; settings: RunWorkerSettings }
  /**
   * A job, with the task's document as the pool had it when it took the
   * task (`Automerge.save` of it), so that the code's Repo has its own run in
   * the task before the code is called, network or no network.
   */
  | { type: 'job'; job: Job; task?: Uint8Array }
  | { type: 'abort'; reason: StopReason };

/** What a run worker says, about the job it has. */
export type FromRunWorker =
  | { type: 'log'; message: string }
  | { type: 'progress'; value: unknown }
  /** Its code returned this, and what the code wrote is saved. */
  | { type: 'done'; result: unknown }
  /** Its code threw, would not load, or what it wrote could not be saved. */
  | { type: 'threw'; message: string };

/** The two ends of a run worker's one channel, whatever the platform calls them. */
export interface RunWorkerPort {
  post(message: FromRunWorker): void;
  onMessage(listener: (message: ToRunWorker) => void): void;
}

/** Runs the jobs that come in on `port`, one at a time. */
export function serve(port: RunWorkerPort) {
  let repo: Promise<Repo> | null = null;
  let running: AbortController | null = null;

  const say = (message: FromRunWorker) => {
    try {
      port.post(message);
    } catch (error) {
      // only a value that cannot cross between threads gets here
      port.post({ type: 'threw', message: `what its code gave could not be sent from its worker: ${messageOf(error)}` });
    }
  };

  port.onMessage((message) => {
    switch (message?.type) {
      case 'settings': {
        // Made at once: a run worker is started only when there is a job for it.
        const { settings } = message;
        repo = setUpImportMap(settings.importMap ?? {}, settings.baseURI ?? '').then(() =>
          getRepo(settings.repoConfig, `task-run-${crypto.randomUUID()}`, settings.place),
        );
        repo.catch(() => {}); // said by each job that needs it
        break;
      }
      case 'job': {
        const controller = new AbortController();
        running = controller;
        runJob(message.job, message.task, controller.signal).then(
          () => {
            if (running === controller) {
              running = null;
            }
          },
          () => {},
        );
        break;
      }
      case 'abort':
        running?.abort(message.reason);
        break;
    }
  });

  async function runJob(job: Job, task: Uint8Array | undefined, signal: AbortSignal) {
    let docs: Repo | null = null;
    let outcome: FromRunWorker;
    // Code can go on after it has returned or thrown (a timer, a promise it
    // did not wait for), and the worker may by then have the next job: what
    // it says after its ending would be counted as that job's.
    let over = false;
    const sayWhileRunning = (message: FromRunWorker) => {
      if (!over) {
        say(message);
      }
    };
    try {
      if (!repo) {
        throw new Error('its worker was handed a job before it was set up');
      }
      docs = await repo;
      if (task) {
        docs.import(task, { docId: documentIdOf(job.taskUrl) });
      }
      const module = await importModule(job.importUrl);
      const fn = module?.default;
      if (typeof fn !== 'function') {
        throw new Error("the task's code has no default export to call");
      }
      const ctx: TaskContext = {
        log: (...args) => sayWhileRunning({ type: 'log', message: args.map((arg) => String(arg)).join(' ') }),
        progress: (value) => sayWhileRunning({ type: 'progress', value: copy(value) }),
        signal,
        repo: docs,
        taskUrl: job.taskUrl,
        run: job.runId,
        key: job.key,
      };
      outcome = { type: 'done', result: await fn.call(ctx, job.input, ctx) };
    } catch (error) {
      outcome = { type: 'threw', message: messageOf(error) };
    }
    if (docs) {
      try {
        await docs.flush();
      } catch (error) {
        // what it wrote is not safe yet, so it is not done
        outcome = { type: 'threw', message: `what its code wrote could not be saved: ${messageOf(error)}` };
      }
    }
    over = true;
    say(outcome);
  }
}

/** The document id an `automerge:` url names. */
function documentIdOf(url: string): DocumentId {
  return url.slice('automerge:'.length).split('#')[0] as DocumentId;
}

function messageOf(error: unknown): string {
  return (error as Error)?.message ?? String(error);
}

/** A copy that can cross between threads: JSON's, or else a string. */
function copy(value: unknown): unknown {
  try {
    return value === undefined ? null : (JSON.parse(JSON.stringify(value)) ?? null);
  } catch {
    return String(value);
  }
}
