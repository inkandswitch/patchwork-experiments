// The page's side of this browser's pool. A page has one pool host, made
// the first time something starts it (the frame's background component,
// pool-starter.ts) and kept while anything holds it. Of the pages holding
// theirs, the one whose host holds the Web Lock `patchwork-tasks-pool` runs
// the pool, in a dedicated worker of its own (pool-worker.ts), and the rest
// wait in line for the lock. A browser profile therefore has one pool at a
// time, and when the tab running it closes or reloads the lock passes to a
// waiting tab at once.
//
// A host wants the pool only while all of these hold, and `decide` is the one
// place that acts on them: something in the page holds it; the storage
// document has been read and lists at least one served queue; the page is
// not hidden; and no newer build has been heard. Wanted, it asks for the lock
// and, given it, starts the pool's worker. No longer wanted while its pool
// runs, it drains: the pool takes nothing new, lets the runs going on end,
// and only then is ended and lets go of the lock (a hidden page ends it at
// once instead, see below). Wanted again during a drain, it asks anew once
// the drain is done. So a browser whose person serves no queue starts no
// pool worker, and with it no Repo and no connection to the sync server. Own
// is served from its making on (the background component that starts the
// host asks for it), so that is a browser whose person left every queue.
//
// - Views (the badge, the queue browser) only watch (`watchPoolHost`): a
//   page where nothing has started a pool host says so, and starts none. A
//   view in a frame that cannot look into the page around it says it cannot
//   see the pool from there (`poolOutOfSight`).
//
// - The pool's id is this profile's (pool-id.ts), so the next tab's pool owns
//   the runs the last one started and records those it lost.
// - It serves the queues listed in the task system's tool storage on the
//   account (`account.toolStorage[TASKS_STORAGE_ID]`, see helpers.ts), and is
//   told again whenever the account's pointer or that document changes. An
//   account that names no such document serves nothing.
// - It keeps the person's queues tidy, for whichever pool host follows the
//   account: whenever the account or the storage changes and the account
//   linked storage documents that lost (`storageLosersOf`) or the storage
//   marks a spare (`sparesOf`), it moves the losers' lists into the winner
//   (`mergeStorages`) and then asks for own (`ownQueue`), which folds every
//   spare into it. One such pass at a time, and one more if anything changed
//   meanwhile; one that fails is said in the console and done again on the
//   next change.
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
import { getAccountDocUrl, getTaskQueues, mergeStorages, storageLosersOf } from '../helpers';
import { ownQueue, sparesOf, storageUrlOf } from '../task-client.js';
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
 * - `out of sight`: nothing in this page has started one, and the page is a frame that cannot look into the page around it (`poolOutOfSight`), where a pool host may well be running.
 * - `reading`: held, but which queues this browser serves has not been read yet (or cannot be, with no Repo to read it from).
 * - `serves nothing`: held, and the storage lists no served queue, so no pool is asked for.
 * - `waiting`: another tab of this browser runs its pool; this one takes over when that one goes.
 * - `starting`, `running`: this tab runs the pool.
 * - `letting go`: nothing in this page held the pool; it takes nothing new and finishes what it has (held again meanwhile, it asks for the lock anew once that is done).
 * - `winding down`: the last served queue was left; this tab's pool takes nothing new and finishes what it has (a queue served again meanwhile, it asks for the lock anew once that is done).
 * - `handing over`: a newer build is in another tab; this one's pool takes nothing new and finishes what it has.
 * - `stood down`: a newer build is in another tab, and this one runs nothing from now on.
 * - `unavailable`: there is no pool here (`problem` says why; `retryAt`, when it tries again, if it will).
 */
export type PoolHostState =
  | 'not started'
  | 'out of sight'
  | 'reading'
  | 'serves nothing'
  | 'waiting'
  | 'starting'
  | 'running'
  | 'letting go'
  | 'winding down'
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

/** What a view in a frame that cannot look into the page around it sees, where nothing in the frame has started a pool host. */
export const OUT_OF_SIGHT: PoolHostStatus = { ...NOT_STARTED, state: 'out of sight' };

/**
 * Whether this page is inside a frame that may not look into a page around
 * it: a frame of another origin than some page it is in, which includes a
 * frame sandboxed into an opaque origin (threepane's isolation mode shows
 * tools in an `<iframe sandbox="allow-scripts">`). Reading another origin's
 * `document` throws, so each page above is tried in turn. Such a frame's
 * pool host, if it has one, is in the page around it, which keeps its pool
 * hosts on its own window, out of the frame's reach: what the frame holds
 * itself is all it can know. A frame of the same origin all the way up is
 * not out of sight: it can see that nothing in itself started a pool host,
 * and says so.
 */
export function poolOutOfSight(view: Window = window): boolean {
  let frame = view;
  while (frame.parent && frame.parent !== frame) {
    try {
      void frame.parent.document;
    } catch {
      return true;
    }
    frame = frame.parent;
  }
  return false;
}

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
 * it changes, starting nothing: while there is none, `NOT_STARTED`, or
 * `OUT_OF_SIGHT` in a frame that cannot see the page around it. Of hosts
 * of two builds in one page, the newer's, which is the one that can run the
 * pool. Returns how to stop.
 */
