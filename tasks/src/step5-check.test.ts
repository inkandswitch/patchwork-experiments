// @vitest-environment node
//
// An independent checker's cases of step 5 (doWork always asks the person's
// own queue and never runs a task's code in the page), on real automerge-repo
// documents and, where a pool is needed, real Pools with an executor that
// says what a run worker would. Time is vitest's fake clock unless a case
// says it measures wall time. Every url here is made up.

import * as A from '@automerge/automerge';
import { initSubduction, NetworkAdapter, parseAutomergeUrl, Repo, stringifyAutomergeUrl, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OWN_QUEUE_TITLE,
  POOL_ID_KEY,
  QUEUE_DATATYPE_ID,
  TASKS_STORAGE_ID,
  doWork,
  markOf,
  ownQueueOf,
  send,
  sparesOf,
  storageUrlOf,
  type TaskView,
} from './task-client.js';
import { Pool, type Docs, type Ears, type Executor, type Job, type RunWorker, type WorkerEvents } from './pool';
import { LAPSE_MS, LISTEN_MS, entryAt, isWanted, recordsOf, type Queue, type Task } from './task-rules.js';

await initSubduction();
await initSiteSubduction();

const g = globalThis as any;
const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
afterEach(() => {
  vi.useRealTimers();
  delete g.accountDocHandle;
  delete g.document;
  delete g.localStorage;
  delete g.__imported;
});

const REPOS = {
  "the task system's Repo": () => new Repo({ network: [] } as any),
  "the site's Repo": () => new SiteRepo({ network: [] } as any) as unknown as Repo,
} as const;
const newRepo = REPOS["the task system's Repo"];

/** A made-up document url, from fixed bytes. */
const madeUp = (byte: number) => stringifyAutomergeUrl({ documentId: new Uint8Array(16).fill(byte) } as any) as AutomergeUrl;
const PKG = madeUp(7);
const handleOf = <T,>(repo: Repo, url: string) => repo.handles[parseAutomergeUrl(url as AutomergeUrl).documentId] as DocHandle<T> | undefined;

// Code whose import in this process is counted: a data: url and a file: url
// that each add one to globalThis.__imported when imported.
const COUNTED_DATA = 'data:text/javascript,globalThis.__imported=(globalThis.__imported??0)+1;export default()=>1';
const dir = mkdtempSync(join(tmpdir(), 'step5-check-'));
writeFileSync(join(dir, 'task.mjs'), 'globalThis.__imported=(globalThis.__imported??0)+1;export default()=>1;\n');
const COUNTED_FILE = pathToFileURL(join(dir, 'task.mjs')).href;
const IN_PACKAGE = `https://site.example/${encodeURIComponent(PKG)}/dist/task.js`;
const LOCALHOST = 'http://localhost:5173/src/task.js';

const PAGE_ONLY = 'Task queues can only be kept from a Patchwork page with your account open.';
const NOT_FOUND = 'The list of your task queues could not be found, so nothing was changed.';
const NO_POOL_ID = "This work's code is only on this machine (%s url), and this browser keeps no id for its pool, so no pool can be asked to run it.";

const localStorageOf = (items: Record<string, string>) => ({
  items,
  writes: 0,
  getItem(key: string) {
    return items[key] ?? null;
  },
  setItem(key: string, value: string) {
    this.writes++;
    items[key] = String(value);
  },
});

async function turns(n = 5) {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
  }
}
/** Fake time in steps until `done` or `limit` ms have passed. */
async function until(done: () => boolean, limit: number, step = 100) {
  const started = Date.now();
  await turns();
  while (!done() && Date.now() - started < limit) {
    await vi.advanceTimersByTimeAsync(step);
    await turns(3);
  }
  return done();
}

type Account = 'none' | 'own here' | 'no own yet' | 'own elsewhere' | 'storage not here';
type PoolId = 'kept' | 'none yet' | 'no localStorage';

