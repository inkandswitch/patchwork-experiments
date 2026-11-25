// The page's side of this browser's pool. A page has one pool host, made
// the first time something starts it (the frame's background component,
// pool-starter.ts) and kept while anything holds it. Of the pages holding
// theirs, the one whose host holds the Web Lock `patchwork-tasks-pool` runs
// the pool, in a dedicated worker of its own (pool-worker.ts), and the rest
// wait in line for the lock. A browser profile therefore has one pool at a
// time, and when the tab running it closes or reloads the lock passes to a
// waiting tab at once.
//
// - Holding is what asks for the lock. When the last hold in a page is let
//   go (the frame that mounted the component is gone), its pool takes
//   nothing new, lets the runs going on end, and then lets go of the lock;
//   until something holds it again the page has no part in the pool.
// - Views (the badge, the queue browser) only watch (`watchPoolHost`): a
//   page where nothing has started a pool host says so, and starts none.
//
// - The pool's id is this profile's (pool-id.ts), so the next tab's pool owns
//   the runs the last one started and records those it lost.
// - It serves the queues listed in the task system's tool storage on the
//   account (`account.toolStorage[TASKS_STORAGE_ID]`, see helpers.ts), and is
//   told again whenever the account's pointer or that document changes. An account that names no such document serves nothing.
// - On `pagehide` or `freeze` it ends its pool at once and lets the lock go,
//   and on `pageshow` or `resume` asks again. A page kept in the
//   back/forward cache, or frozen in the background, would otherwise hold
//   the lock, frozen, for minutes, with its runs unheard. The runs it had
//   are recorded lost by the next pool, and taken again.
// - A pool that cannot start is ended and tried again RETRY_MS later. One
//   that has started is ended only when its worker stops answering
//   (UNANSWERED_MS); an error it reports is logged, and it goes on.
//
// A newer build. The tab holding the lock runs the build it loaded. Every
// host says its build on BUILD_CHANNEL when it starts, and answers an
// older one with its own. A host that hears of a newer build stands down for
// good: if it is waiting it stops waiting, and if it runs the pool it serves
// no queue from then on, lets the runs going on end by themselves, and only
// then stops its pool and lets go of the lock, so the newer build's host gets
// it. What that costs: tasks asked meanwhile wait until the old pool's runs
// have ended, however long those take. What it does not defend against: any
// page of this origin can say a build, so any of them can make every host
// stand down (they then run nothing until a page is loaded again). That
// denies service; it runs no code.

import type { AutomergeUrl, Repo } from '@automerge/automerge-repo/slim';
import { acceptanceOf } from '../acceptance';
import { getAccountDocUrl, getTaskQueues } from '../helpers';
import { storageUrlOf } from '../task-client.js';
import { getRepoConfig } from '../repo-config';
import { BEAT_MS, LAPSE_MS } from '../task-rules.js';
import { browserPoolId, browserPoolName } from './pool-id';
import type { FromPoolWorker, ServedQueues, ToPoolWorker } from './pool-worker';

declare const __TASKS_BUILD__: number | undefined;

/** When this copy of the package was built (vite.config.ts): of two builds, the larger is the newer. 0 where nothing stamped it. */
export const BUILD: number = typeof __TASKS_BUILD__ === 'number' ? __TASKS_BUILD__ : 0;

/** The Web Lock whose holder runs this browser profile's pool. */
export const POOL_LOCK = 'patchwork-tasks-pool';

/** Where this origin's pool hosts say which build they are. */
export const BUILD_CHANNEL = 'patchwork-tasks-build';

/**
 * How many runs at once. A run that exhausts its heap crashes the whole tab,
 * and every run in it with it, so this leaves the machine two cores and is
 * kept small.
 */
const SLOTS = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));

/** How long a pool that could not start waits before trying again. */
const RETRY_MS = 60_000;