export function watchPoolHost(listener: (status: PoolHostStatus) => void): () => void {
  const hosts = pageHosts();
  const none = poolOutOfSight() ? OUT_OF_SIGHT : NOT_STARTED;
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
    listener(newest ? newest.status() : none);
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
  /** The worker has said its pool is ready. */
  ready: boolean;
  /** The worker has been told to drain: told once, whatever the reasons. */
  draining: boolean;
  /** Ends the pool's worker and lets go of the lock, once. */
  end(): void;
}

/** Why a running pool drains, the latest reason winning, since each is true from when it arose until the drain ends. */
type Drain = 'let go' | 'nothing served' | 'newer build';

class BrowserPoolHost implements PoolHost {
  private current: PoolHostStatus = NOT_STARTED;
  private readonly listeners = new Set<(status: PoolHostStatus) => void>();
  private queues: ServedQueues = {};
  /** Whether `queues` has been read from the account (an account that names no storage is read as serving nothing). */
  private known = false;
  private following = false;
  /** How many things in this page hold it now. */
  private holds = 0;
  private asking: AbortController | null = null;
  private held: Held | null = null;
  private drain: Drain | null = null;
  private busy = 0;
  /** Why the last pool could not run, and when it is tried again, while that stands (only while the pool is wanted). */
  private failure: { problem: string; retryAt?: number } | null = null;
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
        this.standing = true;
        this.decide();
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
      this.decide();
    };
    const back = () => {
      if (this.hidden) {
        this.hidden = false;
        this.decide();
      }
    };
    window.addEventListener('pagehide', away);
    document.addEventListener('freeze', away);
    window.addEventListener('pageshow', back);
    document.addEventListener('resume', back);
  }

  hold() {
    this.holds += 1;
    this.decide();
    let held = true;
    return () => {
      if (!held) {
        return;
      }
      held = false;
      this.holds -= 1;
      this.decide();
    };
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
      this.setQueues({});
      return;
    }
    this.following = true;
    const accountUrl = url;
    let account: { doc(): unknown } | null = null;
    let storage: { doc(): unknown } | null = null;
    const tidy = () => this.tidy(repo, () => [account?.doc(), storage?.doc()]);
    // A document that is not here yet is never an error, only something to
    // try again: both finds below retry until they have it, or until what
    // they were finding is no longer wanted.
    let storageUrl: AutomergeUrl | null | undefined; // undefined: not read yet
    let unfollowStorage = () => {};
    const followStorage = (next: AutomergeUrl | null) => {
      if (next === storageUrl) {
        return;
      }
      unfollowStorage();
      storageUrl = next;
      storage = null;
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
            storage = handle;
            const show = () => {
              this.setQueues(servedQueuesOf(handle.doc()));
              tidy();
            };
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
          account = handle;
          const show = () => {
            followStorage(storageUrlOf(handle.doc()) as AutomergeUrl | null);
            tidy();
          };
          handle.on('change', show);
          show();
        },
        () => setTimeout(load, 2_000),
      );
    void load();
  }

  /** A pass of `tidy` is going on; and whether another was asked for meanwhile. */
  private tidying = false;
  private tidyAgain = false;

  /**
   * Moves what losing storage documents list into the winner, and folds the
   * spares into own (see the header), when the account and the storage as
   * they are now have any.
   */
  private tidy(repo: Repo, now: () => [account: unknown, storage: unknown]) {
    const [account, storage] = now();
    if (storageLosersOf(account).length === 0 && sparesOf(storage).length === 0) {
      return;
    }
    if (this.tidying) {
      this.tidyAgain = true;
      return;
    }
    this.tidying = true;
    void (async () => {
      try {
        await mergeStorages(repo, now()[0]);
        await ownQueue(repo);
      } catch (error) {
        console.warn(`tasks: your task queues could not be tidied now: ${(error as Error)?.message ?? error}`);
      } finally {
        this.tidying = false;
        if (this.tidyAgain) {
          this.tidyAgain = false;
          this.tidy(repo, now);
        }
      }
    })();
  }

  private setQueues(queues: ServedQueues) {
    if (this.known && JSON.stringify(queues) === JSON.stringify(this.queues)) {
      return;
    }
    this.known = true;
    this.queues = queues;
    this.tell({ type: 'serve', queues });
    this.decide();
  }

  private tell(message: ToPoolWorker) {
    this.held?.worker.postMessage(message);
  }

  /**
   * Why this page should not run the pool now, or null when it should. A
   * hidden page comes first, whatever else holds: a pool left to drain in a
   * frozen page keeps the lock, with its runs unheard, until the page wakes,
   * so it is ended at once instead.
   */
  private unwanted(): Drain | 'hidden' | 'unread' | null {
    if (this.hidden) {
      return 'hidden';
    }
    if (this.standing) {
      return 'newer build';
    }
    if (this.holds === 0) {
      return 'let go';
    }
    if (!this.known) {
      return 'unread';
    }
    if (Object.keys(this.queues).length === 0) {
      return 'nothing served';
    }
    return null;
  }

  /**
   * Acts on what is now, after anything that bears on it changes: asks for
   * the lock when the pool is wanted here, and otherwise stops asking and
   * drains a pool running here (or, in a hidden page, ends it at once). Then
   * says the status that follows.
   */
  private decide() {
    const why = this.unwanted();
    if (why === null) {
      this.ask();
    } else {
      this.asking?.abort();
      this.asking = null;
      // A failure is tried again only for as long as the pool is wanted:
      // wanted again later, it is tried at once.
      clearTimeout(this.retry);
      this.failure = null;
      if (!this.held || why === 'unread') {
        // nothing runs here (and a pool runs only once the list has been read)
      } else if (why === 'hidden') {
        this.held.end();
      } else {
        this.drain = why;
        if (!this.held.draining) {
          this.held.draining = true;
          this.tell({ type: 'stop', drain: true });
        }
      }
    }
    this.show();
  }

  /**
   * Says the status that follows from what is now. A failure stands only
   * while the pool is wanted and none runs here: `decide` clears it when the
   * pool is not wanted, and a pool is started only when there is none.
   */
  private show() {
    this.set({
      state: this.state(),
      busy: this.held ? this.busy : 0,
      problem: this.failure?.problem,
      retryAt: this.failure?.retryAt,
    });
  }

  private state(): PoolHostState {
    if (this.held) {
      if (this.held.draining) {
        return this.drain === 'newer build' ? 'handing over' : this.drain === 'let go' ? 'letting go' : 'winding down';
      }
      return this.held.ready ? 'running' : 'starting';
    }
    if (this.standing) {
      return 'stood down';
    }
    if (this.holds === 0) {
      return 'not started';
    }
    if (!this.known) {
      return 'reading';
    }
    if (Object.keys(this.queues).length === 0) {
      return 'serves nothing';
    }
    return this.failure ? 'unavailable' : 'waiting';
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

  /** Asks for the lock, unless this page has it, is asking, or is waiting to try again after a failure. */
  private ask() {
    if (this.asking || this.held || this.failure) {
      return;
    }
    if (!navigator.locks) {
      // Never tried again: without Web Locks it never could run.
      this.failure = { problem: 'this browser cannot keep its tabs to one pool (it has no Web Locks)' };
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
    if (this.unwanted() !== null) {
      // no longer wanted between asking and being given the lock
      this.show();
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
        ready: false,
        draining: false,
        end: () => {
          if (ended) {
            return;
          }
          ended = true;
          clearInterval(poll);
          worker.terminate();
          if (this.held === held) {
            this.held = null;
            this.drain = null;
            this.busy = 0;
          }
          release();
        },
      };
      this.held = held;
      this.busy = 0;
      this.drain = null;
      this.current = { ...this.current, id, name }; // said with the state that follows, at once
      this.show();

      const failed = (problem: string) => {
        console.error(`tasks: this browser's pool stopped: ${problem}`);
        held.end();
        if (this.unwanted() === null) {
          this.failure = { problem, retryAt: Date.now() + RETRY_MS };
          clearTimeout(this.retry);
          this.retry = setTimeout(() => {
            this.failure = null;
            this.decide();
          }, RETRY_MS);
        }
        this.decide();
      };
      // Once the pool has said it is ready, an error event from its worker
      // is something that escaped the worker's code (from inside its Repo,
      // say), not the worker dying: a worker goes on after an uncaught
      // error. Ending the pool for it would cost every run it has, and leave
      // a tab with no other tab serving nothing for RETRY_MS. A pool that
      // has really died, or is stuck, is noticed by its silence instead:
      // `unansweredSince` is when the oldest status request still without
      // an answer was sent, looked at on each request.
      let unansweredSince: number | null = null;
      worker.onmessage = ({ data }: MessageEvent<FromPoolWorker>) => {
        if (ended) {
          return; // a message sent before the worker was ended
        }
        switch (data?.type) {
          case 'ready':
            held.ready = true;
            unansweredSince = null;
            this.show();
            break;
          case 'status':
            unansweredSince = null;
            this.busy = data.busy;
            this.show();
            break;
          case 'stopped':
            held.end();
            this.decide();
            break;
          case 'failed':
            failed(data.message);
            break;
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        if (held.ready) {
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
        if (held.ready && unansweredSince !== null && Date.now() - unansweredSince > UNANSWERED_MS) {
          failed(`its worker has not answered for ${Math.round((Date.now() - unansweredSince) / 1000)} s`);
          return;
        }
        if (held.ready && unansweredSince === null) {
          unansweredSince = Date.now();
        }
        worker.postMessage({ type: 'status' } satisfies ToPoolWorker);
      }, BEAT_MS);
    });
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