/** A page whose person has `account`, in `repo`. */
function pageOf(repo: Repo, account: Account) {
  let own: DocHandle<Queue> | undefined;
  let storage: DocHandle<any> | undefined;
  if (account === 'none') {
    return { own, storage };
  }
  if (account === 'storage not here') {
    g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: madeUp(99) } });
    return { own, storage };
  }
  storage = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
  g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: storage.url } });
  if (account === 'own here') {
    own = repo.create<Queue>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} } as any);
    const url = own.url;
    storage.change((doc) => {
      doc.own = url;
      doc[markOf(url)] = true;
      doc[url] = true;
    });
  } else if (account === 'own elsewhere') {
    const away = madeUp(42);
    storage.change((doc) => {
      doc.own = away;
      doc[markOf(away)] = true;
      doc[away] = true;
    });
  }
  return { own, storage };
}

/** Every document this Repo has with anything in it, and its heads (a handle a find made for a document not here has none). */
const written = (repo: Repo) =>
  JSON.stringify(
    Object.values(repo.handles)
      .map((h: any) => [h.url, h.doc() ? A.getHeads(h.doc()) : []])
      .filter(([, heads]) => heads.length > 0),
  );

/** Every queue the storage marks or names, as this Repo has it, with what it lists. */
function queuesListed(repo: Repo, storage: DocHandle<any> | undefined) {
  if (!storage?.doc()) return [];
  const doc = storage.doc();
  const urls = [...new Set([ownQueueOf(doc), ...sparesOf(doc)].filter(Boolean) as string[])];
  return urls.flatMap((url) => {
    const handle = handleOf<Queue>(repo, url);
    const jobs = handle?.doc()?.jobs ?? {};
    return Object.entries(jobs).map(([key, entry]) => ({ queue: url, key, entry: entry as any }));
  });
}

