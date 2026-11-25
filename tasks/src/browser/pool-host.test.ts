// The page's pool host, with its parts stood in for: the Web Locks, the
// pool's worker, the build channel and the site's Repo. A host asks for the
// lock and starts a worker only while something holds it and the storage
// document lists a served queue; each case below is one way the list and the
// pool can meet.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolHostStatus } from './pool-host';

const ACCOUNT = 'automerge:tuasnaJMthhBUKLv9unCJSvTFrC';
const STORAGE = 'automerge:3WewSgnLmFK4FjUXUCzPa939hyNe';
const QUEUE = 'automerge:2XzPUSj52GAd1wnWv1vR5JXH94VZ';

/** The site's Repo: documents by url, each changed by `change`, which its handle's listeners hear. */
function standInRepo(docs: Record<string, unknown>) {
  const listeners = new Map<string, Set<() => void>>();
  const repo = {
    find: async (url: string) => {
      if (!(url in docs)) {
        throw new Error(`no ${url}`);
      }
      return {
        doc: () => docs[url],
        on: (_event: string, listener: () => void) => {
          if (!listeners.has(url)) listeners.set(url, new Set());
          listeners.get(url)!.add(listener);
        },
        off: (_event: string, listener: () => void) => listeners.get(url)?.delete(listener),
      };
    },
  };
  const change = (url: string, doc: unknown) => {
    docs[url] = doc;
    for (const listener of listeners.get(url) ?? []) listener();
  };
  return { repo: repo as any, change };
}

/** Web Locks, for one lock at a time, in the order asked; an asking aborted before it is given is dropped. */
function standInLocks() {
  type Asked = { grant: () => void; signal?: AbortSignal };
  const line: Asked[] = [];
  let holder: Asked | null = null;
  const locks = {
    asked: 0,
    held: () => holder !== null,
    waiting: () => line.length,
    request(_name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>) {
      locks.asked += 1;
      return new Promise<void>((resolve, reject) => {
        const asked: Asked = {
          signal: options.signal,
          grant: () => {
            holder = asked;
            Promise.resolve(callback()).then(
              () => {
                holder = null;
                resolve();
                next();
              },
              (error) => {
                holder = null;
                reject(error);
                next();
              },
            );
          },
        };
        options.signal?.addEventListener('abort', () => {
          const at = line.indexOf(asked);
          if (at >= 0) {
            line.splice(at, 1);
            reject(new DOMException('aborted', 'AbortError'));
          }
        });
        line.push(asked);
        next();
      });
    },
  };
  const next = () => {
    if (!holder && line.length) {
      line.shift()!.grant();
    }
  };
  return locks;
}

/** The pool's worker: what it was told, whether it was ended, and `say` for what it tells the page. */
class StandInWorker {
  static made: StandInWorker[] = [];
  told: any[] = [];
  ended = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor() {
    StandInWorker.made.push(this);
  }
  postMessage(message: any) {
    this.told.push(message);
  }
  terminate() {
    this.ended = true;
  }
  say(data: unknown) {
    this.onmessage?.({ data });
  }
  /** What it was told, status requests left out. */
  orders() {
    return this.told.filter((message) => message.type !== 'status').map((message) => (message.type === 'start' ? { type: 'start', queues: message.queues } : message));
  }
}

