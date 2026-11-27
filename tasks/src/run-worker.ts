// A run worker: where a task's code runs, one run at a time. A pool owns it
// and can end it whatever the code is doing, which is why each run worker is
// a thread of its own (a worker thread in Node, a dedicated worker in a
// browser) and not the pool's.
//
// It is told its settings once and then handed jobs one at a time. For each,
// it imports the code, calls its default export with `(input, ctx)` and
// `this` = ctx, and says what the code logs and reports, and then how it
// ended. It never writes the task's document: the pool records everything,
// from what this says. It says how the code ended once its Repo has saved
// what the code wrote through `ctx.repo`; its Repo sends that on as it syncs.
//
// The same script runs on both platforms. What differs is behind
// ./webworker-lib (a Repo, and how code is imported; the Node build puts
// src/node/webworker-lib.node.ts in its place) and in the entry that hands
// `serve` its port (src/node/run-thread.ts in Node).
//
// It has the pool's plugin registry (registry-snapshot.ts): its settings
// carry the registry's snapshot, and a newer one comes whenever it changes.
// The registry agrees with it before any task's code is imported, so code
// that imports `@inkandswitch/patchwork-plugins` finds what the pool has. A
// pool is the tasks package, so the task client (TASKS_LIBRARY) is always
// there: this build's own, until an installed one replaces it.

import type { DocumentId, Repo } from '@automerge/automerge-repo/slim';
import { getRepo, importModule, pluginMirror, setUpImportMap, type PlaceSettings } from './webworker-lib';
import { findWhenThere } from './task-client.js';
import { TASKS_LIBRARY, WORKER_PEER } from './ids';
import type { RepoConfig } from './repo-config';
import type { Job, StopReason } from './pool';
import type { TaskContext } from './job-context';
import type { Snapshot } from './registry-snapshot';

/** The pool's registry, as a run worker is told it: the snapshot, and on a Node host where each package it names is on disk (by its url at heads). */
export interface PluginsHere {
  snapshot: Snapshot;
  packages?: Record<string, string>;
}