describe('(a) no combination has doWork import the code in the page', () => {
  it('task-client.js has no dynamic import at all', () => {
    const source = readFileSync(new URL('./task-client.js', import.meta.url), 'utf8');
    // comments out (JSDoc's import('./task-rules.js') types are not imports)
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/\bimport\s*\(/g) ?? []).toEqual([]);
  });

  beforeEach(fake);
  const CODES = { 'data: (travels)': COUNTED_DATA, 'a package file (travels)': IN_PACKAGE, 'file: (cannot travel)': COUNTED_FILE, 'http://localhost (cannot travel)': LOCALHOST } as const;
  const ACCOUNTS: Account[] = ['none', 'own here', 'no own yet', 'own elsewhere', 'storage not here'];
  const POOL_IDS: PoolId[] = ['kept', 'none yet', 'no localStorage'];
  const NEEDS = [[], ['node'], ['pool:somebody-else']];
  const HEARD = [false, true];
  let cases = 0;
  const outcomes: Record<string, number> = {};
  for (const [repoName, makeRepo] of Object.entries(REPOS))
    for (const [codeName, importUrl] of Object.entries(CODES))
      for (const account of ACCOUNTS)
        for (const poolId of POOL_IDS)
          for (const needs of NEEDS)
            for (const heard of HEARD) {
              cases++;
              const name = `${repoName}, ${codeName}, account ${account}, pool id ${poolId}, needs ${JSON.stringify(needs)}, a pool ${heard ? '' : 'not '}heard`;
              it(name, async () => {
                const repo = makeRepo();
                const local = poolId === 'no localStorage' ? undefined : localStorageOf(poolId === 'kept' ? { [POOL_ID_KEY]: 'this-browser' } : {});
                g.localStorage = local;
                const { own, storage } = pageOf(repo, account);
                if (heard && own) {
                  // a pool says it serves own and has everything: before the change, this chose between queue and page
                  for (let i = 0; i < 3; i++) send(own, { type: 'serving', pool: 'p', name: 'p', slots: 4, busy: 0, has: ['browser', 'node', 'unix', 'pool:somebody-else'] } as any);
                }
                const before = written(repo);
                const views: TaskView[] = [];
                let result: { value?: unknown; error?: Error } | undefined;
                doWork(repo, { importUrl, input: 1, key: 'k', needs }, { onProgress: (view) => views.push(view) }).then(
                  (value) => (result = { value }),
                  (error) => (result = { error }),
                );
                const travels = !codeName.includes('cannot');
                const refusedForId = !travels && poolId === 'no localStorage';
                const refused = refusedForId || account === 'none' || account === 'storage not here';
                await until(() => !!result || (!refused && queuesListed(repo, storage).length > 0), refused ? 40_000 : 3_000, refused ? 1_000 : 100);
                await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
                await turns();
                expect(g.__imported ?? 0, 'imported in the page').toBe(0);
                if (refused) {
                  const sentence = refusedForId ? NO_POOL_ID.replace('%s', importUrl.split(':')[0]) : account === 'none' ? PAGE_ONLY : NOT_FOUND;
                  expect(result?.error?.message).toBe(sentence);
                  expect(views).toEqual([]);
                  const after = written(repo);
                  expect(after, 'no document changed').toBe(before);
                  outcomes[`refused: ${sentence.slice(0, 40)}`] = (outcomes[`refused: ${sentence.slice(0, 40)}`] ?? 0) + 1;
                  return;
                }
                expect(result, 'still waiting for a pool').toBeUndefined();
                const listed = queuesListed(repo, storage);
                expect(listed).toHaveLength(1);
                const { entry, queue } = listed[0];
                // asked of own when own is here; of a spare made here when own's document is not
                if (account === 'own here') expect(queue).toBe(own!.url);
                else if (account === 'own elsewhere') expect(sparesOf(storage!.doc())).toContain(queue);
                else expect(queue).toBe(ownQueueOf(storage!.doc()));
                const id = local?.items[POOL_ID_KEY] ?? null;
                if (travels) {
                  expect(entry.needs).toEqual(needs);
                  expect(entry.near ?? null).toBe(poolId === 'kept' ? 'this-browser' : null);
                  expect(local?.writes ?? 0, 'no pool id made for code that travels').toBe(0);
                } else {
                  expect(id).toBeTruthy();
                  expect(entry.needs).toEqual([...needs, `pool:${id}`]);
                  expect(entry.near).toBe(id);
                }
                const task = handleOf<Task>(repo, entry.taskUrl)!;
                expect(task.doc()!.importUrl).toBe(importUrl);
                expect(views.at(-1)?.state).toBe('waiting');
                outcomes.asked = (outcomes.asked ?? 0) + 1;
              });
            }
  it(`counts: ${cases} cases`, () => {
    expect(cases).toBe(2 * 4 * 5 * 3 * 3 * 2);
  });
});

describe('(d) a rejection writes nothing but what its sentence says', () => {
  beforeEach(fake);
  it('code that cannot travel, no account open: rejects with the account sentence, and no pool id has been written to localStorage', async () => {
    // doWork makes this browser's pool id only once ownQueue has given the
    // queue, so a refused asking leaves nothing in localStorage either.
    const repo = newRepo();
    const local = localStorageOf({});
    g.localStorage = local;
    const outcome = await doWork(repo, { importUrl: LOCALHOST, key: 'k' }).then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    expect(outcome).toBe(PAGE_ONLY);
    expect(local.writes).toBe(0);
  });
});

/** A network adapter with one peer that never answers anything. */
class Silent extends NetworkAdapter {
  ready = true;
  isReady() {
    return true;
  }
  whenReady() {
    return Promise.resolve();
  }
  connect(peerId: any) {
    this.peerId = peerId;
    setTimeout(() => this.emit('peer-candidate', { peerId: 'silent-peer' as any, peerMetadata: {} }), 0);
  }
  send() {}
  disconnect() {}
}

