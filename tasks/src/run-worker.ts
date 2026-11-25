// A run worker: where a task's code runs, one run at a time. A pool owns it
// and can end it whatever the code is doing, which is why each run worker is
// a thread of its own (a worker thread in Node, a dedicated worker in a
// browser) and not the pool's.
//
// It is told its settings once and then handed jobs one at a time. For each,
// it imports the code, calls its default export with `(input, ctx)` and
// `this` = ctx, and says what the code logs and reports, and then how it
// ended. It never writes the task's document: the pool records everything,
// from what this says. What the code wrote to other documents through
// `ctx.repo` is saved, and acknowledged by the sync server, before this says
// how the code ended (see "Reachable before it is said" below), so that
// whoever reads the ending can find what the run wrote, and ending this
// worker afterwards loses nothing.
//
// The same script runs on both platforms. What differs is behind
// ./webworker-lib (a Repo, and how code is imported; the Node build puts
// src/node/webworker-lib.node.ts in its place) and in the entry that hands
// `serve` its port (src/node/run-thread.ts in Node).

import type { DocumentId, Repo } from '@automerge/automerge-repo/slim';
import { firstAttempt, getRepo, importModule, setUpImportMap, type PlaceSettings } from './webworker-lib';
import { findWhenThere } from './task-client.js';
import type { RepoConfig } from './repo-config';
import type { Job, StopReason } from './pool';
import type { TaskContext } from './job-context';