class SilentChannel {
  onmessage: unknown = null;
  postMessage() {}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let locks: ReturnType<typeof standInLocks>;

beforeEach(() => {
  StandInWorker.made = [];
  locks = standInLocks();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  vi.stubGlobal('Worker', StandInWorker);
  vi.stubGlobal('BroadcastChannel', SilentChannel);
  (globalThis as any).accountDocHandle = { url: ACCOUNT };
});

afterEach(() => {
  delete (navigator as any).locks;
  vi.unstubAllGlobals();
  delete (globalThis as any).accountDocHandle;
  delete (window as any).patchworkTasks;
  vi.resetModules();
});

/** A page with the given storage list (null: the account names no storage), its host started and watched. */
async function page(served: Record<string, unknown> | null) {
  const { startPoolHost, watchPoolHost } = await import('./pool-host');
  const docs: Record<string, unknown> = {
    [ACCOUNT]: served ? { toolStorage: { 'tasks-next': STORAGE } } : {},
    ...(served ? { [STORAGE]: served } : {}),
  };
  const { repo, change } = standInRepo(docs);
  const seen: PoolHostStatus[] = [];
  const unwatch = watchPoolHost((status) => seen.push(status));
  const release = startPoolHost(repo);
  await settle();
  const states = () => seen.map((status) => status.state).filter((state, i, all) => state !== all[i - 1]);
  const serve = async (list: Record<string, unknown>) => {
    change(STORAGE, list);
    await settle();
  };
  return { seen, states, last: () => seen.at(-1)!, release, unwatch, serve, change };
}

describe("a page's pool host, by what the storage lists", () => {
  it('serving nothing at start: asks for no lock and starts no worker, and says it serves nothing', async () => {
    const p = await page({});
    expect(p.states()).toEqual(['not started', 'reading', 'serves nothing']);
    expect(locks.asked).toBe(0);
    expect(StandInWorker.made).toHaveLength(0);
    p.release();
    expect(p.last().state).toBe('not started');
    expect(locks.asked).toBe(0);
    p.unwatch();
  });

  it('with an account that names no storage: the same', async () => {
    const p = await page(null);
    expect(p.states()).toEqual(['not started', 'reading', 'serves nothing']);
    expect(locks.asked).toBe(0);
    expect(StandInWorker.made).toHaveLength(0);
    p.release();
    p.unwatch();
  });

  it('a queue joined later: asks for the lock and starts the pool for that queue', async () => {
    const p = await page({});
    await p.serve({ [QUEUE]: true });
    expect(locks.asked).toBe(1);
    expect(StandInWorker.made).toHaveLength(1);
    const worker = StandInWorker.made[0];
    expect(worker.orders()).toEqual([{ type: 'start', queues: { [QUEUE]: 'any' } }]);
    expect(p.last().state).toBe('starting');
    worker.say({ type: 'ready' });
    expect(p.last().state).toBe('running');
    expect(p.states()).toEqual(['not started', 'reading', 'serves nothing', 'starting', 'running']);
    p.release();
    p.unwatch();
  });

  it('the last queue left while a run is going: the pool drains, then is ended and lets the lock go', async () => {
    const p = await page({ [QUEUE]: true });
    const worker = StandInWorker.made[0];
    worker.say({ type: 'ready' });
    worker.say({ type: 'status', busy: 1 });
    expect(p.last()).toMatchObject({ state: 'running', busy: 1 });

    await p.serve({});
    expect(worker.orders()).toEqual([
      { type: 'start', queues: { [QUEUE]: 'any' } },
      { type: 'serve', queues: {} },
      { type: 'stop', drain: true },
    ]);
    expect(p.last()).toMatchObject({ state: 'winding down', busy: 1 });
    expect(worker.ended).toBe(false);
    expect(locks.held()).toBe(true);

    worker.say({ type: 'status', busy: 0 });
    worker.say({ type: 'stopped' });
    await settle();
    expect(worker.ended).toBe(true);
    expect(locks.held()).toBe(false);
    expect(p.last()).toMatchObject({ state: 'serves nothing', busy: 0 });
    expect(locks.asked).toBe(1);
    expect(StandInWorker.made).toHaveLength(1);
    p.release();
    p.unwatch();
  });

  it('joined again during the drain: no second pool meanwhile, and the lock is asked for anew once the drain is done', async () => {
    const p = await page({ [QUEUE]: true });
    const first = StandInWorker.made[0];
    first.say({ type: 'ready' });
    first.say({ type: 'status', busy: 1 });
    await p.serve({});
    await p.serve({ [QUEUE]: { packages: ['automerge:pkg'] } });
    // Told the list, which a draining pool's worker does not act on, and told to stop only once.
    expect(first.orders().filter((order) => order.type === 'stop')).toHaveLength(1);
    expect(p.last().state).toBe('winding down');
    expect(StandInWorker.made).toHaveLength(1);
    expect(locks.asked).toBe(1);

    first.say({ type: 'stopped' });
    await settle();
    expect(first.ended).toBe(true);
    expect(locks.asked).toBe(2);
    expect(StandInWorker.made).toHaveLength(2);
    const second = StandInWorker.made[1];
    expect(second.orders()).toEqual([{ type: 'start', queues: { [QUEUE]: ['automerge:pkg'] } }]);
    second.say({ type: 'ready' });
    // Between the drain's end and the lock given again, a moment of asking for it, as any tab might.
    expect(p.states().slice(-5)).toEqual(['running', 'winding down', 'waiting', 'starting', 'running']);
    p.release();
    p.unwatch();
  });

  it('let go while winding down: says it let go, the latest reason, until the drain ends', async () => {
    const p = await page({ [QUEUE]: true });
    const worker = StandInWorker.made[0];
    worker.say({ type: 'ready' });
    await p.serve({});
    expect(p.last().state).toBe('winding down');
    p.release();
    expect(p.last().state).toBe('letting go');
    expect(worker.orders().filter((order) => order.type === 'stop')).toHaveLength(1);
    worker.say({ type: 'stopped' });
    await settle();
    expect(p.last().state).toBe('not started');
    expect(locks.held()).toBe(false);
    p.unwatch();
  });

  it('waiting for the lock another tab holds, the last queue left: stops asking; joined again: asks again', async () => {
    let otherTabLetsGo = () => {};
    void locks.request('patchwork-tasks-pool', {}, () => new Promise<void>((resolve) => (otherTabLetsGo = resolve)));
    const p = await page({ [QUEUE]: true });
    expect(p.last().state).toBe('waiting');
    expect(locks.waiting()).toBe(1);

    await p.serve({});
    expect(locks.waiting()).toBe(0);
    expect(p.last().state).toBe('serves nothing');

    await p.serve({ [QUEUE]: true });
    expect(locks.waiting()).toBe(1);
    expect(p.last().state).toBe('waiting');
    otherTabLetsGo();
    await settle();
    expect(StandInWorker.made).toHaveLength(1);
    expect(p.last().state).toBe('starting');
    p.release();
    p.unwatch();
  });

  it('a pool that could not start, then nothing served: the retry is dropped; served again, it is tried at once', async () => {
    const p = await page({ [QUEUE]: true });
    StandInWorker.made[0].say({ type: 'failed', message: 'no room' });
    expect(p.last()).toMatchObject({ state: 'unavailable', problem: 'no room' });
    expect(p.last().retryAt).toBeGreaterThan(Date.now());

    await p.serve({});
    expect(p.last()).toEqual(expect.objectContaining({ state: 'serves nothing' }));
    expect(p.last().problem).toBeUndefined();
    expect(p.last().retryAt).toBeUndefined();

    await p.serve({ [QUEUE]: true });
    expect(StandInWorker.made).toHaveLength(2);
    expect(p.last().state).toBe('starting');
    p.release();
    p.unwatch();
  });

  it('before the list is read, and with no Repo to read it from: asks for nothing, and says it has not read it', async () => {
    const { startPoolHost, watchPoolHost } = await import('./pool-host');
    const seen: string[] = [];
    const unwatch = watchPoolHost((status) => seen.push(status.state));
    const release = startPoolHost(undefined);
    await settle();
    expect(seen.filter((state, i) => state !== seen[i - 1])).toEqual(['not started', 'reading']);
    expect(locks.asked).toBe(0);
    expect(StandInWorker.made).toHaveLength(0);
    release();
    expect(seen.at(-1)).toBe('not started');
    unwatch();
  });

  it('with no Web Locks and a queue served: unavailable, and never tried again', async () => {
    delete (navigator as any).locks;
    const p = await page({ [QUEUE]: true });
    expect(p.last()).toMatchObject({ state: 'unavailable', problem: expect.stringMatching(/Web Locks/) });
    expect(p.last().retryAt).toBeUndefined();
    expect(StandInWorker.made).toHaveLength(0);
    await p.serve({});
    expect(p.last().state).toBe('serves nothing');
    p.release();
    p.unwatch();
  });
});

describe('where a view can see the pool from', () => {
  /** A window whose parent is `parent`, or the top when there is none. */
  const frame = (parent?: any): any => {
    const view: any = { document: {} };
    view.parent = parent ?? view;
    return view;
  };
  /** A window of another origin: its document cannot be read. */
  const foreign = (parent?: any): any => {
    const view: any = {};
    Object.defineProperty(view, 'document', {
      get() {
        throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError');
      },
    });
    view.parent = parent ?? view;
    return view;
  };

  it('a top-level page, and a frame of the same origin all the way up, can see; a frame in a page it cannot read cannot', async () => {
    const { poolOutOfSight } = await import('./pool-host');
    const top = frame();
    expect(poolOutOfSight(top)).toBe(false);
    expect(poolOutOfSight(frame(frame(top)))).toBe(false);
    // a sandboxed (opaque origin) or cross-origin frame in its page
    expect(poolOutOfSight(frame(foreign()))).toBe(true);
    // a frame of the same origin as the sandboxed frame it is in, which is itself in the page
    expect(poolOutOfSight(frame(frame(foreign())))).toBe(true);
    // a frame of the same origin as the top, inside a frame of another origin
    expect(poolOutOfSight(frame(foreign(frame())))).toBe(true);
  });

  it('a view in a frame out of sight of its page says so while nothing here has started a pool host, and follows one started here', async () => {
    const { startPoolHost, watchPoolHost } = await import('./pool-host');
    const realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { value: foreign(), configurable: true });
    try {
      const seen: string[] = [];
      const unwatch = watchPoolHost((status) => seen.push(status.state));
      expect(seen).toEqual(['out of sight']);
      const release = startPoolHost(undefined);
      expect(seen.at(-1)).toBe('reading');
      release();
      unwatch();
    } finally {
      if (realParent) {
        Object.defineProperty(window, 'parent', realParent);
      } else {
        delete (window as any).parent;
      }
    }
  });
});