/**
 * How long a running pool's worker may leave a status request unanswered
 * before this page takes it for dead (or stuck) and ends it. Its runs have
 * then gone unheard for three lapses, so others may already have taken them;
 * ending it lets the lock go to a tab that can run a pool. A worker answers
 * at once whenever its thread is free, so only one that has died or is stuck
 * in synchronous code stays silent this long.
 */
const UNANSWERED_MS = 3 * LAPSE_MS;

/**
 * - `not started`: nothing in this page has started the pool host, or nothing holds it any more.
 * - `waiting`: another tab of this browser runs its pool; this one takes over when that one goes.
 * - `starting`, `running`: this tab runs the pool.
 * - `letting go`: nothing in this page held the pool; it takes nothing new and finishes what it has (held again meanwhile, it asks for the lock anew once that is done).
 * - `handing over`: a newer build is in another tab; this one's pool takes nothing new and finishes what it has.
 * - `stood down`: it has handed over, and runs nothing from now on.
 * - `unavailable`: there is no pool here (`problem` says why; `retryAt`, when it tries again, if it will).
 */
export type PoolHostState =
  | 'not started'
  | 'waiting'
  | 'starting'
  | 'running'
  | 'letting go'
  | 'handing over'
  | 'stood down'
  | 'unavailable';

export interface PoolHostStatus {
  state: PoolHostState;
  /** Runs going on, while this tab runs the pool. */
  busy: number;
  slots: number;
  /** The pool's id and name, once this tab has run it. */
  id: string | null;
  name: string | null;
  problem?: string;
  /** When an unavailable pool tries again (ms since the epoch); absent when it will not. */
  retryAt?: number;
}

/** What a page where nothing has started a pool host is. */
export const NOT_STARTED: PoolHostStatus = { state: 'not started', busy: 0, slots: SLOTS, id: null, name: null };

export interface PoolHost {
  status(): PoolHostStatus;
  /** Calls `listener` whenever the status changes. Returns how to stop. */
  subscribe(listener: (status: PoolHostStatus) => void): () => void;
  /** Keeps this page in the pool until the returned function is called. */
  hold(): () => void;
}

/**
 * Starts the page's pool host and holds it: one host per page and build,
 * however many things start it, kept in the pool while any of them holds it.
 * A newer build loaded into the same page starts its own, and this one
 * stands down for it as for any other tab. `hostRepo` is the site's Repo,
 * which the account document comes from. Returns how to let go, once.
 */
export function startPoolHost(hostRepo: Repo | undefined): () => void {
  const hosts = pageHosts();
  let host = hosts.poolHosts[BUILD] as BrowserPoolHost | undefined;
  if (!host) {
    host = hosts.poolHosts[BUILD] = new BrowserPoolHost();
    hosts.hostsChanged.dispatchEvent(new Event('change'));
  }
  if (hostRepo) {
    host.followAccount(hostRepo);
  }
  return host.hold();
}

/**
 * Calls `listener` with the status of this page's pool host now and whenever
 * it changes, starting nothing: `NOT_STARTED` while there is none. Of hosts
 * of two builds in one page, the newer's, which is the one that can run the
 * pool. Returns how to stop.
 */
export function watchPoolHost(listener: (status: PoolHostStatus) => void): () => void {
  const hosts = pageHosts();
  let watched: PoolHost | null | undefined; // null: none, once looked
  let unsubscribe = () => {};
  const look = () => {
    const builds = Object.keys(hosts.poolHosts).map(Number).sort((a, b) => b - a);
    const newest: PoolHost | null = builds.length ? hosts.poolHosts[builds[0]] : null;
    if (newest === watched) {
      return;
    }
    unsubscribe();
    watched = newest;
    unsubscribe = newest ? newest.subscribe(listener) : () => {};
    listener(newest ? newest.status() : NOT_STARTED);
  };
  hosts.hostsChanged.addEventListener('change', look);
  look();
  return () => {
    hosts.hostsChanged.removeEventListener('change', look);
    unsubscribe();
  };
}