describe('(b) doWork waits on no pool and no network: wall time until the task is listed', () => {
  const CASES: [string, () => Repo][] = [
    ['a Repo with no network adapter', () => new Repo({ network: [] } as any)],
    ['a Repo whose only peer never answers', () => new Repo({ network: [new Silent()] } as any)],
    ["the site's Repo with no network adapter", () => new SiteRepo({ network: [] } as any) as unknown as Repo],
  ];
  for (const [name, makeRepo] of CASES) {
    for (const account of ['own here', 'no own yet', 'own elsewhere'] as Account[]) {
      it(`${name}, account ${account}`, async () => {
        const repo = makeRepo();
        g.localStorage = localStorageOf({ [POOL_ID_KEY]: 'this-browser' });
        const { storage } = pageOf(repo, account);
        const started = performance.now();
        const controller = new AbortController();
        const done = doWork(repo, { importUrl: COUNTED_DATA, key: 'k' }, { signal: controller.signal }).catch(() => {});
        while (queuesListed(repo, storage).length === 0 && performance.now() - started < 10_000) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const took = performance.now() - started;
        controller.abort();
        await done;
        console.log(`(b) ${name}, ${account}: listed after ${took.toFixed(0)} ms`);
        expect(queuesListed(repo, storage).length).toBe(0); // the abort took it off again
        // own here or made here: nothing to wait for. Own elsewhere: findKept gives own's document HERE_MS (1 s) to come from this Repo's storage.
        expect(took).toBeLessThan(account === 'own elsewhere' ? 1_500 : 300);
      });
    }
  }
});

// Pools: real Pools on the page's Repo, with ears that carry messages between them in this process and an executor that records what it is handed.

class Recording implements Executor {
  jobs: Job[] = [];
  workers: { events: WorkerEvents; job?: Job; aborted?: string }[] = [];
  constructor(readonly finish = true) {}
  start(events: WorkerEvents): RunWorker {
    const worker: { events: WorkerEvents; job?: Job; aborted?: string } = { events };
    this.workers.push(worker);
    return {
      run: (job) => {
        this.jobs.push(job);
        worker.job = job;
        if (this.finish) setTimeout(() => events.done({ ran: job.input }), 10);
      },
      abort: (reason) => {
        // as a task's code does when its signal aborts
        worker.aborted = reason;
        setTimeout(() => events.threw(`AbortError: ${reason}`), 10);
      },
      settle: () => {},
      terminate: () => events.exit(),
    };
  }
}

function loopback() {
  const listeners = new Map<string, Set<(m: any) => void>>();
  return (): Ears => {
    const mine = new Set<(m: any) => void>();
    return {
      send: (handle, message) => {
        for (const listener of listeners.get(handle.url) ?? []) if (!mine.has(listener)) listener(structuredClone(message));
      },
      listen: (handle, onMessage) => {
        mine.add(onMessage);
        if (!listeners.has(handle.url)) listeners.set(handle.url, new Set());
        listeners.get(handle.url)!.add(onMessage);
        return () => listeners.get(handle.url)!.delete(onMessage);
      },
    };
  };
}

const pool = (repo: Repo, id: string, queue: string, ears: Ears, executor = new Recording()) => ({
  executor,
  pool: new Pool({ repo: repo as unknown as Docs, id, name: id, slots: 1, has: ['browser'], executor, queues: { [queue as AutomergeUrl]: 'any' }, ears }),
});

