// A browser's pool: a dedicated worker made by the one tab of this browser
// profile that holds the pool's Web Lock (pool-host.ts). It has a Repo of its
// own on the tasks database, a Pool (../pool.ts), and run workers it makes
// itself, nested inside it (executor.ts).
//
// It lives in a worker, not the page, because a hidden page's own timers
// slow to one a minute after five minutes, and the pool's beat is what tells
// everyone its runs are going on. A dedicated worker's timers keep time.
//
// The page tells it once how to start, and from then on which queues to
// serve; it answers with its status when asked, and stops when told.
//
// The local link (link.ts). The page hands it, in 'start', its end of a port
// to the site's Repo, which its Repo adds as a network adapter, and the peer
// id the page chose for it, which its Repo is made with. For each run worker
// it starts, it makes another MessageChannel and sends the page one end
// ('link'); the page answers with the peer id it chose for that link
// ('link'), and only then is the run worker handed the other end with that
// id, in its settings. It says when that run worker has ended ('unlink').
// Before a linked run is reported, it asks the page to save the documents the
// run wrote ('keep', answered 'kept'; executor.ts). A pool given no port
// links none of its run workers.
//
// The pool's registry (../registry-snapshot.ts). The page sends its
// registry's snapshot ('plugins') as the pool starts and whenever it changes;
// this worker hands the latest to every run worker (executor.ts) and
// discovers nothing itself.
//
// Its Pool starts only once this worker holds WORKER_LOCK, which it keeps
// for as long as it lives. The page lets go of the pool's lock as soon as it
// has called `terminate()` on this worker, but a worker busy in synchronous
// code goes on for up to 2 s after that; a worker's own locks pass only once
// it has really ended. Without this, the next tab's pool, which has the same
// id, could run beside this one for that moment, and each would record the
// other's live runs as its own lost ones.

import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import type { Acceptance } from '../acceptance';
import { Pool, type Docs } from '../pool';
import type { RepoConfig } from '../repo-config';
import type { Snapshot } from '../registry-snapshot';
import { getRepo, setUpImportMap } from '../webworker-lib';
import { BrowserExecutor, type RunWorkerLink } from './executor';

export type ServedQueues = Record<AutomergeUrl, Acceptance>;

/** Held by the pool's worker for its whole life, so that one pool's worker has ended before the next one's Pool starts. */
export const WORKER_LOCK = 'patchwork-tasks-pool-worker';

/** What the page says to its pool's worker. */
export type ToPoolWorker =
  | {
      type: 'start';
      repoConfig: RepoConfig;
      /** The pool's id: the same for every pool this browser profile runs, so each owns what the last one started. */
      id: string;
      name: string;
      slots: number;
      queues: ServedQueues;
      /** The page's import map and base URI, which the Repo's modules and a task's bare imports resolve by. */
      importMap: unknown;
      baseURI: string;
      /** Its end of the link to the site's Repo, when the page has one (link.ts). */
      link?: MessagePort;
      /** With `link`: the peer id its Repo must have, which the page chose and its end of the link admits alone. */
      peer?: string;
    }
  /** The peer id the page chose for the run worker of link `id`; null where the page took no link (the run worker then has none). */
  | { type: 'link'; id: number; peer: string | null }
  /** The page has saved what the run of link `id` wrote (`keep` number `ask`), or `problem` says why not. */
  | { type: 'kept'; ask: number; problem?: string }
  /** The queues to serve from now on, with whose code to run from each. */
  | { type: 'serve'; queues: ServedQueues }
  /** The page's registry, as it is now. */
  | { type: 'plugins'; snapshot: Snapshot }
  | { type: 'status' }
  /**
   * Stop. With `drain`, take nothing new, let the runs going on end by
   * themselves, then stop; without, stop now, which records each run lost.
   */
  | { type: 'stop'; drain: boolean };

/** What the pool's worker says to the page. */
export type FromPoolWorker =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'status'; busy: number }
  | { type: 'stopped' }
  /** The page's end of a new run worker's link to the site's Repo, `id` naming it among this pool's links. */
  | { type: 'link'; id: number; port: MessagePort }
  /** The run worker of link `id` has ended. */
  | { type: 'unlink'; id: number }
  /** Save, in the site's Repo, these documents, which the run of link `id` wrote; answered by `kept` with the same `ask`. */
  | { type: 'keep'; id: number; ask: number; documents: string[] };

const scope = self as unknown as {
  postMessage(message: FromPoolWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToPoolWorker>) => void) | null;
};
const say = (message: FromPoolWorker) => scope.postMessage(message);

