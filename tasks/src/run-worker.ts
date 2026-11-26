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
// `ctx.repo` is saved, and has reached the page's Repo through the link, or
// with no link has been acknowledged by the sync server, before this says
// how the code ended (see "Reachable before it is said" and "..., through
// the link" below), so that whoever reads the ending can find what the run
// wrote, and ending this worker afterwards loses nothing.
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
  /** In a browser, its end of a link to the site's Repo in the page above its pool (browser/link.ts), when there is one. */
  link?: MessagePort;
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
  | { type: 'settled'; run: string };

/** What a run worker says, about the job it has. */
export type FromRunWorker =
  | { type: 'log'; message: string }
  | { type: 'progress'; value: unknown }
  /** Its code returned this, and what the code wrote is saved and has reached the page's Repo (linked) or the sync server, or the log says why not. */
  | { type: 'done'; result: unknown }
  /** Its code threw, would not load, or what it wrote could not be saved; said, like `done`, once what it wrote has reached the page's Repo or the sync server, or the log says why not. */
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
          .then(() => getRepo(settings.repoConfig, `task-run-${crypto.randomUUID()}`, settings.place, settings.link))
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
        await saveChanged(docs, before);
      } catch (error) {
        // what it wrote is not safe yet, so it is not done
        outcome = { type: 'threw', message: `what its code wrote could not be saved: ${messageOf(error)}` };
      }
    }
    if (docs && before) {
      // Only a run that changed something waits, and then not in this tick:
      // a run that changed nothing says how it ended as soon as it did before.
      const own = documentIdOf(job.taskUrl);
      const log = (message: string) => say({ type: 'log', message });
      const waiting = linked(docs) ? reachPage(docs, before, own, log) : reachServer(docs, reports, before, own, log);
      if (waiting) {
        await waiting;
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

// Reachable before it is said
//
// A run worker with no link (a Node host's thread, or a browser's whose page
// gave none) keeps what the code wrote on this machine (its own
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
  'Not connected to the sync server: what this run wrote stays on this machine, and is sent only if this worker is still running when it connects.';
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

/** The documents whose heads differ from `before`, each with its heads now: those made since, and those changed since. */
function changedSince(repo: Repo, before: Map<string, string>): Map<string, string> {
  const now = headsOfAll(repo);
  for (const [id, heads] of now) {
    if (heads === (before.get(id) ?? '')) {
      now.delete(id);
    }
  }
  return now;
}

/**
 * Saves what the code changed before the run says how it ended, and only
 * that: a save makes the storage write each document it names out to the
 * disk at once, which for the task's own document, imported and never
 * written, costs tens of milliseconds on every run for nothing. The task's
 * own document is saved too when its heads changed, since code can write
 * to it. Everything is saved when what changed cannot be told (`before` is
 * null: the code was never called).
 */
function saveChanged(repo: Repo, before: Map<string, string> | null): Promise<void> {
  if (!before) {
    return repo.flush();
  }
  const changed = [...changedSince(repo, before).keys()] as DocumentId[];
  return changed.length > 0 ? repo.flush(changed) : Promise.resolve();
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
    const now = changedSince(repo, before);
    now.delete(own);
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

// Reachable before it is said, through the link
//
// A run worker linked to the site's Repo in the page above its pool
// (browser/link.ts) says how a run ended once the page's Repo has what the
// code changed: for every document whose heads changed while the code ran
// (the task's own apart, as above), the page has said, in the sync it runs
// with this Repo over the link, heads equal to this Repo's latest. That is
// the Repo's own record of a peer (`getSyncInfo` of the page's storage id,
// kept from the sync state, and its 'remote-heads' event); nothing is asked
// of the page beyond the sync itself. The page's Repo keeps what it has, and
// sends it to the sync server when there is one, so a linked run does not
// wait for the server, and does not wait on it when it cannot be reached.
// A run that wrote a document the page will not take (one keyhive protects:
// the link gives no such document over, either way) waits REACH_LIMIT_MS and
// says so in its log.

/** Said in a run's log when the page's Repo has not had everything by REACH_LIMIT_MS. */
export const notReachedPage = (left: number, of: number) =>
  `${left} of the ${of} documents this run wrote had not reached the page after ${REACH_LIMIT_MS / 1000} s.`;

/** What a linked Repo says of its peers. */
interface LinkedRepo {
  networkSubsystem?: { adapters?: unknown[] };
  peers: string[];
  getStorageIdOfPeer(peerId: string): string | undefined;
}
interface PeerHandle {
  getSyncInfo?(storageId: string): { lastHeads?: readonly string[] } | undefined;
  on?(event: 'remote-heads', listener: () => void): unknown;
  off?(event: 'remote-heads', listener: () => void): unknown;
}

/** Whether this worker's Repo is linked to a page: it has a network adapter, and the link is the only one a worker's Repo is given. */
function linked(repo: Repo): boolean {
  return ((repo as unknown as LinkedRepo).networkSubsystem?.adapters?.length ?? 0) > 0;
}

/**
 * Waits until the page's Repo has what the code changed (see above), or
 * REACH_LIMIT_MS has passed. Null, at once, when the code changed nothing.
 */
export function reachPage(
  repo: Repo,
  before: Map<string, string>,
  own: DocumentId,
  log: (message: string) => void,
  limitMs = REACH_LIMIT_MS,
): Promise<void> | null {
  const changed = () => {
    const now = changedSince(repo, before);
    now.delete(own);
    return now;
  };
  if (changed().size === 0) {
    return null;
  }
  const peers = repo as unknown as LinkedRepo;
  /** The page's storage id: its Repo's, as it said when the link was made; undefined until it has. */
  const page = () => {
    for (const peer of peers.peers) {
      const storageId = peers.getStorageIdOfPeer(peer);
      if (storageId) {
        return storageId;
      }
    }
    return undefined;
  };
  const left = () => {
    const storageId = page();
    return [...changed()].filter(([id, heads]) => {
      const handle = repo.handles[id as DocumentId] as unknown as PeerHandle | undefined;
      return !storageId || headsKey(handle?.getSyncInfo?.(storageId)?.lastHeads ?? []) !== heads;
    });
  };
  return new Promise<void>((done) => {
    const handles = [...changed().keys()].map((id) => repo.handles[id as DocumentId] as unknown as PeerHandle | undefined);
    let over = false;
    const look = () => {
      if (!over && left().length === 0) {
        finish();
      }
    };
    const limit = setTimeout(() => {
      log(notReachedPage(left().length, changed().size));
      finish();
    }, limitMs);
    // The page's answers are heard as they come; looking again as well
    // catches heads that came to match by a change of this Repo's own.
    const lookAgain = setInterval(look, LOOK_AGAIN_MS);
    for (const handle of handles) {
      handle?.on?.('remote-heads', look);
    }
    function finish() {
      over = true;
      clearTimeout(limit);
      clearInterval(lookAgain);
      for (const handle of handles) {
        handle?.off?.('remote-heads', look);
      }
      done();
    }
    look();
  });
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