describe('(c) code that cannot travel is run only by this browser\'s pool', () => {
  beforeEach(fake);
  for (const importUrl of [LOCALHOST, COUNTED_FILE]) {
    it(`${importUrl.split(':')[0]}: another machine's pool on the same queue never takes it, alone or beside this browser's`, async () => {
      const repo = newRepo();
      g.localStorage = localStorageOf({});
      const { own } = pageOf(repo, 'own here');
      const ears = loopback();
      const other = pool(repo, 'another-machine', own!.url, ears());
      await vi.advanceTimersByTimeAsync(LISTEN_MS);
      let result: { value?: unknown; error?: Error } | undefined;
      doWork(repo, { importUrl, input: 'dev', key: 'dev' }).then(
        (value) => (result = { value }),
        (error) => (result = { error }),
      );
      await until(() => !!entryAt(own!.doc(), 'dev'), 2_000);
      const id = g.localStorage.items[POOL_ID_KEY];
      expect(id).toBeTruthy();
      // alone for three lapses: never taken
      await vi.advanceTimersByTimeAsync(3 * LAPSE_MS);
      await turns();
      expect(other.executor.jobs).toEqual([]);
      expect(result).toBeUndefined();
      // this browser's pool starts, with the id the page made (pool-id.ts keeps an existing one)
      const { browserPoolId } = await import('./browser/pool-id');
      expect(browserPoolId()).toBe(id);
      const mine = pool(repo, browserPoolId(), own!.url, ears());
      expect(await until(() => !!result, 20_000)).toBe(true);
      expect(result).toEqual({ value: { ran: 'dev' } });
      expect(mine.executor.jobs.map((job) => job.importUrl)).toEqual([importUrl]);
      expect(other.executor.jobs).toEqual([]);
      expect(g.__imported ?? 0).toBe(0);
      await other.pool.stop();
      await mine.pool.stop();
    });
  }

  it('code that travels, near this browser: this browser\'s pool takes it, though another heard first', async () => {
    const repo = newRepo();
    g.localStorage = localStorageOf({ [POOL_ID_KEY]: 'this-browser' });
    const { own } = pageOf(repo, 'own here');
    const ears = loopback();
    const other = pool(repo, 'another-machine', own!.url, ears());
    const mine = pool(repo, 'this-browser', own!.url, ears());
    await vi.advanceTimersByTimeAsync(LISTEN_MS);
    let result: unknown;
    doWork(repo, { importUrl: COUNTED_DATA, input: 'x', key: 'x' }).then((value) => (result = value));
    expect(await until(() => result !== undefined, 20_000)).toBe(true);
    expect(mine.executor.jobs).toHaveLength(1);
    expect(other.executor.jobs).toHaveLength(0);
    await other.pool.stop();
    await mine.pool.stop();
  });
});

describe('(e) cancelling at every stage leaves nothing listed as waiting', () => {
  beforeEach(fake);
  const wanted = (repo: Repo) => Object.values(repo.handles).filter((h: any) => h.doc()?.runs && isWanted(h.doc()));

  it('before the queue is had (the list of queues not here yet), and the list arriving afterwards', async () => {
    const repo = newRepo();
    const away = newRepo();
    const storageAway = away.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
    g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: storageAway.url } });
    const controller = new AbortController();
    let error: Error | undefined;
    doWork(repo, { importUrl: COUNTED_DATA, key: 'k' }, { signal: controller.signal }).catch((e) => (error = e));
    await vi.advanceTimersByTimeAsync(2_000);
    controller.abort();
    await until(() => !!error, 1_000);
    expect(error?.message).toBe('The task was cancelled');
    // the list of queues comes now: ownQueue goes on and makes own, but nothing is asked
    const storage = repo.import<any>(A.save(storageAway.doc()), { docId: storageAway.documentId } as any);
    await vi.advanceTimersByTimeAsync(40_000);
    await turns();
    expect(queuesListed(repo, storage)).toEqual([]);
    expect(wanted(repo)).toEqual([]);
  });

  it('while it waits (no pool), on own and on a spare', async () => {
    for (const account of ['own here', 'own elsewhere'] as Account[]) {
      const repo = newRepo();
      const { storage } = pageOf(repo, account);
      const controller = new AbortController();
      let error: Error | undefined;
      doWork(repo, { importUrl: COUNTED_DATA, key: 'k' }, { signal: controller.signal }).catch((e) => (error = e));
      await until(() => queuesListed(repo, storage).length > 0, 3_000);
      expect(queuesListed(repo, storage)).toHaveLength(1);
      controller.abort();
      await until(() => !!error, 2_000);
      await vi.advanceTimersByTimeAsync(3 * LAPSE_MS);
      await turns();
      expect(error?.message, account).toBe('The task was cancelled');
      expect(queuesListed(repo, storage), account).toEqual([]);
      expect(wanted(repo), account).toEqual([]);
    }
  });

  it('while it runs: the pool is told, and nothing is listed again', async () => {
    const repo = newRepo();
    const { own, storage } = pageOf(repo, 'own here');
    const executor = new Recording(false);
    const p = pool(repo, 'this-browser', own!.url, loopback()(), executor);
    await vi.advanceTimersByTimeAsync(LISTEN_MS);
    const controller = new AbortController();
    let error: Error | undefined;
    doWork(repo, { importUrl: COUNTED_DATA, key: 'k' }, { signal: controller.signal }).catch((e) => (error = e));
    await until(() => executor.jobs.length > 0, 10_000);
    expect(executor.jobs).toHaveLength(1);
    controller.abort();
    await until(() => !!error, 3_000);
    expect(error?.message).toBe('The task was cancelled');
    await vi.advanceTimersByTimeAsync(3 * LAPSE_MS);
    await turns();
    expect(executor.workers[0].aborted).toBe('cancelled');
    expect(queuesListed(repo, storage)).toEqual([]);
    expect(wanted(repo)).toEqual([]);
    expect(executor.jobs).toHaveLength(1);
    await p.pool.stop();
  });

  it('aborted in the same turn as the call, with own here: nothing is listed', async () => {
    const repo = newRepo();
    const { storage } = pageOf(repo, 'own here');
    const controller = new AbortController();
    let error: Error | undefined;
    doWork(repo, { importUrl: COUNTED_DATA, key: 'k' }, { signal: controller.signal }).catch((e) => (error = e));
    controller.abort();
    await until(() => !!error, 1_000);
    await vi.advanceTimersByTimeAsync(LAPSE_MS);
    await turns();
    expect(error?.message).toBe('The task was cancelled');
    expect(queuesListed(repo, storage)).toEqual([]);
    expect(wanted(repo)).toEqual([]);
  });
});