let links = 0;
/** Run worker links waiting for the page to name their peer, by id. */
const naming = new Map<number, (peer: string | null) => void>();
let asks = 0;
/** `keep`s waiting for the page's `kept`, by ask. */
const keeping = new Map<number, (problem: string | null) => void>();

/** A run worker's link: the page's end goes to the page now; the run worker's end, once the page has named its peer. */
function linkRunWorker(): RunWorkerLink {
  const id = ++links;
  const { port1, port2 } = new MessageChannel();
  const peer = new Promise<string | null>((resolve) => naming.set(id, resolve));
  scope.postMessage({ type: 'link', id, port: port1 }, [port1]);
  return {
    port: port2,
    peer,
    keep: (documents) =>
      new Promise<string | null>((resolve) => {
        const ask = ++asks;
        keeping.set(ask, resolve);
        say({ type: 'keep', id, ask, documents });
      }),
    end: () => {
      naming.get(id)?.(null);
      naming.delete(id);
      say({ type: 'unlink', id });
    },
  };
}

let pool: Promise<Pool | null> | null = null;
let executor: BrowserExecutor | null = null;
let plugins: Snapshot = [];
let queues: ServedQueues = {};
let stopping = false;

scope.onmessage = ({ data }) => {
  switch (data?.type) {
    case 'start':
      if (!pool) {
        queues = data.queues;
        pool = start(data).then(
          (started) => {
            say({ type: 'ready' });
            return started;
          },
          (error) => {
            console.error('tasks: the pool could not start', error);
            say({ type: 'failed', message: (error as Error)?.message ?? String(error) });
            return null;
          },
        );
      }
      break;
    case 'serve':
      // A pool that is draining serves nothing, whatever the account says.
      if (!stopping) {
        queues = data.queues;
        void pool?.then((it) => it?.serve(queues));
      }
      break;
    case 'plugins':
      plugins = data.snapshot;
      executor?.plugins({ snapshot: plugins });
      break;
    case 'link':
      naming.get(data.id)?.(typeof data.peer === 'string' ? data.peer : null);
      naming.delete(data.id);
      break;
    case 'kept':
      keeping.get(data.ask)?.(data.problem ?? null);
      keeping.delete(data.ask);
      break;
    case 'status':
      void (pool ?? Promise.resolve(null)).then((it) => say({ type: 'status', busy: it?.busy ?? 0 }));
      break;
    case 'stop':
      stopping = true;
      void stop(data.drain);
      break;
  }
};

async function start(settings: Extract<ToPoolWorker, { type: 'start' }>): Promise<Pool> {
  await holdForLife(WORKER_LOCK);
  await setUpImportMap(settings.importMap ?? {}, settings.baseURI);
  // Linked, its Repo has the peer id the page chose, which is all the page's end admits.
  const peer = settings.link && settings.peer ? settings.peer : `task-pool-${crypto.randomUUID()}`;
  const repo = await getRepo(settings.repoConfig, peer, {}, settings.link);
  executor = new BrowserExecutor({
    settings: {
      repoConfig: settings.repoConfig,
      importMap: settings.importMap,
      baseURI: settings.baseURI,
    },
    taskBytes: (taskUrl) => repo.export(taskUrl),
    link: settings.link ? linkRunWorker : undefined,
  });
  executor.plugins({ snapshot: plugins });
  return new Pool({
    repo: repo as unknown as Docs,
    id: settings.id,
    name: settings.name,
    slots: settings.slots,
    // what any browser has; work that needs more is left for a machine that has it
    has: ['browser'],
    executor,
    // the latest the page has said, which may have come while this was starting
    queues: stopping ? {} : queues,
  });
}

/**
 * Resolves once this worker holds the lock `name`, which it then keeps until
 * it ends. A worker with no Web Locks cannot start a pool: two could then run
 * with one id.
 */
function holdForLife(name: string): Promise<void> {
  const locks = (self as unknown as { navigator?: Navigator }).navigator?.locks;
  if (!locks) {
    return Promise.reject(new Error('its worker has no Web Locks'));
  }
  return new Promise<void>((granted, failed) => {
    locks
      .request(name, { mode: 'exclusive' }, () => {
        granted();
        return new Promise<never>(() => {});
      })
      .catch(failed);
  });
}

async function stop(drain: boolean) {
  const it = await (pool ?? Promise.resolve(null));
  if (it) {
    if (drain) {
      it.serve({});
      // Looked at on this worker's own clock, which keeps time in a hidden tab.
      await new Promise<void>((resolve) => {
        const check = () => (it.busy === 0 ? resolve() : setTimeout(check, 100));
        check();
      });
    }
    await it.stop();
  }
  say({ type: 'stopped' });
}