/**
 * Where a page keeps its pool hosts, by build, on the window, so that two
 * copies of this module (two builds of the package in one page) find each
 * other's, and `hostsChanged`, which says a host has been made.
 */
function pageHosts(): { poolHosts: Record<number, PoolHost>; hostsChanged: EventTarget } {
  const tab = window as any;
  tab.patchworkTasks ??= {};
  tab.patchworkTasks.poolHosts ??= {};
  tab.patchworkTasks.hostsChanged ??= new EventTarget();
  return tab.patchworkTasks;
}

interface Held {
  worker: Worker;
  /** Ends the pool's worker and lets go of the lock, once. */
  end(): void;
}

class BrowserPoolHost implements PoolHost {
  private current: PoolHostStatus = NOT_STARTED;
  private readonly listeners = new Set<(status: PoolHostStatus) => void>();
  private queues: ServedQueues = {};
  private following = false;
  /** How many things in this page hold it now: only a held host asks for the lock. */
  private holds = 0;
  private asking: AbortController | null = null;
  private held: Held | null = null;
  /** Between `pagehide` and `pageshow`, or `freeze` and `resume`. */
  private hidden = false;
  /** A newer build is here: never run the pool again. */
  private standing = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const channel = new BroadcastChannel(BUILD_CHANNEL);
    channel.onmessage = ({ data }) => {
      const build = Number(data?.build);
      if (!Number.isFinite(build)) {
        return;
      }
      if (build > BUILD) {
        this.standDown();
      } else if (build < BUILD) {
        channel.postMessage({ build: BUILD }); // so that a host of an older build that started later hears of this one
      }
    };
    channel.postMessage({ build: BUILD });