/** What a run worker is told once, before its first job. */
export interface RunWorkerSettings {
  /** The sync server its Repo talks to. */
  repoConfig: RepoConfig;
  /** Where its Repo keeps documents, a place no other live run worker uses (a database in a browser, a directory in Node), and in Node where code is found (see webworker-lib.ts). */
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
  /** Its code returned this, and what the code wrote is saved and has reached the sync server, or the log says why not. */
  | { type: 'done'; result: unknown }
  /** Its code threw, would not load, or what it wrote could not be saved; said, like `done`, once what it wrote has reached the sync server or the log says why not. */
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
  /** What the sync server has said it holds, heard for the Repo's whole life (see `serverReports`). */
  let reports: ServerReports | null = null;

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
          .then(() => getRepo(settings.repoConfig, `task-run-${crypto.randomUUID()}`, settings.place))
          .then((made) => {
            reports = serverReports(made);
            return made;
          });
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
    /** Every document's heads as the code was called: what it changed is what differs at the end. */
    let before: Map<string, string> | null = null;
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
      // Taken after the code is imported: fetching a package's files is the
      // worker's doing, and they came from the server.
      before = headsOfAll(docs);
      const ctx: TaskContext = {
        log: (...args) => sayWhileRunning({ type: 'log', message: args.map((arg) => String(arg)).join(' ') }),
        progress: (value) => sayWhileRunning({ type: 'progress', value: copy(value) }),
        signal,
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
    if (docs && before) {
      // Only a run that changed something waits, and then not in this tick:
      // a run that changed nothing says how it ended as soon as it did before.
      const waiting = reachServer(docs, reports, before, documentIdOf(job.taskUrl), (message) => say({ type: 'log', message }));
      if (waiting) {
        await waiting;
      }
    }
    over = true;
    say(outcome);
  }
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
    return findWhenThere({ find: once }, String(id), { sleep });
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

// Reachable before it is said
//
// A run worker's Repo keeps what the code wrote on this machine (its own
// directory or database) and sends it to the sync server in the background.
// Ending the worker first loses it, and the Repo does not send a stored
// document again by itself later: it loads one only when something asks for
// it. So a run's ending is said only once the sync server has reported, for
// every document whose heads changed while the code ran (the task's own
// document apart, which the worker only imports), heads equal to this Repo's
// latest. Documents others changed meanwhile are among them; the server
// reports those at once, because it gave them to us.

/** The most a run's ending waits for the sync server: far longer than 20 MB took (1.1-1.8 s), and short enough not to hold a slot when the server will not answer. */
export const REACH_LIMIT_MS = 30_000;
/** How often to ask the server for another round about a document it has not reported: a report that never comes is known to happen (openfoam: 1 in 19). */
export const RESYNC_EVERY_MS = 10_000;
/** How often to look again without a report: this Repo's heads can come to equal a report already heard (a change from the server arriving after its report). */
const LOOK_AGAIN_MS = 250;

/** Said once in a run's log when what it wrote cannot be sent now. */
export const STAYS_HERE =
  'Not connected to the sync server: what this run wrote stays on this machine until it is connected.';
/** Said in a run's log when the server has not acknowledged everything by REACH_LIMIT_MS. */
export const notReached = (left: number, of: number) =>
  `${left} of the ${of} documents this run wrote had not reached the sync server after ${REACH_LIMIT_MS / 1000} s.`;

/** A Repo that can say what the sync server holds (2.6.0-subduction.43 and the site's 2.6.0-rabbit.1 can). */
interface ServerRepo {
  on(event: 'subduction-remote-heads', listener: (report: RemoteHeads) => void): unknown;
  connectedSubductionPeerIds(): Promise<string[]>;
  resyncSubduction(documentId: DocumentId): void;
}
interface RemoteHeads {
  documentId: DocumentId;
  storageId: string;
  heads: readonly string[];
}

/** By document, the heads each Subduction peer last reported for it. */
type ServerReports = Map<string, Map<string, string>> & { listen(onReport: () => void): () => void };

/**
 * Heard from the Repo's first moment, because a report can come before
 * anyone waits for it, and the Repo does not repeat a report it has made.
 * Null for a Repo that cannot say (this package's own 2.6.0-subduction.20).
 */
function serverReports(repo: Repo): ServerReports | null {
  const it = repo as unknown as Partial<ServerRepo>;
  if (typeof it.on !== 'function' || typeof it.connectedSubductionPeerIds !== 'function' || typeof it.resyncSubduction !== 'function') {
    return null;
  }
  const listeners = new Set<() => void>();
  const reports = Object.assign(new Map<string, Map<string, string>>(), {
    listen(onReport: () => void) {
      listeners.add(onReport);
      return () => listeners.delete(onReport);
    },
  });
  it.on('subduction-remote-heads', ({ documentId, storageId, heads }) => {
    let byPeer = reports.get(String(documentId));
    if (!byPeer) {
      reports.set(String(documentId), (byPeer = new Map()));
    }
    byPeer.set(String(storageId), headsKey(heads));
    for (const listener of listeners) {
      listener();
    }
  });
  return reports;
}

const headsKey = (heads: readonly unknown[]) => [...heads].map(String).sort().join(',');

/** The heads of every document the Repo has a handle for. */
function headsOfAll(repo: Repo): Map<string, string> {
  const heads = new Map<string, string>();
  for (const [id, handle] of Object.entries(repo.handles)) {
    try {
      heads.set(id, headsKey(handle.heads()));
    } catch {
      // a deleted document has nothing to send
    }
  }
  return heads;
}

/**
 * Waits until the sync server holds what the code changed, or REACH_LIMIT_MS
 * has passed. Null, at once, when there is nothing to wait for: the code
 * changed nothing (and the log says nothing), or this Repo cannot say what
 * the server holds (and the log says what was written stays here).
 *
 * A Repo that is not connected is waited for only while its first attempt
 * to reach its server is still going (a run worker made for this run), since
 * that is a connection about to be made; one whose first attempt has ended
 * without a connection is offline, and the log says so at once.
 */
function reachServer(
  repo: Repo,
  reports: ServerReports | null,
  before: Map<string, string>,
  own: DocumentId,
  log: (message: string) => void,
): Promise<void> | null {
  /** The documents changed since `before`, each with its heads now. */
  const changed = () => {
    const now = headsOfAll(repo);
    now.delete(own);
    for (const [id, heads] of now) {
      if (heads === (before.get(id) ?? '')) {
        now.delete(id);
      }
    }
    return now;
  };
  if (changed().size === 0) {
    return null;
  }
  if (!reports) {
    log(STAYS_HERE);
    return null;
  }
  const server = repo as unknown as ServerRepo;
  const giveUpAt = Date.now() + REACH_LIMIT_MS;
  const connectedPeers = async () => new Set(await server.connectedSubductionPeerIds().catch(() => [] as string[]));
  return (async () => {
    let peers = await connectedPeers();
    if (peers.size === 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        firstAttempt(repo),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, giveUpAt - Date.now()))),
      ]);
      clearTimeout(timer);
      peers = await connectedPeers();
    }
    if (peers.size === 0) {
      log(STAYS_HERE);
      return;
    }
    const left = () =>
      [...changed()].filter(([id, heads]) => ![...(reports.get(id) ?? [])].some(([peer, key]) => peers.has(peer) && key === heads));
    if (left().length === 0) {
      return;
    }
    await new Promise<void>((done) => {
      const look = () => {
        if (left().length === 0) {
          finish();
        }
      };
      // The limit is set first, so that at the limit it comes before a resync that would be of no use.
      const limit = setTimeout(() => {
        log(notReached(left().length, changed().size));
        finish();
      }, Math.max(0, giveUpAt - Date.now()));
      const stopListening = reports.listen(look);
      const lookAgain = setInterval(look, LOOK_AGAIN_MS);
      const resync = setInterval(() => {
        for (const [id] of left()) {
          server.resyncSubduction(id as DocumentId);
        }
      }, RESYNC_EVERY_MS);
      function finish() {
        stopListening();
        clearInterval(lookAgain);
        clearInterval(resync);
        clearTimeout(limit);
        done();
      }
    });
  })();
}

/** The document id an `automerge:` url names. */
function documentIdOf(url: string): DocumentId {
  return url.slice('automerge:'.length).split('#')[0] as DocumentId;
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