/** What a run worker is told once, before its first job. */
export interface RunWorkerSettings {
  /** The sync server its Repo talks to. */
  repoConfig: RepoConfig;
  /** Where its Repo keeps documents, a place no other live run worker uses (a database in a browser, a directory in Node), and in Node where code is found (see webworker-lib.ts). */
  place?: PlaceSettings;
  /** In a browser, the page's import map, which bare names in a task's code resolve by. */
  importMap?: unknown;
  baseURI?: string;
  /** In a browser, its end of a pipe to the site's Repo in the page above its pool (browser/pool-host.ts), when there is one. */
  link?: MessagePort;
  /** The pool's registry as it is when the worker starts. */
  plugins?: PluginsHere;
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
  | { type: 'abort'; reason: StopReason }
  /** The pool has held this run for a beat and nothing stops it: resolves the code's `ctx.settled`, if it is still this worker's job. */
  | { type: 'settled'; run: string }
  /** The pool's registry has changed: this is it now. */
  | { type: 'plugins'; plugins: PluginsHere };

/** What a run worker says, about the job it has. */
export type FromRunWorker =
  | { type: 'log'; message: string }
  | { type: 'progress'; value: unknown }
  /** Its code returned this, and its Repo has saved what the code wrote. */
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
  /** The latest job's `ctx.settled`, made as its job arrives. */
  let settling: Settling | null = null;
  /** This worker's registry made to agree with what it is handed, once it is set up; and the latest it was handed. */
  let registry: Promise<(plugins: PluginsHere) => void> | null = null;
  let plugins: PluginsHere = { snapshot: [] };

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
        repo = setUpImportMap(settings.importMap ?? {}, settings.baseURI ?? '')
          .then(() => getRepo(settings.repoConfig, `${WORKER_PEER}run-${crypto.randomUUID()}`, settings.place, settings.link));
        repo.catch(() => {}); // said by each job that needs it
        plugins = settings.plugins ?? plugins;
        registry = setUpImportMap(settings.importMap ?? {}, settings.baseURI ?? '')
          .then(() => pluginMirror([TASKS_LIBRARY]))
          .then((agree) => (agree(plugins), agree));
        registry.catch((error) => console.warn(`tasks: this run worker has no plugin registry: ${messageOf(error)}`));
        break;
      }
      case 'plugins':
        plugins = message.plugins;
        void registry?.then((agree) => agree(plugins), () => {});
        break;
      case 'job': {
        const controller = new AbortController();
        running = controller;
        // Made before the code is imported, so that a settle said meanwhile counts.
        settling = settlingOf(message.job.runId, controller.signal);
        runJob(message.job, message.task, controller.signal, settling.promise).then(
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
      case 'settled':
        if (settling?.run === message.run) {
          settling.resolve();
        }
        break;
    }
  });

  async function runJob(job: Job, task: Uint8Array | undefined, signal: AbortSignal, settled: Promise<void>) {
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
      // what the pool's registry has, before the code can ask it
      await registry?.catch(() => {});
      const module = await importModule(job.importUrl);
      const fn = module?.default;
      if (typeof fn !== 'function') {
        throw new Error("the task's code has no default export to call");
      }
      const ctx: TaskContext = {
        log: (...args) => sayWhileRunning({ type: 'log', message: args.map((arg) => String(arg)).join(' ') }),
        progress: (value) => sayWhileRunning({ type: 'progress', value: copy(value) }),
        signal,
        settled,
        repo: patient(docs),
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

// Settled
//
// `ctx.settled` resolves when the pool says the run has settled (see
// `settles` in task-rules.js), at most once, and never once the run's signal
// has aborted: then it rejects, saying why. Its rejection is handled here, so
// that code that never looks at it leaves nothing unhandled.

interface Settling {
  run: string;
  promise: Promise<void>;
  resolve(): void;
}

/** The `settled` of run `run`, which `signal` aborting rejects. */
function settlingOf(run: string, signal: AbortSignal): Settling {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  promise.catch(() => {});
  const aborted = () => reject(new Error(`the run stopped before it settled (${String(signal.reason)})`));
  signal.addEventListener('abort', aborted, { once: true });
  return {
    run,
    promise,
    resolve() {
      if (!signal.aborted) {
        signal.removeEventListener('abort', aborted);
        resolve();
      }
    },
  };
}

// What a task is handed can be found
//
// A task's input is often a document made a moment before the task was
// asked, on another machine, and it reaches this worker by the sync server.
// The Repo's own find says at once that such a document is unavailable, and
// goes on saying so until it comes. So the code's Repo finds as
// `findWhenThere` does, asking again for about half a minute. Only the code
// is handed this: the Repo itself, and its own calls to `find`, are untouched.
// Two rejections are final, because asking again cannot change them: a url
// the Repo cannot read, and the caller's own `signal` having aborted.

/**
 * How long one asking of the Repo is waited on. A Repo that says a document
 * is unavailable is asked again for about half a minute; one that never
 * answers at all (it does not, for a document it has deleted) is given this
 * long each time, so that the code hears within two minutes either way.
 */
const FIND_EACH_MS = 10_000;

/**
 * The Repo as the task's code sees it: `find` waits for a document that has
 * not arrived yet; everything else is the Repo's own, bound to the Repo
 * (its methods read private fields, which a Proxy as `this` does not have).
 */
export function patient(repo: Repo): Repo {
  const bound = new Map<PropertyKey, unknown>();
  const find = (id: Parameters<Repo['find']>[0], options?: Parameters<Repo['find']>[1]) => {
    const signal = options?.signal;
    let final: { error: unknown } | null = null;
    const once = (url: string) =>
      repo.find(url as typeof id, options).catch((error: unknown) => {
        if (signal?.aborted) {
          final = { error: signal.reason };
        } else if (/^Invalid AutomergeUrl/.test(messageOf(error))) {
          final = { error };
        }
        throw error;
      });
    // findWhenThere waits between askings with `sleep`, and a rejection there
    // ends its asking: that is where a final rejection is given back.
    const sleep = (ms: number) => (final ? Promise.reject(final.error) : pause(ms, signal));
    return findWhenThere({ find: once }, String(id), { sleep, each: FIND_EACH_MS });
  };
  return new Proxy(repo, {
    get(target, name) {
      if (name === 'find') {
        return find;
      }
      const value = Reflect.get(target, name, target);
      if (typeof value !== 'function') {
        return value;
      }
      // The same function each time, so that what is handed out compares equal.
      if (!bound.has(name)) {
        bound.set(name, value.bind(target));
      }
      return bound.get(name);
    },
    set(target, name, value) {
      return Reflect.set(target, name, value, target);
    },
  });
}

/** The document id an `automerge:` url names (its heads and path apart), or a bare document id itself. */
function documentIdOf(url: string): DocumentId {
  return url.replace(/^automerge:/, '').split(/[#/]/)[0] as DocumentId;
}

/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts, leaving no timer or listener behind. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const aborted = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    signal?.addEventListener('abort', aborted, { once: true });
  });
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