describe('(f) the same key asked from two pages at once is one task and one run', () => {
  beforeEach(fake);
  it('two Repos with the same own, asking before either has the other\'s change, then merged; one pool', async () => {
    const a = newRepo();
    const { own, storage } = pageOf(a, 'own here');
    const accountA = g.accountDocHandle;
    const b = newRepo();
    const ownB = b.import<Queue>(A.save(own!.doc()), { docId: own!.documentId } as any);
    const storageB = b.import<any>(A.save(storage!.doc()), { docId: storage!.documentId } as any);
    const accountB = b.import<any>(A.save(accountA.doc()), { docId: accountA.documentId } as any);
    const results: unknown[] = [];
    g.accountDocHandle = accountA;
    doWork(a, { importUrl: COUNTED_DATA, input: 'A', key: 'same' }).then((v) => results.push(v));
    await until(() => !!entryAt(own!.doc(), 'same'), 2_000);
    g.accountDocHandle = accountB;
    doWork(b, { importUrl: COUNTED_DATA, input: 'B', key: 'same' }).then((v) => results.push(v));
    await until(() => !!entryAt(ownB.doc(), 'same'), 2_000);
    void storageB;
    // the two pages meet: every document each made goes to the other
    const sync = () => {
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        for (const handle of Object.values(from.handles) as DocHandle<any>[]) {
          if (!handle.doc()) continue;
          const there = to.handles[handle.documentId] as DocHandle<any> | undefined;
          if (there?.doc()) there.update((doc) => A.merge(doc, A.clone(handle.doc())));
          else to.import(A.save(handle.doc()), { docId: handle.documentId } as any);
        }
      }
    };
    sync();
    await turns();
    expect(entryAt(own!.doc(), 'same')?.taskUrl).toBe(entryAt(ownB.doc(), 'same')?.taskUrl);
    const p = pool(a, 'this-browser', own!.url, loopback()());
    for (let i = 0; i < 40 && results.length < 2; i++) {
      await vi.advanceTimersByTimeAsync(500);
      await turns(2);
      sync();
    }
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
    const runs = Object.values(a.handles).flatMap((h: any) => (h.doc()?.key === 'same' ? recordsOf(h.doc()).filter((r: any) => r.pool) : []));
    expect(p.executor.jobs).toHaveLength(1);
    expect(runs).toHaveLength(1);
    await p.pool.stop();
  });
});