    // A page that is frozen without being left (the browser freezes some
    // background tabs to save power) freezes its workers too, the pool's
    // among them, and a frozen holder keeps its lock: so it lets go on
    // `freeze` as on `pagehide`, and asks again on `resume`.
    const away = () => {
      this.hidden = true;
      this.asking?.abort();
      this.asking = null;
      if (this.held) {
        this.held.end();
        this.set({ state: this.idle(), busy: 0 });
      }
    };
    const back = () => {
      if (this.hidden) {
        this.hidden = false;
        this.ask();
      }
    };
    window.addEventListener('pagehide', away);
    document.addEventListener('freeze', away);
    window.addEventListener('pageshow', back);
    document.addEventListener('resume', back);
  }

  hold() {
    this.holds += 1;
    if (this.current.state === 'not started') {
      this.set({ state: 'waiting' });
    }
    this.ask();
    let held = true;
    return () => {
      if (!held) {
        return;
      }
      held = false;
      this.holds -= 1;
      if (this.holds === 0) {
        this.letGo();
      }
    };
  }

  /** What this host is when it is not running the pool. */
  private idle(): PoolHostState {
    return this.standing ? 'stood down' : this.holds > 0 ? 'waiting' : 'not started';
  }

  /**
   * Nothing in this page holds the pool any more. A pool running here takes
   * nothing new and lets the lock go once its runs have ended, as when
   * handing over to a newer build; one asked for is no longer asked for.
   */
  private letGo() {
    clearTimeout(this.retry);
    this.asking?.abort();
    this.asking = null;
    if (this.standing) {
      return;
    }
    if (this.held) {
      this.tell({ type: 'stop', drain: true });
      this.set({ state: 'letting go' });
    } else {
      this.set({ state: 'not started', busy: 0, problem: undefined, retryAt: undefined });
    }
  }

  status() {
    return this.current;
  }

  subscribe(listener: (status: PoolHostStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Follows the queues to serve, from the site's Repo: the account, and the
   * storage document it names, which lists them. Only the first
   * Repo given is used.
   */
  followAccount(repo: Repo) {
    if (this.following) {
      return;
    }
    let url: AutomergeUrl | null = null;
    try {
      url = getAccountDocUrl();
    } catch {
      // no account can be found here: nothing is served
    }
    if (!url) {
      return;
    }
    this.following = true;
    const accountUrl = url;
    // A document that is not here yet is never an error, only something to
    // try again: both finds below retry until they have it, or until what
    // they were finding is no longer wanted.
    let storageUrl: AutomergeUrl | null = null;
    let unfollowStorage = () => {};
    const followStorage = (next: AutomergeUrl | null) => {
      if (next === storageUrl) {
        return;
      }
      unfollowStorage();
      storageUrl = next;
      if (!next) {
        unfollowStorage = () => {};
        this.setQueues({});
        return;
      }
      // Until the newly named document is here, the list being served stays
      // as it was: the pointer changes only when the document is first made
      // (from none, when nothing was served) or when two makings merge.
      let wanted = true;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let stop = () => {};
      const load = () =>
        repo.find<unknown>(next).then(
          (handle) => {
            if (!wanted) {
              return;
            }
            const show = () => this.setQueues(servedQueuesOf(handle.doc()));
            handle.on('change', show);
            stop = () => handle.off('change', show);
            show();
          },
          () => {
            if (wanted) {
              retry = setTimeout(load, 2_000);
            }
          },
        );
      unfollowStorage = () => {
        wanted = false;
        clearTimeout(retry);
        stop();
      };
      void load();
    };
    const load = () =>
      repo.find<unknown>(accountUrl).then(
        (handle) => {
          const show = () => followStorage(storageUrlOf(handle.doc()) as AutomergeUrl | null);
          handle.on('change', show);
          show();
        },
        () => setTimeout(load, 2_000),
      );
    void load();
  }

  private set(change: Partial<PoolHostStatus>) {
    const next = { ...this.current, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.current)) {
      return;
    }
    this.current = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch (error) {
        console.error('tasks: a pool status listener failed', error);
      }
    }
  }

  private setQueues(queues: ServedQueues) {
    if (JSON.stringify(queues) === JSON.stringify(this.queues)) {
      return;
    }
    this.queues = queues;
    this.tell({ type: 'serve', queues });
  }

  private tell(message: ToPoolWorker) {
    this.held?.worker.postMessage(message);
  }

  /** Asks for the lock, unless nothing holds this host, or this page has the lock, is asking, is hidden or has stood down. */
  private ask() {
    if (this.holds === 0 || this.standing || this.hidden || this.asking || this.held) {
      return;
    }
    if (!navigator.locks) {
      this.set({ state: 'unavailable', problem: 'this browser cannot keep its tabs to one pool (it has no Web Locks)' });
      return;
    }
    const asking = new AbortController();
    this.asking = asking;
    navigator.locks
      .request(POOL_LOCK, { mode: 'exclusive', signal: asking.signal }, () => {
        if (this.asking === asking) {
          this.asking = null;
        }
        return this.run();
      })
      .catch((error) => {
        if (this.asking === asking) {
          this.asking = null;
        }
        if (error?.name !== 'AbortError') {
          console.error('tasks: asking for the pool lock failed', error);
        }
      });
  }

  /** Runs the pool while this page holds the lock: the lock is let go when the promise settles. */
  private run(): Promise<void> {
    if (this.holds === 0 || this.standing || this.hidden) {
      return Promise.resolve();
    }
    return new Promise<void>((release) => {
      const id = browserPoolId();
      const name = browserPoolName(id);
      const worker = new Worker(new URL('./pool-worker.ts', import.meta.url), {
        type: 'module',
        name: 'patchwork-tasks-pool',
      });
      let ended = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      const held: Held = {
        worker,
        end: () => {
          if (ended) {
            return;
          }
          ended = true;
          clearInterval(poll);
          worker.terminate();
          if (this.held === held) {
            this.held = null;
          }
          release();
        },
      };
      this.held = held;
      this.set({ state: 'starting', id, name, busy: 0, problem: undefined, retryAt: undefined });

      const failed = (problem: string) => {
        console.error(`tasks: this browser's pool stopped: ${problem}`);
        held.end();
        if (this.holds === 0) {
          // it was being let go: there is nothing to try again for
          this.set({ state: this.idle(), busy: 0 });
          return;
        }
        this.set({ state: 'unavailable', busy: 0, problem, retryAt: Date.now() + RETRY_MS });
        clearTimeout(this.retry);
        this.retry = setTimeout(() => {
          this.set({ state: this.idle(), problem: undefined, retryAt: undefined });
          this.ask();
        }, RETRY_MS);
      };
      // Once the pool has said it is ready, an error event from its worker
      // is something that escaped the worker's code (from inside its Repo,
      // say), not the worker dying: a worker goes on after an uncaught
      // error. Ending the pool for it would cost every run it has, and leave
      // a tab with no other tab serving nothing for RETRY_MS. A pool that
      // has really died, or is stuck, is noticed by its silence instead:
      // `unansweredSince` is when the oldest status request still without
      // an answer was sent, looked at on each request.
      let ready = false;
      let unansweredSince: number | null = null;
      worker.onmessage = ({ data }: MessageEvent<FromPoolWorker>) => {
        switch (data?.type) {
          case 'ready':
            ready = true;
            unansweredSince = null;
            if (!this.standing && this.holds > 0) {
              this.set({ state: 'running' });
            }
            break;
          case 'status':
            unansweredSince = null;
            this.set({ busy: data.busy });
            break;
          case 'stopped':
            held.end();
            this.set({ state: this.idle(), busy: 0 });
            this.ask();
            break;
          case 'failed':
            failed(data.message);
            break;
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        if (ready) {
          console.error(`tasks: this browser's pool hit an error, and goes on: ${event.message}`);
        } else {
          failed(event.message || 'its worker could not be started');
        }
      };

      worker.postMessage({
        type: 'start',
        repoConfig: getRepoConfig(),
        id,
        name,
        slots: SLOTS,
        queues: this.queues,
        importMap: pageImportMap(),
        baseURI: document.baseURI,
      } satisfies ToPoolWorker);
      // The status the badge shows, and the pool's sign of life. A hidden
      // page's timers slow to one a minute after five minutes, so silence is
      // measured from when a request was sent, not counted in requests.
      poll = setInterval(() => {
        if (ready && unansweredSince !== null && Date.now() - unansweredSince > UNANSWERED_MS) {
          failed(`its worker has not answered for ${Math.round((Date.now() - unansweredSince) / 1000)} s`);
          return;
        }
        if (ready && unansweredSince === null) {
          unansweredSince = Date.now();
        }
        worker.postMessage({ type: 'status' } satisfies ToPoolWorker);
      }, BEAT_MS);
    });
  }

  /** A newer build is running somewhere on this origin: hand over to it, for good. */
  private standDown() {
    if (this.standing) {
      return;
    }
    this.standing = true;
    clearTimeout(this.retry);
    this.asking?.abort();
    this.asking = null;
    if (this.held) {
      this.tell({ type: 'stop', drain: true });
      this.set({ state: 'handing over' });
    } else {
      this.set({ state: 'stood down', busy: 0 });
    }
  }
}

/** What the task storage document says to serve: each queue with whose code to run from it. */
function servedQueuesOf(storage: unknown): ServedQueues {
  const queues: ServedQueues = {};
  for (const [url, setting] of Object.entries(getTaskQueues(storage))) {
    const acceptance = acceptanceOf(setting);
    if (acceptance !== undefined) {
      queues[url as AutomergeUrl] = acceptance;
    }
  }
  return queues;
}

/** The page's import map, which the pool's Repo and a task's bare imports resolve by. */
function pageImportMap(): unknown {
  const element = document.querySelector('script[type="importmap"]');
  try {
    return JSON.parse(element?.textContent || '{}');
  } catch (error) {
    console.warn("tasks: the page's import map could not be read", error);
    return {};
  }
}
